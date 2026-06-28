"use client";

import { Layers2, Loader2, Maximize2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ComposerEditor } from "@/components/nodes/composer/composer-editor";
import { MediaPreviewVideo } from "@/components/nodes/media-preview";
import { PreviewImage } from "@/components/nodes/preview-image";
import { defineNode } from "@/lib/engine/define-node";
import { uploadImageAsset, uploadMediaAsset } from "@/lib/library/upload-asset";
import {
  compositeCacheKey,
  renderComposite,
  renderCompositeVideo,
} from "@/lib/media/compose-composer";
import {
  commitDurableRender,
  renderPreview,
} from "@/lib/media/preview-cache";
import { useExecutionStore } from "@/lib/stores/execution-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import {
  clampCanvas,
  clampDurationMs,
  createDefaultDocument,
  createLayer,
  DEFAULT_TIMELINE_MS,
  docDurationMs,
  firstMediaRef,
  isLayerDrawable,
  isTimelineMode,
  resolveLayerMediaTypes,
  resolveLayerUrls,
  resolveMaskUrls,
  sanitizeComposerDocument,
  type ComposerDocument,
  type ComposerInputRef,
} from "@/types/composer";
import type {
  ImageRef,
  NodeBodyProps,
  NodeIO,
  StandardizedOutput,
  VideoRef,
} from "@/types/node";

/**
 * Composer — a layered visual compositor ("mini-Photoshop") that bakes its
 * layers into one image (ADR-0085). Wire images into the auto-growing `layer`
 * sockets (each new wire drops in as a layer), open the full-screen editor to
 * move / scale / rotate, set per-layer opacity + blend mode + z-order, then
 * Run to bake a durable PNG.
 *
 * Reactive (ADR-0075): the composite previews live as you arrange layers —
 * locally, no upload — so positioning is instant; a real Run bakes a durable
 * copy to Supabase (content-addressed, ADR-0083). The editor itself is the
 * WYSIWYG surface; the node body shows the flattened result.
 *
 * Roadmap: masks (Phase 2), video layers (Phase 3) and a timeline (Phase 4)
 * extend the same document model — see `src/types/composer.ts`.
 */

const MIN_PORTS = 1;
const PORT_PREFIX = "layer-";

export interface ComposerNodeConfig {
  doc: ComposerDocument;
  /** Auto-growing layer sockets rendered. Grows to maxWired + 1. */
  portCount?: number;
  /** Input handles already turned into a layer once — so deleting a layer
   * doesn't get undone by the auto-add-on-wire effect. */
  seenInputs?: string[];
}

function layerInputs(portCount: number | undefined): NodeIO[] {
  const n = Math.max(MIN_PORTS, portCount ?? MIN_PORTS);
  // `any` so a layer socket accepts BOTH images and videos (Phase 3). The
  // resolver (`firstMediaRef`) ignores non-media outputs, so wiring text/etc.
  // is a harmless no-op rather than a hard type error.
  return Array.from({ length: n }, (_, i) => ({
    id: `${PORT_PREFIX}${i}`,
    label: `layer ${i + 1}`,
    dataType: "any" as const,
  }));
}

function portIndex(handle: string | undefined): number {
  if (!handle?.startsWith(PORT_PREFIX)) return -1;
  const idx = Number(handle.slice(PORT_PREFIX.length));
  return Number.isFinite(idx) ? idx : -1;
}

/** Map every wired `layer-N` input handle → the upstream's current media ref. */
function useComposerInputs(nodeId: string): Record<string, ComposerInputRef> {
  const edges = useWorkflowStore((s) => s.edges);
  const records = useExecutionStore((s) => s.records);
  return useMemo(() => {
    const map: Record<string, ComposerInputRef> = {};
    for (const e of edges) {
      if (e.target !== nodeId || !e.targetHandle?.startsWith(PORT_PREFIX)) {
        continue;
      }
      const ref = firstMediaRef(records.get(e.source)?.output);
      if (ref) map[e.targetHandle] = ref;
    }
    return map;
  }, [edges, records, nodeId]);
}

function ComposerBody({
  nodeId,
  config,
  updateConfig,
}: NodeBodyProps<ComposerNodeConfig>) {
  const [open, setOpen] = useState(false);
  const doc = useMemo(
    () => sanitizeComposerDocument(config.doc),
    [config.doc],
  );
  const inputs = useComposerInputs(nodeId);

  const record = useExecutionStore((s) => s.records.get(nodeId));
  const status = record?.status;
  const out = record?.output;
  const single = Array.isArray(out) ? out[0] : out;
  const videoUrl = single?.type === "video" ? single.value.url : null;
  const imageUrl = single?.type === "image" ? single.value.url : null;
  const updating = status === "running" && (videoUrl != null || imageUrl != null);
  const timeline = isTimelineMode(doc);
  const durSec = timeline ? docDurationMs(doc) / 1000 : 0;

  // Auto-grow sockets so there's always one free layer slot to wire into.
  const maxConnected = useWorkflowStore((s) => {
    let m = -1;
    for (const e of s.edges) {
      if (e.target === nodeId) m = Math.max(m, portIndex(e.targetHandle));
    }
    return m;
  });
  const desiredPorts = Math.max(MIN_PORTS, maxConnected + 2);
  const currentPorts = Math.max(MIN_PORTS, config.portCount ?? MIN_PORTS);
  useEffect(() => {
    if (currentPorts !== desiredPorts) updateConfig({ portCount: desiredPorts });
  }, [currentPorts, desiredPorts, updateConfig]);

  // Auto-add a layer for any newly wired input (tracked via `seenInputs` so a
  // deleted layer never reappears). New canvases adopt the first image's size.
  const wiredSig = Object.keys(inputs).sort().join(",");
  useEffect(() => {
    const wired = Object.keys(inputs).sort(
      (a, b) => portIndex(a) - portIndex(b),
    );
    const seen = new Set(config.seenInputs ?? []);
    const fresh = wired.filter((h) => !seen.has(h));
    if (fresh.length === 0) return;

    let next = doc;
    const startedEmpty = doc.layers.length === 0;
    for (const h of fresh) {
      next = {
        ...next,
        layers: [
          ...next.layers,
          createLayer({
            source: {
              kind: "input",
              inputHandle: h,
              mediaType: inputs[h]?.mediaType ?? "image",
            },
            name: `Layer ${portIndex(h) + 1}`,
          }),
        ],
      };
    }
    if (startedEmpty) {
      const ref = inputs[fresh[0]!];
      if (ref?.width && ref?.height) {
        next = {
          ...next,
          width: clampCanvas(ref.width, next.width),
          height: clampCanvas(ref.height, next.height),
        };
      }
    }
    // Wiring a VIDEO flips the node into timeline mode (→ video output) sized
    // to the longest fresh clip, so "whatever media we plug in" becomes a real
    // motion render — not a still. Layers inherit the full-span default; the
    // timeline UI (Slice D) refines per-clip placement/trim.
    if ((doc.durationMs ?? 0) === 0) {
      const longestVideoMs = fresh.reduce((m, h) => {
        const ref = inputs[h];
        return ref?.mediaType === "video" ? Math.max(m, ref.durationMs ?? 0) : m;
      }, 0);
      const wiredVideo = fresh.some((h) => inputs[h]?.mediaType === "video");
      if (wiredVideo) {
        next = {
          ...next,
          durationMs: clampDurationMs(longestVideoMs) || DEFAULT_TIMELINE_MS,
        };
      }
    }
    updateConfig({
      doc: next,
      seenInputs: [...(config.seenInputs ?? []), ...fresh],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wiredSig]);

  const layerCount = doc.layers.length;

  return (
    <div className="flex w-full min-w-[260px] flex-col gap-2 px-3 pb-2.5 pt-0.5">
      <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
        <Layers2 className="h-3 w-3 text-accent" />
        <span>
          {layerCount} layer{layerCount === 1 ? "" : "s"}
        </span>
        <span className="text-muted-foreground/60">·</span>
        <span>
          {doc.width}×{doc.height}
        </span>
        {timeline ? (
          <>
            <span className="text-muted-foreground/60">·</span>
            <span className="text-accent">{durSec.toFixed(1)}s</span>
          </>
        ) : null}
      </div>

      {status === "error" && record?.error ? (
        <p
          role="alert"
          className="rounded-md bg-destructive/10 px-2 py-1.5 text-[11px] leading-snug text-destructive"
        >
          {record.error}
        </p>
      ) : videoUrl ? (
        <div className="relative">
          <MediaPreviewVideo
            url={videoUrl}
            loop
            testId="composer-result-video"
            className="bg-black"
          />
          {updating ? (
            <span
              aria-hidden
              className="pointer-events-none absolute right-1.5 top-1.5 rounded-full bg-background/70 p-1 backdrop-blur-sm"
            >
              <Loader2 className="h-3 w-3 animate-spin text-accent" />
            </span>
          ) : null}
        </div>
      ) : imageUrl ? (
        <div className="relative">
          <PreviewImage
            url={imageUrl}
            alt="Composite"
            downloadName="composite"
            checkerboard
            testId="composer-result"
          />
          {updating ? (
            <span
              aria-hidden
              className="pointer-events-none absolute right-1.5 top-1.5 rounded-full bg-background/70 p-1 backdrop-blur-sm"
            >
              <Loader2 className="h-3 w-3 animate-spin text-accent" />
            </span>
          ) : null}
          {timeline ? (
            <span className="pointer-events-none absolute bottom-1.5 left-1.5 rounded bg-background/70 px-1.5 py-0.5 text-[9px] text-muted-foreground backdrop-blur-sm">
              poster · Run to render video
            </span>
          ) : null}
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-md border border-dashed border-border/40 bg-foreground/[0.02] px-2 py-2 text-[11px] text-muted-foreground">
          <Layers2 className="h-3 w-3" />
          <span>
            {layerCount > 0
              ? "Open the editor to arrange · preview is live"
              : "Wire an image, or open the editor to add layers"}
          </span>
        </div>
      )}

      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border/60 bg-background/40 px-2 py-1.5 text-[11px] font-medium text-foreground/90 transition-colors hover:bg-foreground/[0.06]"
      >
        <Maximize2 className="h-3 w-3" />
        Open Composer
      </button>

      {open ? (
        <ComposerEditor
          doc={doc}
          inputs={inputs}
          onChange={(nextDoc) => updateConfig({ doc: nextDoc })}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}

export const composerNodeSchema = defineNode<ComposerNodeConfig>({
  kind: "composer",
  category: "compose",
  title: "Composer",
  description:
    "A layered visual compositor (mini-Photoshop / mini-After-Effects). Wire images OR videos into the auto-growing layer sockets — each wire drops in as a layer — then open the full-screen editor to move, scale, and rotate layers, set per-layer opacity, blend mode (16 modes), masks (alpha/luma), and z-order over a sized canvas. Wiring a VIDEO flips the node into timeline mode: `out` becomes a real MOTION video (every frame composited, not a still), sized to the longest clip. The timeline lets you sequence, trim, set duration, and fade layers in/out. Image-only docs flatten to a durable PNG. Reactive: the composite previews live as you arrange; a Run bakes the durable PNG/MP4 to Supabase. Add solid-fill and pasted-URL layers in the editor too.",
  icon: Layers2,
  inputs: layerInputs(MIN_PORTS),
  getInputs: (config) => layerInputs(config.portCount),
  outputs: [{ id: "out", label: "out", dataType: "image" }],
  // `out` flips image↔video with the doc's timeline (ADR-0091): a timeline
  // (durationMs > 0, set when a video is wired) renders a motion clip.
  getOutputs: (config) => [
    {
      id: "out",
      label: "out",
      dataType: clampDurationMs(config.doc?.durationMs) > 0 ? "video" : "image",
    },
  ],
  defaultConfig: {
    doc: createDefaultDocument(),
    portCount: MIN_PORTS,
    seenInputs: [],
  },
  reactive: true,
  execute: async ({ nodeId, config, inputs, preview, signal }) => {
    const doc = sanitizeComposerDocument(config.doc);

    // Resolve every wired input handle → media ref (image OR video), then map
    // layers → urls + media kinds.
    const portCount = Math.max(MIN_PORTS, config.portCount ?? MIN_PORTS);
    const refByHandle: Record<string, ComposerInputRef | undefined> = {};
    for (let i = 0; i < portCount; i++) {
      const handle = `${PORT_PREFIX}${i}`;
      const ref = firstMediaRef(inputs[handle]);
      if (ref) refByHandle[handle] = ref;
    }
    const urls = resolveLayerUrls(doc, refByHandle);
    const maskUrls = resolveMaskUrls(doc, refByHandle);
    const mediaTypes = resolveLayerMediaTypes(doc, refByHandle);

    const anyDrawable = doc.layers.some((l) => isLayerDrawable(l, refByHandle));
    if (!anyDrawable) {
      throw new Error("Add or wire at least one visible layer to compose.");
    }

    const key = compositeCacheKey(doc, urls, maskUrls, mediaTypes);

    // TIMELINE mode → an MP4. The reactive preview stays cheap (a single poster
    // frame for the node body); the full per-frame encode is Run-only.
    if (isTimelineMode(doc)) {
      if (preview) {
        const url = await renderPreview(nodeId, key, () =>
          renderComposite({ doc, urls, maskUrls, mediaTypes, atSec: 0 }),
        );
        return {
          type: "image",
          value: { url, mime: "image/png" },
        } satisfies StandardizedOutput;
      }
      const result = await renderCompositeVideo({
        doc,
        urls,
        maskUrls,
        mediaTypes,
        signal,
      });
      const file = new File([result.blob], "composite.mp4", {
        type: "video/mp4",
      });
      const uploaded = await uploadMediaAsset(file, "videos");
      commitDurableRender(nodeId, key, uploaded.url);
      const ref: VideoRef = {
        url: uploaded.url,
        mime: "video/mp4",
        width: result.width,
        height: result.height,
        durationMs: result.durationMs,
      };
      return {
        output: { type: "video", value: ref },
        usage: { model: "canvas compositor (timeline)" },
      };
    }

    // IMAGE mode → flatten one PNG (the original path).
    if (preview) {
      const url = await renderPreview(nodeId, key, () =>
        renderComposite({ doc, urls, maskUrls, mediaTypes }),
      );
      return {
        type: "image",
        value: { url, mime: "image/png" },
      } satisfies StandardizedOutput;
    }

    const blob = await renderComposite({ doc, urls, maskUrls, mediaTypes });
    const file = new File([blob], "composite.png", { type: "image/png" });
    const uploaded = await uploadImageAsset(file);
    commitDurableRender(nodeId, key, uploaded.url);
    const ref: ImageRef = {
      url: uploaded.url,
      mime: "image/png",
      width: doc.width,
      height: doc.height,
    };
    return {
      output: { type: "image", value: ref },
      usage: { model: "canvas compositor" },
    };
  },
  Body: ComposerBody,
  size: {
    defaultWidth: 320,
    minWidth: 260,
    maxWidth: 720,
    resizable: "both",
  },
});
