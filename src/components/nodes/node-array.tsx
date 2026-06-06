"use client";

import { Brackets } from "lucide-react";
import { useId } from "react";

import { defineNode } from "@/lib/engine/define-node";
import { extractInputByType } from "@/lib/engine/extract-input";
import { useExecutionStore } from "@/lib/stores/execution-store";
import type { NodeBodyProps, StandardizedOutput } from "@/types/node";

/**
 * Array node (Slice 5.7).
 *
 * Splits an upstream `text` value by a delimiter and emits an **array**
 * of `{ type: "text" }` outputs. The schema's `iterator: true` flag
 * tells the engine this is a fan-out source: any single-input downstream
 * gets one execution per item, capped by `maxConcurrent` (ADR-0030).
 *
 * Two knobs, both inline in the body:
 * - `delimiter` — character / substring to split on. Empty string =
 *   one item per character.
 * - `trim` — whether to trim each item before emitting. Empty trimmed
 *   items are dropped to match the "8 prompts, one per line" intuition.
 *
 * Out of scope: regex split, max-N cap, paste-from-csv import. All
 * easy to add but parked until a concrete recipe asks for them.
 */

export interface ArrayNodeConfig {
  delimiter: string;
  trim: boolean;
}

function ArrayNodeBody({
  nodeId,
  config,
  updateConfig,
}: NodeBodyProps<ArrayNodeConfig>) {
  const delimiterId = useId();
  const trimId = useId();
  const delimiter = config.delimiter ?? ",";
  const trim = config.trim ?? true;

  // Slice 6.3 — live preview. The reactive runner re-executes Array
  // whenever its config or upstream changes. Read the live record's
  // output to surface the split items in the body without waiting for
  // an explicit Run.
  const record = useExecutionStore((s) => s.records.get(nodeId));
  const items: string[] =
    record?.output && Array.isArray(record.output)
      ? record.output
          .filter((o): o is StandardizedOutput & { type: "text" } =>
            o.type === "text",
          )
          .map((o) => o.value)
      : [];

  return (
    <div className="flex w-full min-w-[220px] flex-col gap-1.5 px-3 pb-2.5 pt-0.5">
      <div className="flex items-center gap-2">
        <label
          htmlFor={delimiterId}
          className="text-[10.5px] uppercase tracking-wider text-muted-foreground"
        >
          Split on
        </label>
        <input
          id={delimiterId}
          type="text"
          value={delimiter}
          placeholder=","
          onChange={(e) => updateConfig({ delimiter: e.target.value })}
          onPointerDown={(e) => e.stopPropagation()}
          className="h-7 flex-1 rounded-md border border-border/60 bg-background/40 px-2 text-xs"
        />
      </div>

      <label
        htmlFor={trimId}
        className="flex items-center gap-2 text-[11px] text-muted-foreground"
      >
        <input
          id={trimId}
          type="checkbox"
          checked={trim}
          onChange={(e) => updateConfig({ trim: e.target.checked })}
          onPointerDown={(e) => e.stopPropagation()}
          className="h-3 w-3 rounded border border-border/60 bg-background/40"
        />
        Trim each item (drop empty)
      </label>

      {items.length > 0 ? (
        <div
          data-testid="array-items-preview"
          className="nowheel max-h-44 overflow-y-auto rounded-md bg-foreground/[0.04] px-2 py-1.5 text-[10.5px]"
          onWheelCapture={(e) => e.stopPropagation()}
        >
          <p className="mb-1 text-muted-foreground">
            {items.length} {items.length === 1 ? "item" : "items"}
          </p>
          <ol className="ml-3 list-decimal space-y-0.5 text-foreground/80">
            {items.map((item, i) => (
              <li
                key={`${i}-${item.slice(0, 8)}`}
                className="line-clamp-2"
                title={item}
              >
                {item}
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <div className="rounded-md bg-foreground/[0.04] px-2 py-1 text-[10.5px] text-muted-foreground">
          Splits the upstream text into items, then fan-outs downstream.
        </div>
      )}
    </div>
  );
}

export const arrayNodeSchema = defineNode<ArrayNodeConfig>({
  kind: "array",
  category: "transform",
  title: "Array",
  description:
    "Split an upstream text into items, fan out downstream nodes per item.",
  icon: Brackets,
  inputs: [{ id: "text", label: "text", dataType: "text" }],
  outputs: [{ id: "out", label: "out", dataType: "text", multiple: true }],
  defaultConfig: {
    delimiter: ",",
    trim: true,
  },
  reactive: true,
  iterator: true,
  execute: async ({ config, inputs }) => {
    const raw = extractInputByType(inputs, "text", "text") ?? "";
    const delimiter = config.delimiter ?? ",";
    const trim = config.trim ?? true;
    // Empty delimiter splits per character (matches String.split).
    const parts = delimiter === "" ? Array.from(raw) : raw.split(delimiter);
    const items: string[] = trim
      ? parts.map((s) => s.trim()).filter((s) => s.length > 0)
      : parts;
    const outputs: StandardizedOutput[] = items.map((value) => ({
      type: "text",
      value,
    }));
    return outputs;
  },
  Body: ArrayNodeBody,
  size: {
    defaultWidth: 220,
    minWidth: 200,
    maxWidth: 360,
    resizable: "both",
  },
});
