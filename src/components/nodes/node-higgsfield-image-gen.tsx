"use client";

import {
  Image as ImageIcon,
  ImagePlus,
  Loader2,
  Sparkles,
} from "lucide-react";
import { useId } from "react";

import { defineNode } from "@/lib/engine/define-node";
import { callHiggsfieldImage } from "@/lib/higgsfield/call-higgsfield-image";
import {
  SOUL_ASPECT_RATIOS,
  SOUL_BATCH_SIZES,
  SOUL_RESOLUTIONS,
  type SoulAspectRatio,
  type SoulBatchSize,
  type SoulMode,
  type SoulResolution,
} from "@/lib/higgsfield/types";
import { extractInputByType } from "@/lib/engine/extract-input";
import { useExecutionStore } from "@/lib/stores/execution-store";
import { cn } from "@/lib/utils";
import type {
  ImageRef,
  NodeBodyProps,
  StandardizedOutput,
} from "@/types/node";

/**
 * Higgsfield Image Gen — the executable image-generation node.
 *
 * Inputs (all single):
 *   - prompt  (text)        — required at execute() time
 *   - soulId  (soul-id)     — optional Soul ID character; drives variant
 *                              dispatch when wired
 *   - image   (image)       — optional reference image; routes to "Soul
 *                              Reference" mode (mutually exclusive with
 *                              the styleId in settings)
 *
 * Outputs:
 *   - out (image, multi)    — the batched URLs from Higgsfield (1 or 4)
 *
 * Body: idle → "Connect a prompt then click Run". Running → spinner +
 * "Generating with Soul X". Done → grid of returned thumbs (clickable to
 * open in a new tab). Cached → grid + lightning hint via the status chip.
 * Error → destructive alert pill with the upstream message (mirrors the
 * LLM Text node's error pattern).
 *
 * Settings popover (BaseNode `⋯` slot per ADR-0027): aspect ratio,
 * resolution, batch size, optional seed, optional negative prompt, and
 * — when no image input is wired — an optional Soul Style preset id.
 *
 * Dispatch logic (per ADR-0029):
 *   - soulId wired → variant comes from the SoulIdRef; endpoint is picked
 *     by the variant (v2 → soul/v2/standard, cinema → soul/cinema, v1 →
 *     soul/character).
 *   - no soulId wired → variant === "none"; endpoint is soul/v2/standard
 *     for the cleanest generic render.
 *   - image input wired → mode === "reference"; styleId is dropped.
 *   - no image input wired but settings has a styleId → mode === "style".
 *   - otherwise → mode === "none".
 */
export interface HiggsfieldImageGenNodeConfig {
  aspectRatio?: SoulAspectRatio;
  resolution?: SoulResolution;
  batchSize?: SoulBatchSize;
  seed?: number;
  negativePrompt?: string;
  /**
   * Soul Style preset UUID. Only sent when no `image` input is wired
   * (Soul Reference and Soul Style are mutually exclusive on the API).
   * The settings popover hides the styleId field when an image is present
   * and shows the hint "Disconnect the reference image to use a style."
   */
  styleId?: string;
}

const DEFAULT_ASPECT: SoulAspectRatio = "1:1";
const DEFAULT_RESOLUTION: SoulResolution = "720p";
const DEFAULT_BATCH: SoulBatchSize = 1;

/* ────────────────────────────────────────────────────────────────────── */
/* Body                                                                   */
/* ────────────────────────────────────────────────────────────────────── */

function HiggsfieldImageGenNodeBody({
  nodeId,
  config,
}: NodeBodyProps<HiggsfieldImageGenNodeConfig>) {
  const record = useExecutionStore((s) => s.records.get(nodeId));
  const status = record?.status;

  // Output is always an array (batch_size 1 → array of 1; batch_size 4 →
  // array of 4). Normalise to a flat list of urls for rendering.
  const imageUrls: string[] =
    record?.output && Array.isArray(record.output)
      ? record.output
          .filter((o): o is StandardizedOutput & { type: "image" } =>
            o.type === "image",
          )
          .map((o) => o.value.url)
      : record?.output && !Array.isArray(record.output) &&
          record.output.type === "image"
        ? [record.output.value.url]
        : [];

  return (
    <div className="flex w-full min-w-[280px] flex-col gap-2 px-3 pb-2.5 pt-0.5">
      {/* Status / metadata strip — always present, very small. */}
      <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
        <Sparkles className="h-3 w-3 text-accent" />
        <span className="font-medium">Higgsfield Soul</span>
        <span className="text-muted-foreground/60">·</span>
        <span>{config.aspectRatio ?? DEFAULT_ASPECT}</span>
        <span className="text-muted-foreground/60">·</span>
        <span>{config.resolution ?? DEFAULT_RESOLUTION}</span>
        <span className="text-muted-foreground/60">·</span>
        <span>×{config.batchSize ?? DEFAULT_BATCH}</span>
      </div>

      {/* Output / placeholder area. */}
      {status === "error" && record?.error ? (
        <p
          role="alert"
          className="rounded-md bg-destructive/10 px-2 py-1.5 text-[11px] leading-snug text-destructive"
        >
          {record.error}
        </p>
      ) : status === "running" ? (
        <div className="flex aspect-square w-full items-center justify-center rounded-md bg-foreground/[0.04] text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : imageUrls.length > 0 ? (
        <div
          className={cn(
            "grid gap-1.5",
            imageUrls.length === 1 ? "grid-cols-1" : "grid-cols-2",
          )}
        >
          {imageUrls.map((url, i) => (
            <a
              key={`${url}-${i}`}
              href={url}
              target="_blank"
              rel="noreferrer noopener"
              onPointerDown={(e) => e.stopPropagation()}
              className="block aspect-square overflow-hidden rounded-md bg-foreground/5"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={`Generated ${i + 1}`}
                className="h-full w-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            </a>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-md border border-dashed border-border/40 bg-foreground/[0.02] px-2 py-2 text-[11px] text-muted-foreground">
          <ImagePlus className="h-3 w-3" />
          <span>Connect a prompt then click Run</span>
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/* Settings popover content                                               */
/* ────────────────────────────────────────────────────────────────────── */

function HiggsfieldImageGenSettingsContent({
  config,
  updateConfig,
}: NodeBodyProps<HiggsfieldImageGenNodeConfig>) {
  const aspectId = useId();
  const resolutionId = useId();
  const batchId = useId();
  const seedId = useId();
  const negPromptId = useId();
  const styleId = useId();

  return (
    <div className="flex flex-col gap-3 text-xs">
      {/* Aspect ratio ------------------------------------------------- */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={aspectId} className="font-medium text-foreground/90">
          Aspect ratio
        </label>
        <select
          id={aspectId}
          value={config.aspectRatio ?? DEFAULT_ASPECT}
          onChange={(e) =>
            updateConfig({
              aspectRatio: e.target.value as SoulAspectRatio,
            })
          }
          className="h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs"
        >
          {SOUL_ASPECT_RATIOS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>

      {/* Resolution --------------------------------------------------- */}
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={resolutionId}
          className="font-medium text-foreground/90"
        >
          Resolution
        </label>
        <select
          id={resolutionId}
          value={config.resolution ?? DEFAULT_RESOLUTION}
          onChange={(e) =>
            updateConfig({ resolution: e.target.value as SoulResolution })
          }
          className="h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs"
        >
          {SOUL_RESOLUTIONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>

      {/* Batch size --------------------------------------------------- */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={batchId} className="font-medium text-foreground/90">
          Batch size
        </label>
        <select
          id={batchId}
          value={String(config.batchSize ?? DEFAULT_BATCH)}
          onChange={(e) =>
            updateConfig({
              batchSize: Number(e.target.value) as SoulBatchSize,
            })
          }
          className="h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs"
        >
          {SOUL_BATCH_SIZES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <p className="text-[10.5px] text-muted-foreground/80">
          Soul accepts 1 or 4 images per request.
        </p>
      </div>

      {/* Seed --------------------------------------------------------- */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={seedId} className="font-medium text-foreground/90">
          Seed
          <span className="ml-1 text-[10px] font-normal text-muted-foreground">
            (1–1,000,000)
          </span>
        </label>
        <input
          id={seedId}
          type="number"
          min={1}
          max={1_000_000}
          step={1}
          placeholder="Random"
          value={config.seed ?? ""}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") {
              updateConfig({ seed: undefined });
              return;
            }
            const parsed = Number(raw);
            if (
              Number.isInteger(parsed) &&
              parsed >= 1 &&
              parsed <= 1_000_000
            ) {
              updateConfig({ seed: parsed });
            }
          }}
          className="h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs"
        />
      </div>

      {/* Style preset (only when no image is wired) ------------------- */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={styleId} className="font-medium text-foreground/90">
          Soul Style preset
          <span className="ml-1 text-[10px] font-normal text-muted-foreground">
            (UUID)
          </span>
        </label>
        <input
          id={styleId}
          type="text"
          placeholder="optional"
          value={config.styleId ?? ""}
          onChange={(e) => {
            const v = e.target.value.trim();
            updateConfig({ styleId: v.length > 0 ? v : undefined });
          }}
          className="h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs"
        />
        <p className="text-[10.5px] text-muted-foreground/80">
          Wire a reference image to use Soul Reference mode instead. Style
          and reference are mutually exclusive.
        </p>
      </div>

      {/* Negative prompt --------------------------------------------- */}
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={negPromptId}
          className="font-medium text-foreground/90"
        >
          Negative prompt
        </label>
        <textarea
          id={negPromptId}
          rows={2}
          placeholder="blur, low quality, …"
          value={config.negativePrompt ?? ""}
          onChange={(e) =>
            updateConfig({
              negativePrompt:
                e.target.value.trim().length > 0
                  ? e.target.value
                  : undefined,
            })
          }
          className="w-full resize-none rounded-md border border-border/60 bg-background/40 px-2 py-1 text-xs"
        />
      </div>
    </div>
  );
}

export function hasHiggsfieldImageGenOverrides(
  config: HiggsfieldImageGenNodeConfig,
): boolean {
  return (
    config.aspectRatio !== undefined ||
    config.resolution !== undefined ||
    config.batchSize !== undefined ||
    config.seed !== undefined ||
    config.negativePrompt !== undefined ||
    config.styleId !== undefined
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/* Schema                                                                 */
/* ────────────────────────────────────────────────────────────────────── */

export const higgsfieldImageGenNodeSchema =
  defineNode<HiggsfieldImageGenNodeConfig>({
    kind: "higgsfield-image-gen",
    category: "ai-image",
    title: "Higgsfield Soul",
    description:
      "Generate photoreal images with Higgsfield Soul. Wire a Soul ID to lock the face; an optional reference image switches to Soul Reference mode.",
    icon: ImageIcon,
    inputs: [
      { id: "prompt", label: "prompt", dataType: "text" },
      { id: "soulId", label: "soul-id", dataType: "soul-id" },
      { id: "image", label: "image", dataType: "image" },
    ],
    outputs: [
      { id: "out", label: "out", dataType: "image", multiple: true },
    ],
    defaultConfig: {},
    reactive: false,
    execute: async ({ config, inputs, signal }) => {
      const prompt = (
        extractInputByType(inputs, "prompt", "text") ?? ""
      ).trim();
      if (prompt.length === 0) {
        throw new Error(
          "Prompt is empty — wire a Text node into the `prompt` handle.",
        );
      }

      const soulId = extractInputByType(inputs, "soulId", "soul-id");
      const refImage = extractInputByType(inputs, "image", "image");

      // Mode + variant dispatch. See the file header doc for the table.
      const variant = soulId?.variant ?? "none";
      let mode: SoulMode;
      let referenceUrl: string | undefined;
      let styleIdToSend: string | undefined;
      if (refImage?.url) {
        mode = "reference";
        referenceUrl = refImage.url;
      } else if (config.styleId) {
        mode = "style";
        styleIdToSend = config.styleId;
      } else {
        mode = "none";
      }

      const result = await callHiggsfieldImage({
        prompt,
        soulId: soulId?.customReferenceId,
        variant,
        mode,
        referenceUrl,
        styleId: styleIdToSend,
        aspectRatio: config.aspectRatio,
        resolution: config.resolution,
        batchSize: config.batchSize,
        seed: config.seed,
        negativePrompt: config.negativePrompt,
        signal,
      });

      const outputs: StandardizedOutput[] = result.imageUrls.map(
        (url) => {
          const ref: ImageRef = { url };
          return { type: "image", value: ref };
        },
      );

      return {
        output: outputs,
        usage: {
          // costUsd not exposed by Higgsfield (credits-based pricing only).
          model: result.model,
        },
      };
    },
    Body: HiggsfieldImageGenNodeBody,
    settings: {
      Content: HiggsfieldImageGenSettingsContent,
      hasOverrides: hasHiggsfieldImageGenOverrides,
    },
    size: {
      defaultWidth: 320,
      minWidth: 280,
      maxWidth: 720,
      minHeight: 120,
      maxHeight: 560,
      resizable: "both",
    },
  });

