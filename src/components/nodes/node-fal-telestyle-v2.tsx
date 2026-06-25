"use client";

import { ImageIcon, Loader2, Palette } from "lucide-react";
import { useId } from "react";

import { PreviewImage } from "@/components/nodes/preview-image";
import { defineNode } from "@/lib/engine/define-node";
import { extractInputByType } from "@/lib/engine/extract-input";
import { callTelestyleV2 } from "@/lib/fal/call-telestyle-v2";
import {
  TELESTYLE_V2_DEFAULT_LORA_SCALE,
  TELESTYLE_V2_MAX_LORA_SCALE,
  TELESTYLE_V2_MIN_LORA_SCALE,
  TELESTYLE_V2_OUTPUT_FORMATS,
  type TelestyleV2OutputFormat,
} from "@/lib/fal/types";
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
 * TeleStyle V2 — style transfer (via Fal).
 *
 * Wire a CONTENT image (the subject / structure to keep) and a STYLE image
 * (the look — material, lighting, palette — to borrow). TeleStyleV2 (on
 * Qwen-Image-Edit-2509) restyles the content with the style. The prompt is
 * derived automatically from both images by a VLM, so there's no prompt input.
 *
 * Output `styled` is the restyled image (re-hosted into our bucket so it
 * survives Fal's CDN TTL and feeds downstream nodes). Non-reactive (Fal
 * billing). One knob: `loraScale` (style strength); plus an output format.
 */
export interface TelestyleV2NodeConfig {
  /** Style-adapter strength (0..4). 1.0 = full style; lower = subtler. */
  loraScale?: number;
  outputFormat?: TelestyleV2OutputFormat;
}

function imageUrlFromOutput(
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

function TelestyleV2Body({
  nodeId,
  config,
}: NodeBodyProps<TelestyleV2NodeConfig>) {
  const record = useExecutionStore((s) => s.records.get(nodeId));
  const status = record?.status;
  const history = record?.history ?? [];

  const { cursor, setCursor } = useNodeHistoryCursor(nodeId, history.length);
  const activeOutput =
    history.length > 0 ? history[cursor]?.output : record?.output;
  const url = imageUrlFromOutput(activeOutput);

  const strength = config.loraScale ?? TELESTYLE_V2_DEFAULT_LORA_SCALE;

  return (
    <div className="flex w-full min-w-[260px] flex-col gap-2 px-3 pb-2.5 pt-0.5">
      <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
        <Palette className="h-3 w-3 text-accent" />
        <span className="font-medium">TeleStyle V2</span>
        <span className="text-muted-foreground/60">·</span>
        <span>style {strength}</span>
      </div>

      <div className="relative">
        {history.length > 1 ? (
          <div
            data-testid="telestyle-v2-history-cursor"
            className="absolute right-1 top-1 z-10"
          >
            <IteratorCursor
              count={history.length}
              cursor={cursor}
              onCursorChange={setCursor}
              ariaLabelPrefix="Styled image"
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
            <span>Restyling…</span>
          </div>
        ) : url ? (
          <PreviewImage
            url={url}
            alt="Restyled image"
            downloadName="telestyle-v2"
            testId="telestyle-v2-result"
          />
        ) : (
          <div className="flex items-center gap-2 rounded-md border border-dashed border-border/40 bg-foreground/[0.02] px-2 py-2 text-[11px] text-muted-foreground">
            <ImageIcon className="h-3 w-3" />
            <span>Wire content + style, then Run</span>
          </div>
        )}
      </div>
    </div>
  );
}

function TelestyleV2Settings({
  config,
  updateConfig,
}: NodeBodyProps<TelestyleV2NodeConfig>) {
  const strengthId = useId();
  const formatId = useId();
  const strength = config.loraScale ?? TELESTYLE_V2_DEFAULT_LORA_SCALE;

  return (
    <div className="flex flex-col gap-3 text-xs">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={strengthId} className="font-medium text-foreground/90">
          Style strength{" "}
          <span className="text-muted-foreground">({strength})</span>
        </label>
        <input
          id={strengthId}
          type="range"
          min={TELESTYLE_V2_MIN_LORA_SCALE}
          max={TELESTYLE_V2_MAX_LORA_SCALE}
          step={0.05}
          value={strength}
          onChange={(e) => updateConfig({ loraScale: Number(e.target.value) })}
          onPointerDown={(e) => e.stopPropagation()}
          className="w-full accent-accent"
        />
        <p className="text-[10.5px] text-muted-foreground/80">
          1.0 applies the reference style fully; lower values keep more of the
          content image&apos;s original look.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={formatId} className="font-medium text-foreground/90">
          Output format
        </label>
        <select
          id={formatId}
          value={config.outputFormat ?? "png"}
          onChange={(e) =>
            updateConfig({
              outputFormat: e.target.value as TelestyleV2OutputFormat,
            })
          }
          className="h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs"
        >
          {TELESTYLE_V2_OUTPUT_FORMATS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export function hasTelestyleV2Overrides(config: TelestyleV2NodeConfig): boolean {
  return (
    (config.loraScale !== undefined &&
      config.loraScale !== TELESTYLE_V2_DEFAULT_LORA_SCALE) ||
    (config.outputFormat !== undefined && config.outputFormat !== "png")
  );
}

export const telestyleV2NodeSchema = defineNode<TelestyleV2NodeConfig>({
  kind: "fal-telestyle-v2",
  category: "ai-image",
  title: "TeleStyle V2",
  description:
    "Style transfer (TeleStyle V2 via Fal). Wire a CONTENT image (subject/structure to keep) + a STYLE image (look to borrow) → Run → the content restyled in the reference's style. The prompt is auto-derived from both images by a VLM — no prompt needed. Tune `loraScale` (style strength, default 1.0) in settings. Non-reactive (costs money).",
  icon: Palette,
  inputs: [
    { id: "content", label: "content", dataType: "image" },
    { id: "style", label: "style", dataType: "image" },
  ],
  outputs: [{ id: "out", label: "styled", dataType: "image" }],
  configParams: {
    loraScale: {
      control: "number",
      label: "style strength",
      min: TELESTYLE_V2_MIN_LORA_SCALE,
      max: TELESTYLE_V2_MAX_LORA_SCALE,
      step: 0.05,
    },
    outputFormat: {
      control: "select",
      options: TELESTYLE_V2_OUTPUT_FORMATS,
      label: "output format",
    },
  },
  defaultConfig: {},
  reactive: false,
  execute: async ({ config, inputs, signal }) => {
    const content = extractInputByType(inputs, "content", "image");
    if (!content?.url) {
      throw new Error("Wire a CONTENT image into the `content` input.");
    }
    const style = extractInputByType(inputs, "style", "image");
    if (!style?.url) {
      throw new Error("Wire a STYLE image into the `style` input.");
    }

    const format = config.outputFormat ?? "png";
    const result = await callTelestyleV2({
      contentImageUrl: content.url,
      styleImageUrl: style.url,
      ...(config.loraScale !== undefined ? { loraScale: config.loraScale } : {}),
      ...(config.outputFormat ? { outputFormat: config.outputFormat } : {}),
      signal,
    });

    // Re-host into our bucket so the result survives Fal's CDN TTL and can
    // feed downstream nodes (matches the SAM 3 cutout pattern).
    const ext = format === "jpeg" ? "jpg" : "png";
    const hosted = await uploadImageFromUrl(
      result.imageUrl,
      `telestyle-v2.${ext}`,
    );
    const ref: ImageRef = {
      url: hosted.url,
      mime: result.mime ?? (ext === "jpg" ? "image/jpeg" : "image/png"),
    };

    return {
      output: { type: "image", value: ref } satisfies StandardizedOutput,
      usage: { model: result.model },
    };
  },
  Body: TelestyleV2Body,
  settings: { Content: TelestyleV2Settings, hasOverrides: hasTelestyleV2Overrides },
  size: {
    defaultWidth: 300,
    minWidth: 260,
    maxWidth: 720,
    resizable: "both",
  },
});
