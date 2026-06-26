"use client";

import { Layers2, Loader2, Maximize2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ComposerEditor } from "@/components/nodes/composer/composer-editor";
import { PreviewImage } from "@/components/nodes/preview-image";
import { defineNode } from "@/lib/engine/define-node";
import { extractInputByType } from "@/lib/engine/extract-input";
import { uploadImageAsset } from "@/lib/library/upload-asset";
import {
  compositeCacheKey,
  renderComposite,
} from "@/lib/media/compose-composer";
import {
  commitDurableRender,
  renderPreview,
} from "@/lib/media/preview-cache";
import { useExecutionStore } from "@/lib/stores/execution-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import {
  clampCanvas,
  createDefaultDocument,
  createLayer,
  firstImageRef,
  isLayerDrawable,
  resolveLayerUrls,
  resolveMaskUrls,
  sanitizeComposerDocument,
  type ComposerDocument,
} from "@/types/composer";
import type {
  ImageRef,
  NodeBodyProps,
  NodeIO,
  StandardizedOutput,
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
  return Array.from({ length: n }, (_, i) => ({
    id: `${PORT_PREFIX}${i}`,
    label: `layer ${i + 1}`,
    dataType: "image" as const,
  }));
}

function portIndex(handle: string | undefined): number {
  if (!handle?.startsWith(PORT_PREFIX)) return -1;
  const idx = Number(handle.slice(PORT_PREFIX.length));
  return Number.isFinite(idx) ? idx : -1;
}

/** Map every wired `layer-N` input handle → the upstream's current ImageRef. */
function useComposerInputs(nodeId: string): Record<string, ImageRef> {
  const edges = useWorkflowStore((s) => s.edges);
  const records = useExecutionStore((s) => s.records);
  return useMemo(() => {
    const map: Record<string, ImageRef> = {};
    for (const e of edges) {
      if (e.target !== nodeId || !e.targetHandle?.startsWith(PORT_PREFIX)) {
        continue;
      }
      const ref = firstImageRef(records.get(e.source)?.output);
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
  const resultUrl = firstImageRef(record?.output)?.url ?? null;
  const updating = status === "running" && resultUrl != null;

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
            source: { kind: "input", inputHandle: h, mediaType: "image" },
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
      </div>

      {status === "error" && record?.error ? (
        <p
          role="alert"
          className="rounded-md bg-destructive/10 px-2 py-1.5 text-[11px] leading-snug text-destructive"
        >
          {record.error}
        </p>
      ) : resultUrl ? (
        <div className="relative">
          <PreviewImage
            url={resultUrl}
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
    "A layered visual compositor (mini-Photoshop). Wire images into the auto-growing layer sockets — each wire drops in as a layer — then open the full-screen editor to move, scale, and rotate layers, set per-layer opacity, blend mode (16 modes), and z-order over a sized canvas. Reactive: the composite previews live as you arrange; a Run bakes a durable PNG to Supabase. Add solid-fill and pasted-URL layers in the editor too. Foundation for masks, video layers, and a timeline.",
  icon: Layers2,
  inputs: layerInputs(MIN_PORTS),
  getInputs: (config) => layerInputs(config.portCount),
  outputs: [{ id: "out", label: "out", dataType: "image" }],
  defaultConfig: {
    doc: createDefaultDocument(),
    portCount: MIN_PORTS,
    seenInputs: [],
  },
  reactive: true,
  execute: async ({ nodeId, config, inputs, preview }) => {
    const doc = sanitizeComposerDocument(config.doc);

    // Resolve every wired image input handle → ImageRef, then map layers → urls.
    const portCount = Math.max(MIN_PORTS, config.portCount ?? MIN_PORTS);
    const refByHandle: Record<string, ImageRef | undefined> = {};
    for (let i = 0; i < portCount; i++) {
      const handle = `${PORT_PREFIX}${i}`;
      const ref = extractInputByType(inputs, handle, "image");
      if (ref) refByHandle[handle] = ref;
    }
    const urls = resolveLayerUrls(doc, refByHandle);
    const maskUrls = resolveMaskUrls(doc, refByHandle);

    const anyDrawable = doc.layers.some((l) => isLayerDrawable(l, refByHandle));
    if (!anyDrawable) {
      throw new Error("Add or wire at least one visible layer to compose.");
    }

    const key = compositeCacheKey(doc, urls, maskUrls);

    if (preview) {
      const url = await renderPreview(nodeId, key, () =>
        renderComposite({ doc, urls, maskUrls }),
      );
      return {
        type: "image",
        value: { url, mime: "image/png" },
      } satisfies StandardizedOutput;
    }

    const blob = await renderComposite({ doc, urls, maskUrls });
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
