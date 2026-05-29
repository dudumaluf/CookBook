"use client";

import { ImagePlus, Loader2, Sparkles, Wand2 } from "lucide-react";
import { useId, useState } from "react";

import { defineNode } from "@/lib/engine/define-node";
import {
  extractInputArrayByType,
  extractInputByType,
} from "@/lib/engine/extract-input";
import { callFalImage } from "@/lib/fal/call-fal-image";
import {
  FAL_IMAGE_MODEL_LABELS,
  FAL_IMAGE_MODELS,
  type FalImageModel,
  isRandomSeed,
  RANDOM_SEED,
  resolveSeed,
} from "@/lib/fal/types";
import { useExecutionStore } from "@/lib/stores/execution-store";
import type {
  ImageRef,
  NodeBodyProps,
  StandardizedOutput,
} from "@/types/node";

import { IteratorCursor } from "./iterator-cursor";

/**
 * Fal Image — multi-model image generation/edit (Slice F).
 *
 * One node, a model picker (Nano Banana 2 default, Flux 2, Seedream). Wire a
 * prompt; wire reference image(s) to switch the model into edit mode. Output
 * is the batch of generated images. Non-reactive (costs money).
 */
export interface FalImageNodeConfig {
  model?: FalImageModel;
  numImages?: number;
  seed?: number;
}

const DEFAULT_MODEL: FalImageModel = "nano-banana-2";

function hasOverrides(config: FalImageNodeConfig): boolean {
  return (
    (config.model !== undefined && config.model !== DEFAULT_MODEL) ||
    (config.numImages !== undefined && config.numImages !== 1) ||
    !isRandomSeed(config.seed)
  );
}

function FalImageBody({ nodeId, config }: NodeBodyProps<FalImageNodeConfig>) {
  const record = useExecutionStore((s) => s.records.get(nodeId));
  const status = record?.status;
  const history = record?.history ?? [];

  const [historyCursor, setHistoryCursor] = useState<number | null>(null);
  const effectiveCursor =
    history.length === 0
      ? 0
      : historyCursor === null || historyCursor >= history.length
        ? history.length - 1
        : Math.max(0, historyCursor);
  const activeOutput =
    history.length > 0 ? history[effectiveCursor]?.output : record?.output;

  const imageUrls: string[] = Array.isArray(activeOutput)
    ? activeOutput
        .filter((o): o is StandardizedOutput & { type: "image" } =>
          o.type === "image",
        )
        .map((o) => o.value.url)
    : activeOutput && !Array.isArray(activeOutput) && activeOutput.type === "image"
      ? [activeOutput.value.url]
      : [];

  return (
    <div className="flex w-full min-w-[280px] flex-col gap-2 px-3 pb-2.5 pt-0.5">
      <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
        <Sparkles className="h-3 w-3 text-accent" />
        <span className="font-medium">
          {FAL_IMAGE_MODEL_LABELS[config.model ?? DEFAULT_MODEL]}
        </span>
      </div>

      {history.length > 1 ? (
        <div className="flex items-center justify-between gap-2 text-[10.5px] text-muted-foreground">
          <IteratorCursor
            count={history.length}
            cursor={effectiveCursor}
            onCursorChange={(next) => setHistoryCursor(next)}
            ariaLabelPrefix="Generation"
          />
          <span className="text-muted-foreground/60">past runs</span>
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
        <div
          className="flex aspect-square w-full items-center justify-center rounded-md bg-foreground/[0.04] text-muted-foreground"
        >
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : imageUrls.length > 0 ? (
        <div
          className={
            imageUrls.length === 1 ? "" : "grid grid-cols-2 gap-1.5"
          }
        >
          {imageUrls.map((url, i) => (
            <a
              key={`${url}-${i}`}
              href={url}
              target="_blank"
              rel="noreferrer noopener"
              onPointerDown={(e) => e.stopPropagation()}
              className="block overflow-hidden rounded-md bg-foreground/5"
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
          <span>Wire a prompt, then Run</span>
        </div>
      )}
    </div>
  );
}

function FalImageSettings({
  config,
  updateConfig,
}: NodeBodyProps<FalImageNodeConfig>) {
  const modelId = useId();
  const numId = useId();
  const seedId = useId();

  return (
    <div className="flex flex-col gap-3 text-xs">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={modelId} className="font-medium text-foreground/90">
          Model
        </label>
        <select
          id={modelId}
          value={config.model ?? DEFAULT_MODEL}
          onChange={(e) =>
            updateConfig({ model: e.target.value as FalImageModel })
          }
          className="h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs"
        >
          {FAL_IMAGE_MODELS.map((m) => (
            <option key={m} value={m}>
              {FAL_IMAGE_MODEL_LABELS[m]}
            </option>
          ))}
        </select>
        <p className="flex items-center gap-1 text-[10.5px] text-muted-foreground/80">
          <Wand2 className="h-3 w-3" />
          Wire an image to switch into edit mode.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={numId} className="font-medium text-foreground/90">
          Images
        </label>
        <input
          id={numId}
          type="number"
          min={1}
          max={4}
          value={config.numImages ?? 1}
          onChange={(e) => updateConfig({ numImages: Number(e.target.value) })}
          className="h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs"
        />
      </div>

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
          step={1}
          placeholder="-1"
          value={config.seed ?? RANDOM_SEED}
          onChange={(e) => {
            const raw = e.target.value;
            updateConfig({
              seed: raw === "" ? RANDOM_SEED : Number(raw),
            });
          }}
          className="h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs"
        />
      </div>
    </div>
  );
}

export const falImageNodeSchema = defineNode<FalImageNodeConfig>({
  kind: "fal-image",
  category: "ai-image",
  title: "Fal Image",
  description:
    "Generate or edit images with Fal — Nano Banana 2 (default), Flux 2, or Seedream. Wire a prompt; wire reference image(s) to switch into edit mode.",
  icon: Sparkles,
  inputs: [
    { id: "prompt", label: "prompt", dataType: "text" },
    { id: "image", label: "image", dataType: "image", multiple: true },
  ],
  outputs: [{ id: "out", label: "out", dataType: "image", multiple: true }],
  defaultConfig: { model: DEFAULT_MODEL, seed: RANDOM_SEED },
  reactive: false,
  // seed === -1 (or unset) -> random each run -> bust the cache so pressing
  // Run again yields a fresh image without changing config.
  isCacheBusting: (config) => isRandomSeed(config.seed),
  execute: async ({ config, inputs, signal }) => {
    const prompt = (extractInputByType(inputs, "prompt", "text") ?? "").trim();
    if (prompt.length === 0) {
      throw new Error(
        "Prompt is empty — wire a Text node into the `prompt` handle.",
      );
    }
    const imageUrls = extractInputArrayByType(inputs, "image", "image")
      .map((r) => r.url)
      .filter(Boolean);

    const result = await callFalImage({
      model: config.model ?? DEFAULT_MODEL,
      prompt,
      ...(imageUrls.length ? { imageUrls } : {}),
      ...(config.numImages !== undefined ? { numImages: config.numImages } : {}),
      // Resolve -1 / unset to a concrete random seed each run.
      seed: resolveSeed(config.seed),
      signal,
    });

    const outputs: StandardizedOutput[] = result.imageUrls.map((url) => {
      const ref: ImageRef = { url };
      return { type: "image", value: ref };
    });
    return { output: outputs, usage: { model: result.model } };
  },
  Body: FalImageBody,
  settings: { Content: FalImageSettings, hasOverrides },
  size: {
    defaultWidth: 320,
    minWidth: 280,
    maxWidth: 720,
    resizable: "horizontal",
  },
});
