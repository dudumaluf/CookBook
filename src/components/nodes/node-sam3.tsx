"use client";

import { Loader2, Scissors } from "lucide-react";
import { useId } from "react";

import { PreviewImage } from "@/components/nodes/preview-image";
import { defineNode } from "@/lib/engine/define-node";
import { extractInputByType } from "@/lib/engine/extract-input";
import { callSam3 } from "@/lib/fal/call-sam3";
import { uploadImageFromUrl } from "@/lib/library/upload-asset";
import { useExecutionStore } from "@/lib/stores/execution-store";
import type {
  ImageRef,
  NodeBodyProps,
  StandardizedOutput,
} from "@/types/node";

import { IteratorCursor } from "./iterator-cursor";
import { useNodeHistoryCursor } from "./use-node-history-cursor";

/**
 * SAM 3 — promptable segmentation / subject cutout (via Fal).
 *
 * Wire an image and (optionally) a text `prompt` naming what to keep
 * ("person", "dog", "car"). The node returns the masked cutout on `out`:
 * a transparent PNG with everything else removed, ready to drop over a
 * different background with the Image Stack node. This is the fix for
 * "I edited the scene in Nano Banana but the character drifted" — cut the
 * original subject out and lay it back on top of the edited frame.
 *
 * Non-reactive (Fal billing, ~$0.005/request). A wired `prompt` input wins
 * over the settings field; with neither set we default to "person". The
 * cutout is forced to PNG so it keeps its alpha channel.
 */
export interface Sam3NodeConfig {
  /** What to segment. Used when no `prompt` input is wired. */
  prompt?: string;
}

const DEFAULT_PROMPT = "person";

function cutoutUrlFromOutput(
  output: StandardizedOutput | StandardizedOutput[] | undefined,
): string | null {
  if (!output) return null;
  if (Array.isArray(output)) {
    const hit = output.find(
      (o): o is StandardizedOutput & { type: "image" } => o.type === "image",
    );
    return hit?.value.url ?? null;
  }
  return output.type === "image" ? output.value.url : null;
}

function Sam3Body({ nodeId, config }: NodeBodyProps<Sam3NodeConfig>) {
  const record = useExecutionStore((s) => s.records.get(nodeId));
  const status = record?.status;
  const history = record?.history ?? [];

  const { cursor, setCursor } = useNodeHistoryCursor(nodeId, history.length);
  const activeOutput =
    history.length > 0 ? history[cursor]?.output : record?.output;
  const url = cutoutUrlFromOutput(activeOutput);

  return (
    <div className="flex w-full min-w-[260px] flex-col gap-2 px-3 pb-2.5 pt-0.5">
      <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
        <Scissors className="h-3 w-3 text-accent" />
        <span className="font-medium">SAM 3</span>
        <span className="text-muted-foreground/60">·</span>
        <span className="truncate">{config.prompt?.trim() || DEFAULT_PROMPT}</span>
      </div>

      <div className="relative">
        {history.length > 1 ? (
          <div
            data-testid="sam3-history-cursor"
            className="absolute right-1 top-1 z-10"
          >
            <IteratorCursor
              count={history.length}
              cursor={cursor}
              onCursorChange={setCursor}
              ariaLabelPrefix="Cutout"
              className="bg-background/75 shadow-sm backdrop-blur-sm"
            />
          </div>
        ) : null}

        {status === "error" && record?.error ? (
          <p
            role="alert"
            className="rounded-md bg-destructive/10 px-2 py-1.5 text-[11px] leading-snug text-destructive"
          >
            {record.error}
          </p>
        ) : status === "running" ? (
          <div className="flex items-center gap-2 rounded-md bg-foreground/[0.04] px-2 py-2 text-[11px] text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Segmenting…</span>
          </div>
        ) : url ? (
          <PreviewImage
            url={url}
            alt="Segmented cutout"
            downloadName="sam3-cutout"
            checkerboard
            testId="sam3-result"
          />
        ) : (
          <div className="flex items-center gap-2 rounded-md border border-dashed border-border/40 bg-foreground/[0.02] px-2 py-2 text-[11px] text-muted-foreground">
            <Scissors className="h-3 w-3" />
            <span>Wire an image, then Run</span>
          </div>
        )}
      </div>
    </div>
  );
}

function Sam3Settings({ config, updateConfig }: NodeBodyProps<Sam3NodeConfig>) {
  const promptId = useId();

  return (
    <div className="flex flex-col gap-2 text-xs">
      <label htmlFor={promptId} className="font-medium text-foreground/90">
        Prompt
        <span className="ml-1 text-[10px] font-normal text-muted-foreground">
          (what to keep)
        </span>
      </label>
      <input
        id={promptId}
        type="text"
        placeholder={DEFAULT_PROMPT}
        value={config.prompt ?? ""}
        onChange={(e) =>
          updateConfig({
            prompt: e.target.value.trim().length > 0 ? e.target.value : undefined,
          })
        }
        onPointerDown={(e) => e.stopPropagation()}
        className="h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs"
      />
      <p className="text-[10.5px] text-muted-foreground/80">
        A wired <code>prompt</code> input overrides this. The cutout is a
        transparent PNG — layer it over a background with Image Stack.
      </p>
    </div>
  );
}

export function hasSam3Overrides(config: Sam3NodeConfig): boolean {
  return config.prompt !== undefined && config.prompt.trim().length > 0;
}

export const sam3NodeSchema = defineNode<Sam3NodeConfig>({
  kind: "sam-3",
  category: "transform",
  title: "SAM 3 Segment",
  description:
    "Promptable segmentation / subject cutout (SAM 3 via Fal, ~$0.005). Wire an image + a text prompt naming what to keep ('person'). `out` is a transparent-PNG cutout — layer it over another image with Image Stack to recompose a subject without re-generating it. A wired `prompt` input overrides the settings field; defaults to 'person'.",
  icon: Scissors,
  inputs: [
    { id: "image", label: "image", dataType: "image" },
    { id: "prompt", label: "prompt", dataType: "text" },
  ],
  outputs: [{ id: "out", label: "cutout", dataType: "image" }],
  defaultConfig: {},
  reactive: false,
  execute: async ({ config, inputs, signal }) => {
    const image = extractInputByType(inputs, "image", "image");
    if (!image?.url) {
      throw new Error("Wire an image into the `image` handle.");
    }
    const wiredPrompt = extractInputByType(inputs, "prompt", "text")?.trim();
    const prompt =
      wiredPrompt && wiredPrompt.length > 0
        ? wiredPrompt
        : config.prompt?.trim() || DEFAULT_PROMPT;

    const result = await callSam3({
      imageUrl: image.url,
      prompt,
      applyMask: true,
      outputFormat: "png",
      signal,
    });

    // The masked preview is the cutout; fall back to the first raw mask if
    // the endpoint skipped compositing. Re-host into our bucket so the
    // result survives Fal's CDN TTL and can feed downstream nodes.
    const source = result.primaryUrl ?? result.maskUrls[0];
    if (!source) {
      throw new Error("SAM 3 returned no usable image.");
    }
    const cutout = await uploadImageFromUrl(source, "sam3-cutout.png");
    const ref: ImageRef = { url: cutout.url, mime: "image/png" };

    return {
      output: { type: "image", value: ref } satisfies StandardizedOutput,
      usage: { model: result.model },
    };
  },
  Body: Sam3Body,
  settings: { Content: Sam3Settings, hasOverrides: hasSam3Overrides },
  size: {
    defaultWidth: 300,
    minWidth: 260,
    maxWidth: 720,
    resizable: "both",
  },
});
