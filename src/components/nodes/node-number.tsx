"use client";

import { Hash } from "lucide-react";
import { useId } from "react";

import { defineNode } from "@/lib/engine/define-node";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import type { NodeBodyProps, StandardizedOutput } from "@/types/node";

/**
 * Number node (Slice 5.7).
 *
 * Emits a single `{ type: "number" }` output, with the same
 * `fixed | increment | decrement | random | range` selection vocabulary
 * the iterator family already uses. Designed primarily as a **remote
 * cursor** for the new List node — wire it into List's `cursor` input
 * to drive which item gets picked downstream — but useful standalone
 * any time a numeric parameter wants per-run mutation (seed, count,
 * etc.).
 *
 * Modes:
 * - `fixed` — emit `value`, no mutation.
 * - `increment` — emit `value`, then bump it by `step` (default 1) and
 *   wrap inside `[min, max]` if both are set.
 * - `decrement` — symmetric to increment.
 * - `random` — emit a uniform random number in `[min, max]`. When `min`
 *   and `max` aren't both set we fall back to `[0, 1)` for safety.
 * - `range` — alias of `fixed` for now (Number doesn't fan out — that's
 *   List + Number combined).
 *
 * `increment` / `decrement` / `random` mutate `config.value` after
 * emit by writing through the workflow-store, mirroring how iterators
 * mutate `cursor`. This keeps the run history readable: every "run"
 * gets a different value without the caller having to re-edit the
 * node manually.
 */

export type NumberNodeMode =
  | "fixed"
  | "increment"
  | "decrement"
  | "random";

export interface NumberNodeConfig {
  /** Current emitted value. Mutated in-place by increment/decrement/random. */
  value: number;
  /** How `value` evolves between runs. */
  mode: NumberNodeMode;
  /** Step size for increment / decrement. Defaults to 1. */
  step?: number;
  /** Lower bound for random + wrap-around in increment / decrement. */
  min?: number;
  /** Upper bound for random + wrap-around. */
  max?: number;
}

const NUMBER_MODES: NumberNodeMode[] = [
  "fixed",
  "increment",
  "decrement",
  "random",
];

const NUMBER_MODE_LABELS: Record<NumberNodeMode, string> = {
  fixed: "Fixed",
  increment: "Increment +",
  decrement: "Decrement −",
  random: "Random",
};

function clampWithBounds(
  value: number,
  min: number | undefined,
  max: number | undefined,
): number {
  if (min !== undefined && max !== undefined && min < max) {
    if (value < min) return max - ((min - value) % (max - min + 1));
    if (value > max) return min + ((value - min) % (max - min + 1));
  }
  return value;
}

function pickRandom(
  min: number | undefined,
  max: number | undefined,
): number {
  if (min !== undefined && max !== undefined && min <= max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
  return Math.random();
}

function NumberNodeBody({
  config,
  updateConfig,
}: NodeBodyProps<NumberNodeConfig>) {
  const valueId = useId();
  const stepId = useId();
  const minId = useId();
  const maxId = useId();

  const mode: NumberNodeMode = config.mode ?? "fixed";

  return (
    <div className="flex w-full min-w-[200px] flex-col gap-1.5 px-3 pb-2.5 pt-0.5">
      <div className="flex items-center gap-2">
        <label
          htmlFor={valueId}
          className="text-[10.5px] uppercase tracking-wider text-muted-foreground"
        >
          Value
        </label>
        <input
          id={valueId}
          type="number"
          value={Number.isFinite(config.value) ? config.value : 0}
          onChange={(e) => {
            const next = Number(e.target.value);
            if (Number.isFinite(next)) updateConfig({ value: next });
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="h-7 flex-1 rounded-md border border-border/60 bg-background/40 px-2 text-xs tabular-nums"
        />
        <span
          data-testid="number-mode-chip"
          className="select-none rounded-md bg-foreground/[0.04] px-1.5 py-0.5 text-[10.5px] text-muted-foreground"
        >
          {mode}
        </span>
      </div>

      {mode === "increment" || mode === "decrement" ? (
        <div className="flex items-center gap-2">
          <label
            htmlFor={stepId}
            className="text-[10.5px] uppercase tracking-wider text-muted-foreground"
          >
            Step
          </label>
          <input
            id={stepId}
            type="number"
            value={config.step ?? 1}
            min={0}
            onChange={(e) => {
              const next = Number(e.target.value);
              if (Number.isFinite(next)) updateConfig({ step: next });
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="h-7 flex-1 rounded-md border border-border/60 bg-background/40 px-2 text-xs tabular-nums"
          />
        </div>
      ) : null}

      {(mode === "random" ||
        mode === "increment" ||
        mode === "decrement") && (
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor={minId} className="text-[10.5px] text-muted-foreground">
              Min
            </label>
            <input
              id={minId}
              type="number"
              value={config.min ?? ""}
              placeholder="—"
              onChange={(e) =>
                updateConfig({
                  min:
                    e.target.value === ""
                      ? undefined
                      : Number(e.target.value),
                })
              }
              onPointerDown={(e) => e.stopPropagation()}
              className="h-7 rounded-md border border-border/60 bg-background/40 px-2 text-xs tabular-nums"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={maxId} className="text-[10.5px] text-muted-foreground">
              Max
            </label>
            <input
              id={maxId}
              type="number"
              value={config.max ?? ""}
              placeholder="—"
              onChange={(e) =>
                updateConfig({
                  max:
                    e.target.value === ""
                      ? undefined
                      : Number(e.target.value),
                })
              }
              onPointerDown={(e) => e.stopPropagation()}
              className="h-7 rounded-md border border-border/60 bg-background/40 px-2 text-xs tabular-nums"
            />
          </div>
        </div>
      )}

      {/* Body left intentionally compact — mode is a settings-popover
          knob (not a body inline) since changing mode is a deliberate
          edit, not a run-time tweak. */}
      <ModePicker
        mode={mode}
        onChange={(m) => updateConfig({ mode: m })}
      />
    </div>
  );
}

function ModePicker({
  mode,
  onChange,
}: {
  mode: NumberNodeMode;
  onChange: (m: NumberNodeMode) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <label
        htmlFor={id}
        className="text-[10.5px] uppercase tracking-wider text-muted-foreground"
      >
        Mode
      </label>
      <select
        id={id}
        value={mode}
        onChange={(e) => onChange(e.target.value as NumberNodeMode)}
        onPointerDown={(e) => e.stopPropagation()}
        className="h-7 flex-1 rounded-md border border-border/60 bg-background/40 px-2 text-xs"
      >
        {NUMBER_MODES.map((m) => (
          <option key={m} value={m}>
            {NUMBER_MODE_LABELS[m]}
          </option>
        ))}
      </select>
    </div>
  );
}

export const numberNodeSchema = defineNode<NumberNodeConfig>({
  kind: "number",
  category: "input",
  title: "Number",
  description:
    "Emit a number with optional fixed / increment / decrement / random behaviour. Wire to List's cursor input to drive remote selection.",
  icon: Hash,
  inputs: [],
  outputs: [{ id: "out", label: "out", dataType: "number" }],
  defaultConfig: {
    value: 0,
    mode: "fixed",
  },
  reactive: true,
  execute: async ({ nodeId, config }) => {
    const mode: NumberNodeMode = config.mode ?? "fixed";
    const value = Number.isFinite(config.value) ? config.value : 0;
    const step = Number.isFinite(config.step) ? (config.step as number) : 1;

    let emitted = value;
    let nextValue = value;

    if (mode === "fixed") {
      emitted = value;
      nextValue = value;
    } else if (mode === "increment") {
      emitted = value;
      nextValue = clampWithBounds(value + step, config.min, config.max);
    } else if (mode === "decrement") {
      emitted = value;
      nextValue = clampWithBounds(value - step, config.min, config.max);
    } else if (mode === "random") {
      emitted = pickRandom(config.min, config.max);
      nextValue = emitted;
    }

    if (nextValue !== value) {
      const ws = useWorkflowStore.getState();
      ws.updateNodeConfig<NumberNodeConfig>(nodeId, { value: nextValue });
    }

    const out: StandardizedOutput = { type: "number", value: emitted };
    return out;
  },
  Body: NumberNodeBody,
  size: {
    defaultWidth: 220,
    minWidth: 200,
    maxWidth: 360,
    resizable: "horizontal",
  },
});
