"use client";

import { RotateCcw } from "lucide-react";

import {
  BLEND_MODES,
  clampCanvas,
  type BlendMode,
  type ComposerDocument,
  type ComposerLayer,
  type LayerFit,
  type LayerMask,
  type LayerTransform,
} from "@/types/composer";
import type { ImageRef } from "@/types/node";

/**
 * Composer properties panel — numeric / precise controls for the canvas and
 * the selected layer. Complements the direct-manipulation stage: drag for
 * feel, type here for exactness.
 */

interface ComposerPropertiesPanelProps {
  doc: ComposerDocument;
  selected: ComposerLayer | null;
  inputs: Record<string, ImageRef>;
  onPatchDoc: (patch: Partial<ComposerDocument>) => void;
  onPatchLayer: (id: string, patch: Partial<ComposerLayer>) => void;
  onPatchTransform: (id: string, patch: Partial<LayerTransform>) => void;
}

function handleLabel(handle: string): string {
  const n = Number(handle.replace(/\D/g, ""));
  return Number.isFinite(n) ? `layer ${n + 1}` : handle;
}

const INPUT_CLS =
  "h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs outline-none focus:border-accent/60";
const FIELD_CLS = "flex flex-col gap-1";
const LABEL_CLS = "text-[10px] font-medium uppercase tracking-wide text-muted-foreground";

const CANVAS_PRESETS: ReadonlyArray<{ label: string; w: number; h: number }> = [
  { label: "1:1", w: 1024, h: 1024 },
  { label: "16:9", w: 1920, h: 1080 },
  { label: "9:16", w: 1080, h: 1920 },
  { label: "4:5", w: 1080, h: 1350 },
  { label: "3:2", w: 1500, h: 1000 },
];

function NumberField({
  label,
  value,
  onCommit,
  step = 1,
  suffix,
}: {
  label: string;
  value: number;
  onCommit: (n: number) => void;
  step?: number;
  suffix?: string;
}) {
  return (
    <label className={FIELD_CLS}>
      <span className={LABEL_CLS}>
        {label}
        {suffix ? <span className="ml-0.5 normal-case">{suffix}</span> : null}
      </span>
      <input
        type="number"
        step={step}
        value={Number.isFinite(value) ? Math.round(value * 100) / 100 : 0}
        onPointerDown={(e) => e.stopPropagation()}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onCommit(n);
        }}
        className={INPUT_CLS}
      />
    </label>
  );
}

export function ComposerPropertiesPanel({
  doc,
  selected,
  inputs,
  onPatchDoc,
  onPatchLayer,
  onPatchTransform,
}: ComposerPropertiesPanelProps) {
  const wiredHandles = Object.keys(inputs).sort(
    (a, b) => Number(a.replace(/\D/g, "")) - Number(b.replace(/\D/g, "")),
  );
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Canvas section */}
      <section className="border-b border-border/40 p-3">
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Canvas
        </h3>
        <div className="mb-2 grid grid-cols-2 gap-2">
          <NumberField
            label="Width"
            value={doc.width}
            onCommit={(n) => onPatchDoc({ width: clampCanvas(n, doc.width) })}
          />
          <NumberField
            label="Height"
            value={doc.height}
            onCommit={(n) => onPatchDoc({ height: clampCanvas(n, doc.height) })}
          />
        </div>
        <div className="mb-2 flex flex-wrap gap-1">
          {CANVAS_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => onPatchDoc({ width: p.w, height: p.h })}
              className="rounded-md border border-border/60 bg-background/40 px-2 py-1 text-[10.5px] text-foreground/80 hover:bg-foreground/[0.06]"
            >
              {p.label}
            </button>
          ))}
        </div>
        <label className={FIELD_CLS}>
          <span className={LABEL_CLS}>Background</span>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={doc.background ?? "#000000"}
              onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) => onPatchDoc({ background: e.target.value })}
              className="h-7 w-9 shrink-0 rounded border border-border/60 bg-transparent"
            />
            <button
              type="button"
              onClick={() => onPatchDoc({ background: null })}
              className={`rounded-md border border-border/60 px-2 py-1 text-[10.5px] ${
                doc.background === null
                  ? "bg-accent/15 text-foreground"
                  : "bg-background/40 text-foreground/70 hover:bg-foreground/[0.06]"
              }`}
            >
              Transparent
            </button>
          </div>
        </label>
      </section>

      {/* Layer section */}
      {selected ? (
        <section className="p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Layer
            </h3>
            <button
              type="button"
              aria-label="Reset transform"
              onClick={() =>
                onPatchTransform(selected.id, {
                  xPct: 0.5,
                  yPct: 0.5,
                  scale: 1,
                  rotationDeg: 0,
                })
              }
              className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/40 px-1.5 py-0.5 text-[10px] text-foreground/70 hover:bg-foreground/[0.06]"
            >
              <RotateCcw className="h-3 w-3" />
              Reset
            </button>
          </div>

          <label className={`${FIELD_CLS} mb-2`}>
            <span className={LABEL_CLS}>Name</span>
            <input
              type="text"
              value={selected.name}
              onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) => onPatchLayer(selected.id, { name: e.target.value })}
              className={INPUT_CLS}
            />
          </label>

          <div className="mb-2 grid grid-cols-2 gap-2">
            <NumberField
              label="X"
              suffix="%"
              value={selected.transform.xPct * 100}
              onCommit={(n) => onPatchTransform(selected.id, { xPct: n / 100 })}
            />
            <NumberField
              label="Y"
              suffix="%"
              value={selected.transform.yPct * 100}
              onCommit={(n) => onPatchTransform(selected.id, { yPct: n / 100 })}
            />
            <NumberField
              label="Scale"
              suffix="%"
              value={selected.transform.scale * 100}
              onCommit={(n) =>
                onPatchTransform(selected.id, { scale: n / 100 })
              }
            />
            <NumberField
              label="Rotate"
              suffix="°"
              value={selected.transform.rotationDeg}
              onCommit={(n) =>
                onPatchTransform(selected.id, { rotationDeg: n })
              }
            />
          </div>

          <label className={`${FIELD_CLS} mb-2`}>
            <span className={LABEL_CLS}>
              Opacity {Math.round(selected.opacity * 100)}%
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(selected.opacity * 100)}
              onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) =>
                onPatchLayer(selected.id, {
                  opacity: Number(e.target.value) / 100,
                })
              }
              className="w-full accent-[var(--color-accent)]"
            />
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className={FIELD_CLS}>
              <span className={LABEL_CLS}>Blend</span>
              <select
                value={selected.blendMode}
                onPointerDown={(e) => e.stopPropagation()}
                onChange={(e) =>
                  onPatchLayer(selected.id, {
                    blendMode: e.target.value as BlendMode,
                  })
                }
                className={INPUT_CLS}
              >
                {BLEND_MODES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label className={FIELD_CLS}>
              <span className={LABEL_CLS}>Fit</span>
              <select
                value={selected.fit}
                onPointerDown={(e) => e.stopPropagation()}
                onChange={(e) =>
                  onPatchLayer(selected.id, { fit: e.target.value as LayerFit })
                }
                className={INPUT_CLS}
              >
                <option value="contain">contain</option>
                <option value="cover">cover</option>
                <option value="stretch">stretch</option>
                <option value="none">none (natural)</option>
              </select>
            </label>
          </div>

          <MaskControls
            layer={selected}
            wiredHandles={wiredHandles}
            onSetMask={(mask) => onPatchLayer(selected.id, { mask })}
          />
        </section>
      ) : (
        <p className="p-3 text-[11px] text-muted-foreground">
          Select a layer to edit its transform, opacity, and blend mode.
        </p>
      )}
    </div>
  );
}

function MaskControls({
  layer,
  wiredHandles,
  onSetMask,
}: {
  layer: ComposerLayer;
  wiredHandles: string[];
  onSetMask: (mask: LayerMask | undefined) => void;
}) {
  const mask = layer.mask;
  const pillBtn =
    "rounded-md border border-border/60 bg-background/40 px-2 py-1 text-[10.5px] text-foreground/80 hover:bg-foreground/[0.06]";
  return (
    <div className="mt-3 border-t border-border/30 pt-3">
      <div className="mb-2 flex items-center justify-between">
        <h4 className={LABEL_CLS}>Mask</h4>
        {mask ? (
          <button
            type="button"
            onClick={() => onSetMask(undefined)}
            className="text-[10px] text-muted-foreground hover:text-destructive"
          >
            Remove
          </button>
        ) : null}
      </div>

      {mask ? (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2">
            <label className={FIELD_CLS}>
              <span className={LABEL_CLS}>Type</span>
              <select
                value={mask.mode}
                onPointerDown={(e) => e.stopPropagation()}
                onChange={(e) =>
                  onSetMask({ ...mask, mode: e.target.value as "alpha" | "luma" })
                }
                className={INPUT_CLS}
              >
                <option value="alpha">alpha</option>
                <option value="luma">luma</option>
              </select>
            </label>
            <label className="flex items-end gap-1.5 pb-1 text-[11px] text-foreground/80">
              <input
                type="checkbox"
                checked={mask.invert}
                onChange={(e) => onSetMask({ ...mask, invert: e.target.checked })}
              />
              invert
            </label>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Matte:{" "}
            {mask.source.kind === "input"
              ? handleLabel(mask.source.inputHandle ?? "")
              : "URL"}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {wiredHandles.length > 0 ? (
            <select
              value=""
              onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) => {
                if (e.target.value) {
                  onSetMask({
                    source: { kind: "input", inputHandle: e.target.value },
                    mode: "alpha",
                    invert: false,
                  });
                }
              }}
              className={INPUT_CLS}
            >
              <option value="">Use an input as mask…</option>
              {wiredHandles.map((h) => (
                <option key={h} value={h}>
                  {handleLabel(h)}
                </option>
              ))}
            </select>
          ) : null}
          <button
            type="button"
            className={pillBtn}
            onClick={() => {
              const url = window.prompt("Mask image URL");
              if (url && /^https?:\/\//i.test(url.trim())) {
                onSetMask({
                  source: { kind: "url", url: url.trim() },
                  mode: "alpha",
                  invert: false,
                });
              }
            }}
          >
            Mask from URL…
          </button>
        </div>
      )}
    </div>
  );
}
