"use client";

import {
  AlertCircle,
  Check,
  Image as ImageIcon,
  ImagePlus,
  Loader2,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useId, useState } from "react";

import { defineNode } from "@/lib/engine/define-node";
import {
  callHiggsfieldImage,
  fetchSoulStyles,
  HiggsfieldCallError,
} from "@/lib/higgsfield/call-higgsfield-image";
import {
  SOUL_ASPECT_RATIOS,
  SOUL_BATCH_SIZES,
  SOUL_RESOLUTIONS,
  type HiggsfieldSoulStyle,
  type SoulAspectRatio,
  type SoulBatchSize,
  type SoulMode,
  type SoulResolution,
} from "@/lib/higgsfield/types";
import { extractInputByType } from "@/lib/engine/extract-input";
import { useExecutionStore } from "@/lib/stores/execution-store";
import { parseAspectRatio } from "@/lib/utils/aspect-ratio";
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

  // Slice 5.6.2 — drive the placeholder + single-result preview off the
  // configured `aspectRatio` (so a "9:16" generation paints a portrait
  // box even before the image lands). Grid cells in 2x2 / 4x batches
  // stay square — that's a layout tile, not an aspect-faithful preview.
  const configuredAspect =
    parseAspectRatio(config.aspectRatio)?.cssAspect ?? "1 / 1";

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
        <div
          data-testid="higgsfield-running"
          className="flex w-full items-center justify-center rounded-md bg-foreground/[0.04] text-muted-foreground"
          style={{ aspectRatio: configuredAspect }}
        >
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : imageUrls.length === 1 ? (
        // Single-result path: aspect-faithful preview — the result was
        // generated AT the configured ratio so config = real.
        <a
          href={imageUrls[0]!}
          target="_blank"
          rel="noreferrer noopener"
          onPointerDown={(e) => e.stopPropagation()}
          data-testid="higgsfield-result-single"
          className="block w-full overflow-hidden rounded-md bg-foreground/5"
          style={{ aspectRatio: configuredAspect }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrls[0]!}
            alt="Generated"
            className="h-full w-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        </a>
      ) : imageUrls.length > 1 ? (
        // Multi-result grid: cells stay square. The grid is a layout
        // tile, not a preview of the content — uniform squares give a
        // legible 2x2 / 4x silhouette regardless of the source ratio.
        <div className="grid grid-cols-2 gap-1.5">
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

      {/* Style preset picker ----------------------------------------- */}
      <SoulStylePicker
        styleId={config.styleId}
        onChange={(next) => updateConfig({ styleId: next })}
      />
      <p className="-mt-1.5 text-[10.5px] text-muted-foreground/80">
        Wire a reference image to use Soul Reference mode instead. Style
        and reference are mutually exclusive.
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
/* Soul Style picker (Slice 5.3)                                          */
/* ────────────────────────────────────────────────────────────────────── */

/**
 * Thumbnail-grid picker for the curated v2 Soul Style presets. Replaces
 * the raw-UUID input that shipped in Slice 4.3. Lazily fetches the catalog
 * the first time the popover renders the picker — re-fetches on every
 * mount because the popover lives in a Portal and doesn't keep state
 * across opens.
 *
 * States:
 *   - loading       → centered spinner, "Loading styles…"
 *   - error         → inline alert pill with the upstream message; the
 *                     selected styleId (if any) stays usable as a chip
 *                     so re-opens don't blow away a working selection.
 *   - empty array   → "No styles available" copy (would be a regression
 *                     from Higgsfield, but defensive).
 *   - loaded        → 2-column thumbnail grid with names; click selects;
 *                     "None" chip clears the selection.
 *
 * The grid intentionally caps height at ~14 rem and scrolls inside the
 * popover so the rest of the settings (negative prompt, etc.) stay
 * reachable on smaller viewports.
 */
function SoulStylePicker({
  styleId,
  onChange,
}: {
  styleId: string | undefined;
  onChange: (next: string | undefined) => void;
}) {
  const [styles, setStyles] = useState<HiggsfieldSoulStyle[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchSoulStyles(ctrl.signal)
      .then((next) => {
        if (!ctrl.signal.aborted) setStyles(next);
      })
      .catch((err) => {
        if ((err as Error)?.name === "AbortError") return;
        const msg =
          err instanceof HiggsfieldCallError
            ? err.code === "missing_keys"
              ? "Higgsfield keys missing — set HIGGSFIELD_API_KEY + HIGGSFIELD_API_SECRET in .env.local."
              : err.message
            : err instanceof Error
              ? err.message
              : "Failed to load styles";
        setError(msg);
      });
    return () => ctrl.abort();
  }, []);

  const selected =
    styleId && styles
      ? (styles.find((s) => s.id === styleId) ?? null)
      : null;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="font-medium text-foreground/90">
          Soul Style preset
        </span>
        {styleId !== undefined ? (
          <button
            type="button"
            onClick={() => onChange(undefined)}
            onPointerDown={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 text-[10.5px] text-muted-foreground hover:text-foreground"
          >
            <X className="h-2.5 w-2.5" /> Clear
          </button>
        ) : null}
      </div>

      {/* If a style is selected, surface its name even while loading so a
          slow network doesn't make the user feel like they lost it. */}
      {selected ? (
        <div className="flex items-center gap-2 rounded-md border border-accent/40 bg-accent/[0.06] px-2 py-1.5 text-[11px]">
          {selected.previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={selected.previewUrl}
              alt=""
              className="h-7 w-7 shrink-0 rounded object-cover"
            />
          ) : null}
          <span className="truncate font-medium text-foreground/90">
            {selected.name}
          </span>
        </div>
      ) : null}

      {error !== null ? (
        <p
          role="alert"
          className="flex items-start gap-1.5 rounded-md bg-destructive/10 px-2 py-1.5 text-[10.5px] leading-snug text-destructive"
        >
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>{error}</span>
        </p>
      ) : styles === null ? (
        <div className="flex items-center justify-center gap-2 rounded-md bg-foreground/[0.04] px-2 py-3 text-[10.5px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>Loading styles…</span>
        </div>
      ) : styles.length === 0 ? (
        <p className="rounded-md bg-foreground/[0.04] px-2 py-3 text-center text-[10.5px] text-muted-foreground">
          No styles available
        </p>
      ) : (
        <div
          data-testid="soul-style-grid"
          className="grid max-h-[14rem] grid-cols-2 gap-1 overflow-y-auto rounded-md border border-border/40 bg-foreground/[0.02] p-1"
        >
          {styles.map((s) => {
            const isActive = s.id === styleId;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onChange(s.id)}
                onPointerDown={(e) => e.stopPropagation()}
                aria-pressed={isActive}
                className={`group/style relative flex flex-col gap-0.5 overflow-hidden rounded-md border bg-foreground/[0.03] p-0.5 text-left transition-colors hover:bg-foreground/[0.06] ${
                  isActive ? "border-accent/70" : "border-transparent"
                }`}
              >
                {s.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={s.previewUrl}
                    alt=""
                    loading="lazy"
                    className="aspect-square w-full rounded-sm object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                ) : (
                  <div className="aspect-square w-full rounded-sm bg-foreground/[0.06]" />
                )}
                <span className="truncate px-1 pb-0.5 text-[10px] text-foreground/80">
                  {s.name}
                </span>
                {isActive ? (
                  <span
                    aria-hidden
                    className="absolute right-1 top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-accent text-accent-foreground"
                  >
                    <Check className="h-2.5 w-2.5" />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
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
    // Width-only resize. Slice 5.6.2 made the preview aspect-ratio-aware
    // (placeholder uses `config.aspectRatio`, single-result follows the
    // same, grid 2x2 stays square). A "both"-axis handle would let the
    // user drag a height that doesn't match the preview's intrinsic
    // ratio — the inner `<a>` would then either overflow the card
    // (current bug) or letterbox with empty bands. Locking to horizontal
    // is the same contract as Image and Image Iterator (ADR-0028 +
    // Slice 5.6.2): height always follows aspect.
    size: {
      defaultWidth: 320,
      minWidth: 280,
      maxWidth: 720,
      resizable: "horizontal",
    },
  });

