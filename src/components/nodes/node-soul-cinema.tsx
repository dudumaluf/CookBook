"use client";

import { Clapperboard, ImagePlus, Loader2 } from "lucide-react";
import { useId } from "react";

import { defineNode } from "@/lib/engine/define-node";
import { callHiggsfieldImage } from "@/lib/higgsfield/call-higgsfield-image";
import {
  SOUL_BATCH_SIZES,
  SOUL_CINEMA_ASPECT_RATIOS,
  SOUL_RESOLUTIONS,
  type SoulBatchSize,
  type SoulCinemaAspectRatio,
  type SoulMode,
  type SoulResolution,
} from "@/lib/higgsfield/types";
import { extractInputByType } from "@/lib/engine/extract-input";
import { isRandomSeed, RANDOM_SEED, resolveSeed } from "@/lib/utils/seed";
import { useExecutionStore } from "@/lib/stores/execution-store";
import { parseAspectRatio } from "@/lib/utils/aspect-ratio";
import type {
  ImageRef,
  NodeBodyProps,
  StandardizedOutput,
} from "@/types/node";

import { IteratorCursor } from "./iterator-cursor";
import { MediaPreviewPlaceholder } from "./media-preview";
import { MultiImageView } from "./multi-image-view";
import { useNodeHistoryCursor } from "./use-node-history-cursor";

/**
 * Soul Cinema — the executable node for Higgsfield's `soul/cinema` model.
 *
 * Soul Cinema is a cinematic text-to-image variant of Soul: same prompt /
 * resolution / batch / seed knobs as the standard Soul node, but it always
 * dispatches to `higgsfield-ai/soul/cinema` and adds the ultra-wide `21:9`
 * aspect ratio the standard endpoint snaps away. It deliberately has NO
 * style-preset picker — the cinema endpoint 400s on any `style_id`
 * ("Provided Soul style not found").
 *
 * Inputs (all single):
 *   - prompt  (text)   — required at execute() time
 *   - image   (image)  — optional reference image → Soul Reference mode
 *   - soulId  (soul-id)— optional Soul ID character. NOTE: the cinema
 *                        endpoint only honours a *cinema-trained* character;
 *                        a v1/v2 Soul ID is silently ignored upstream (it
 *                        still renders, just without the locked face).
 *
 * Outputs:
 *   - out (image, multi) — the batched URLs from Higgsfield (1 or 4)
 *
 * Body / settings mirror the standard Soul node (ADR-0027 `⋯` slot,
 * Slice 5.6.2 aspect-aware preview, Slice 5.8 history cursor) so the two
 * feel like siblings.
 */
export interface SoulCinemaNodeConfig {
  aspectRatio?: SoulCinemaAspectRatio;
  resolution?: SoulResolution;
  batchSize?: SoulBatchSize;
  seed?: number;
  negativePrompt?: string;
  /**
   * Let Higgsfield internally expand the prompt for richer cinematic
   * conditioning. Defaults to `true` (matches the model's API default +
   * the official Web UI). Toggle off to keep the prompt verbatim.
   */
  enhancePrompt?: boolean;
  /** Multi-image preview mode — `"grid"` (default) or `"single"`. */
  viewMode?: "grid" | "single";
  /** Focused image index in single-mode (0-based, clamped on render). */
  previewIndex?: number;
}

const DEFAULT_ASPECT: SoulCinemaAspectRatio = "16:9";
const DEFAULT_RESOLUTION: SoulResolution = "720p";
const DEFAULT_BATCH: SoulBatchSize = 1;

/* ────────────────────────────────────────────────────────────────────── */
/* Body                                                                   */
/* ────────────────────────────────────────────────────────────────────── */

function SoulCinemaNodeBody({
  nodeId,
  config,
  updateConfig,
}: NodeBodyProps<SoulCinemaNodeConfig>) {
  const record = useExecutionStore((s) => s.records.get(nodeId));
  const status = record?.status;
  const history = record?.history ?? [];

  const { cursor, setCursor } = useNodeHistoryCursor(nodeId, history.length);

  const activeOutput =
    history.length > 0 ? history[cursor]?.output : record?.output;

  const imageUrls: string[] =
    activeOutput && Array.isArray(activeOutput)
      ? activeOutput
          .filter(
            (o): o is StandardizedOutput & { type: "image" } =>
              o.type === "image",
          )
          .map((o) => o.value.url)
      : activeOutput &&
          !Array.isArray(activeOutput) &&
          activeOutput.type === "image"
        ? [activeOutput.value.url]
        : [];

  const configuredAspect =
    parseAspectRatio(config.aspectRatio ?? DEFAULT_ASPECT)?.cssAspect ??
    "16 / 9";

  return (
    <div className="flex w-full min-w-[280px] flex-col gap-2 px-3 pb-2.5 pt-0.5">
      {/* Status / metadata strip — always present, very small. */}
      <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
        <Clapperboard className="h-3 w-3 text-accent" />
        <span className="font-medium">Soul Cinema</span>
        <span className="text-muted-foreground/60">·</span>
        <span>{config.aspectRatio ?? DEFAULT_ASPECT}</span>
        <span className="text-muted-foreground/60">·</span>
        <span>{config.resolution ?? DEFAULT_RESOLUTION}</span>
        <span className="text-muted-foreground/60">·</span>
        <span>×{config.batchSize ?? DEFAULT_BATCH}</span>
      </div>

      <div className="relative">
        {history.length > 1 ? (
          <div
            data-testid="soul-cinema-history-cursor"
            className="absolute right-1 top-1 z-10"
          >
            <IteratorCursor
              count={history.length}
              cursor={cursor}
              onCursorChange={setCursor}
              ariaLabelPrefix="Generation"
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
          <MediaPreviewPlaceholder
            aspectRatio={configuredAspect}
            testId="soul-cinema-running"
          >
            <Loader2 className="h-5 w-5 animate-spin" />
          </MediaPreviewPlaceholder>
        ) : imageUrls.length > 0 ? (
          <MultiImageView
            imageUrls={imageUrls}
            viewMode={config.viewMode}
            previewIndex={config.previewIndex}
            aspectRatio={configuredAspect}
            gridTileAspectRatio="1 / 1"
            onViewModeChange={(next) => updateConfig({ viewMode: next })}
            onPreviewIndexChange={(next) =>
              updateConfig({ previewIndex: next })
            }
            testIdPrefix="soul-cinema-result"
          />
        ) : (
          <div className="flex items-center gap-2 rounded-md border border-dashed border-border/40 bg-foreground/[0.02] px-2 py-2 text-[11px] text-muted-foreground">
            <ImagePlus className="h-3 w-3" />
            <span>Connect a prompt then click Run</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/* Settings popover content                                               */
/* ────────────────────────────────────────────────────────────────────── */

function SoulCinemaSettingsContent({
  config,
  updateConfig,
}: NodeBodyProps<SoulCinemaNodeConfig>) {
  const aspectId = useId();
  const resolutionId = useId();
  const batchId = useId();
  const seedId = useId();
  const enhanceId = useId();
  const negPromptId = useId();

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
              aspectRatio: e.target.value as SoulCinemaAspectRatio,
            })
          }
          className="h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs"
        >
          {SOUL_CINEMA_ASPECT_RATIOS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <p className="text-[10.5px] text-muted-foreground/80">
          Cinema adds ultra-wide 21:9 on top of the standard ratios.
        </p>
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
            (-1 = random each run)
          </span>
        </label>
        <input
          id={seedId}
          type="number"
          min={-1}
          max={1_000_000}
          step={1}
          placeholder="-1"
          value={config.seed ?? RANDOM_SEED}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") {
              updateConfig({ seed: RANDOM_SEED });
              return;
            }
            const parsed = Number(raw);
            if (parsed === RANDOM_SEED) {
              updateConfig({ seed: RANDOM_SEED });
              return;
            }
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

      {/* Enhance prompt ---------------------------------------------- */}
      <label
        htmlFor={enhanceId}
        className="flex items-start gap-2 text-foreground/90"
      >
        <input
          id={enhanceId}
          type="checkbox"
          checked={config.enhancePrompt ?? true}
          onChange={(e) => updateConfig({ enhancePrompt: e.target.checked })}
          onPointerDown={(e) => e.stopPropagation()}
          className="mt-0.5 h-3.5 w-3.5 shrink-0"
        />
        <span className="flex flex-col gap-0.5">
          <span className="font-medium">Enhance prompt</span>
          <span className="text-[10.5px] font-normal text-muted-foreground/80">
            Let Soul expand the prompt for a richer cinematic look. Turn off
            to render the prompt verbatim.
          </span>
        </span>
      </label>

      {/* Reference vs style note ------------------------------------- */}
      <p className="rounded-md border border-border/40 bg-foreground/[0.02] px-2 py-1.5 text-[10.5px] leading-snug text-muted-foreground/80">
        Soul Cinema has no style presets. Wire a reference image for Soul
        Reference mode, or a <strong>cinema-trained</strong> Soul ID to lock
        a face.
      </p>

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

export function hasSoulCinemaOverrides(config: SoulCinemaNodeConfig): boolean {
  return (
    config.aspectRatio !== undefined ||
    config.resolution !== undefined ||
    config.batchSize !== undefined ||
    !isRandomSeed(config.seed) ||
    config.negativePrompt !== undefined ||
    config.enhancePrompt === false
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/* Schema                                                                 */
/* ────────────────────────────────────────────────────────────────────── */

export const soulCinemaNodeSchema = defineNode<SoulCinemaNodeConfig>({
  kind: "soul-cinema",
  category: "ai-image",
  title: "Soul Cinema",
  description:
    "Cinematic text-to-image with Higgsfield Soul Cinema (always hits soul/cinema). Adds ultra-wide 21:9. Wire an optional reference image for Soul Reference, or a cinema-trained Soul ID to lock a face. No style presets (cinema rejects them).",
  icon: Clapperboard,
  inputs: [
    { id: "prompt", label: "prompt", dataType: "text" },
    { id: "image", label: "image", dataType: "image" },
    { id: "soulId", label: "soul-id", dataType: "soul-id" },
  ],
  outputs: [{ id: "out", label: "out", dataType: "image", multiple: true }],
  defaultConfig: { seed: RANDOM_SEED, enhancePrompt: true },
  reactive: false,
  // seed === -1 (or unset) -> random each run -> bust the cache so pressing
  // Run again yields a fresh image without changing config.
  isCacheBusting: (config) => isRandomSeed(config.seed),
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

    // Cinema is always the endpoint here (the node's whole point). A
    // reference image switches to Soul Reference mode; otherwise pure
    // prompt (+ optional cinema-trained Soul ID). Style mode is never
    // used — the cinema endpoint 400s on any style_id.
    let mode: SoulMode = "none";
    let referenceUrl: string | undefined;
    if (refImage?.url) {
      mode = "reference";
      referenceUrl = refImage.url;
    }

    const result = await callHiggsfieldImage({
      prompt,
      soulId: soulId?.customReferenceId,
      variant: "cinema",
      mode,
      referenceUrl,
      aspectRatio: config.aspectRatio ?? DEFAULT_ASPECT,
      resolution: config.resolution,
      batchSize: config.batchSize,
      // Resolve -1 / unset to a concrete random seed (1..1,000,000).
      seed: resolveSeed(config.seed, 1_000_000),
      negativePrompt: config.negativePrompt,
      enhancePrompt: config.enhancePrompt,
      signal,
    });

    const outputs: StandardizedOutput[] = result.imageUrls.map((url) => {
      const ref: ImageRef = { url };
      return { type: "image", value: ref };
    });

    return {
      output: outputs,
      usage: {
        // costUsd not exposed by Higgsfield (credits-based pricing only).
        model: result.model,
      },
    };
  },
  Body: SoulCinemaNodeBody,
  settings: {
    Content: SoulCinemaSettingsContent,
    hasOverrides: hasSoulCinemaOverrides,
  },
  // Corner resize with aspect-aware preview — same contract as the
  // standard Soul node (Slice 5.6.2): height tracks the configured aspect.
  size: {
    defaultWidth: 320,
    minWidth: 280,
    maxWidth: 720,
    resizable: "both",
  },
});
