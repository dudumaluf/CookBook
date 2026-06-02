"use client";

import { Package, ScrollText, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { defineNode } from "@/lib/engine/define-node";
import { nodeRegistry } from "@/lib/engine/registry";
import { runWorkflow } from "@/lib/engine/run-workflow";
import type {
  NodeBodyProps,
  NodeInstance,
  StandardizedOutput,
  WorkflowEdge,
} from "@/types/node";
import type {
  RecipeSubgraph,
  RecipeExposedHandle,
  RecipeExposedParam,
} from "@/lib/repositories/recipe-repository";
import { useExecutionStore } from "@/lib/stores/execution-store";
import { useRecipeCurrentVersion } from "@/lib/stores/recipe-watcher-store";
import { Loader2 } from "lucide-react";

import { CompositeUpdateBadge } from "./composite-update-badge";

/**
 * Composite node — Slice 6.6 (ADR-0039).
 *
 * A composite node is a saved recipe rendered as a single node on the
 * canvas. It carries the recipe's full subgraph in its config and
 * surfaces only the handles that were "exposed" at save time (i.e. the
 * dangling-input / dangling-output ports of the saved selection,
 * automatically detected — see `auto-detect-io.ts`).
 *
 * Execution model (the elegant part):
 *
 *   1. The composite's `execute()` is a regular node execute — same
 *      contract as Text / LLM / Higgsfield. It receives `inputs` mapped
 *      by its exposed-input ids.
 *   2. For each exposed input that arrived, we synthesize an ephemeral
 *      `passthrough` node that emits the input's value, plus an edge
 *      from that passthrough into the corresponding internal target
 *      handle inside the saved subgraph.
 *   3. We hand the augmented subgraph (subgraph nodes + edges + the
 *      phantom passthrough nodes + the phantom edges) to a recursive
 *      `runWorkflow()` call with a fresh per-call cache.
 *   4. After the sub-run completes, we read the records of the nodes
 *      whose outputs were declared exposed at save time, and return
 *      them as the composite's own output (single value when there's
 *      one exposed output, array when multiple).
 *
 * No new engine primitive needed — the existing engine handles
 * everything because we feed it a perfectly normal workflow at the
 * moment we recurse. Cache, fan-out, status emission, abort — all
 * survive the recursion.
 *
 * Editability: composites are FROZEN. To modify, the user right-clicks
 * the composite and chooses **Unpack into subgraph**, edits the now-
 * expanded nodes, and re-saves as a new (or replacement) recipe.
 * Live drill-in editing is parked for M0d.
 */

export interface CompositeNodeConfig {
  /** Cloud recipe id this composite was instantiated from. Optional —
   *  on-canvas-only composites (saved but never persisted) leave this
   *  null until first sync. Useful for "Unpack -> re-save into the same
   *  recipe row". */
  recipeId: string | null;
  /** Display name shown in the BaseNode header. Mirrors the recipe row's
   *  `name` at instantiation time; user-editable per-node via the
   *  standard rename flow without affecting the recipe row. */
  recipeName: string;
  /** Cookbook Library Phase B1 — the recipe's `version` at the moment
   *  this composite was dropped on canvas. null = pre-B1 instance (or
   *  composite saved without a cloud row). Phase B2 reads this to
   *  surface "Update available → vN" badges when the recipe row has
   *  moved on. Phase B1 only writes it. */
  recipeVersion: number | null;
  /** The captured subgraph that runs when this composite executes. */
  subgraph: RecipeSubgraph;
  /** Auto-detected at save time. Each entry binds a public input id
   *  (`label`, e.g. "prompt") to the internal node + handle that
   *  receives it. */
  exposedInputs: RecipeExposedHandle[];
  /** Auto-detected at save time. Each entry binds a public output id
   *  (`label`) to the internal node + handle that produces it. */
  exposedOutputs: RecipeExposedHandle[];
  /** Inner config fields surfaced as inline controls on the composite,
   *  so the user tweaks the recipe without unpacking it. Optional —
   *  recipes saved before this feature have none. */
  exposedParams?: RecipeExposedParam[];
}

/**
 * Body — a configurable recipe surface. Renders the exposed parameters as
 * inline controls (so the user tweaks the recipe without unpacking it) +
 * a preview of the last run's result. Falls back to a compact "packaged
 * recipe" summary when there are no params/result yet. Rename + Unpack
 * live in the schema's settings popover.
 */
function CompositeNodeBody({
  nodeId,
  config,
  updateConfig,
}: NodeBodyProps<CompositeNodeConfig>) {
  const record = useExecutionStore((s) => s.records.get(nodeId));
  const status = record?.status;
  const params = config.exposedParams ?? [];
  const internalNodeCount = config.subgraph?.nodes.length ?? 0;
  // Phase B2: surface "Update available" when the watcher knows a newer
  // version exists for our recipe id. Returns null until the watcher
  // hydrates OR the recipe id isn't tracked OR we're up to date.
  const currentRecipeVersion = useRecipeCurrentVersion(config.recipeId);
  const showUpdateBadge =
    config.recipeId !== null &&
    config.recipeVersion !== null &&
    currentRecipeVersion !== null &&
    currentRecipeVersion > config.recipeVersion;

  function paramValue(p: RecipeExposedParam): unknown {
    const node = config.subgraph?.nodes.find((n) => n.id === p.internalNodeId);
    return (node?.config as Record<string, unknown> | undefined)?.[p.configKey];
  }

  function setParam(p: RecipeExposedParam, value: unknown) {
    const nodes = (config.subgraph?.nodes ?? []).map((n) =>
      n.id === p.internalNodeId
        ? { ...n, config: { ...(n.config as object), [p.configKey]: value } }
        : n,
    );
    updateConfig({ subgraph: { ...config.subgraph, nodes } });
  }

  const preview = pickPreview(record?.output);

  return (
    <div className="flex w-full min-w-[200px] flex-col gap-2 px-3 pb-2.5 pt-0.5">
      {showUpdateBadge ? (
        <div className="-mx-1 flex justify-end">
          <CompositeUpdateBadge
            nodeId={nodeId}
            recipeId={config.recipeId!}
            instanceVersion={config.recipeVersion!}
            currentVersion={currentRecipeVersion!}
          />
        </div>
      ) : null}
      {params.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {params.map((p, i) => (
            <ParamControl
              key={`${p.internalNodeId}:${p.configKey}:${i}`}
              param={p}
              value={paramValue(p)}
              onChange={(v) => setParam(p, v)}
            />
          ))}
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
        <div className="flex aspect-video w-full items-center justify-center rounded-md bg-foreground/[0.04] text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : preview ? (
        <RecipePreview preview={preview} />
      ) : (
        <div className="flex items-center gap-2 rounded-md bg-foreground/[0.04] px-2 py-1.5 text-[10.5px] text-muted-foreground">
          <ScrollText className="h-3 w-3" />
          <span>
            Recipe · {internalNodeCount}{" "}
            {internalNodeCount === 1 ? "node" : "nodes"} inside
          </span>
        </div>
      )}
    </div>
  );
}

/* ────────────────────────── Param control ──────────────────────────── */

function ParamControl({
  param,
  value,
  onChange,
}: {
  param: RecipeExposedParam;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const labelEl = (
    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
      {param.label}
    </span>
  );
  const stop = (e: React.PointerEvent) => e.stopPropagation();
  const cls =
    "h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs";

  if (param.control === "toggle") {
    return (
      <label className="flex items-center justify-between gap-2">
        {labelEl}
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          onPointerDown={stop}
          className="h-3.5 w-3.5 rounded border border-border/60 bg-background/40"
        />
      </label>
    );
  }

  return (
    <label className="flex flex-col gap-1">
      {labelEl}
      {param.control === "select" ? (
        <select
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          onPointerDown={stop}
          className={cls}
        >
          {(param.options ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      ) : param.control === "number" ? (
        <input
          type="number"
          value={value === undefined || value === null ? "" : Number(value)}
          min={param.min}
          max={param.max}
          step={param.step}
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
          onPointerDown={stop}
          className={cls}
        />
      ) : (
        <input
          type="text"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          onPointerDown={stop}
          className={cls}
        />
      )}
    </label>
  );
}

/* ────────────────────────── Result preview ─────────────────────────── */

type RecipePreviewKind =
  | { type: "image"; url: string }
  | { type: "video"; url: string }
  | { type: "text"; value: string };

function pickPreview(
  output: StandardizedOutput | StandardizedOutput[] | undefined,
): RecipePreviewKind | null {
  if (output === undefined) return null;
  const first = Array.isArray(output) ? output[0] : output;
  if (!first) return null;
  if (first.type === "image" && first.value?.url)
    return { type: "image", url: first.value.url };
  if (first.type === "video" && first.value?.url)
    return { type: "video", url: first.value.url };
  if (first.type === "text" && typeof first.value === "string")
    return { type: "text", value: first.value };
  return null;
}

function RecipePreview({ preview }: { preview: RecipePreviewKind }) {
  if (preview.type === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={preview.url}
        alt="Recipe result"
        className="w-full rounded-md bg-foreground/5 object-cover"
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = "none";
        }}
      />
    );
  }
  if (preview.type === "video") {
    return (
      <video
        src={preview.url}
        controls
        loop
        playsInline
        onPointerDown={(e) => e.stopPropagation()}
        className="w-full rounded-md bg-black"
      />
    );
  }
  return (
    <p className="max-h-24 overflow-y-auto whitespace-pre-wrap rounded-md bg-foreground/[0.04] px-2 py-1.5 text-[11px] leading-snug text-foreground/85">
      {preview.value.length > 280
        ? `${preview.value.slice(0, 277)}…`
        : preview.value}
    </p>
  );
}

/**
 * Settings — surfaces the destructive "Unpack" action so users can
 * recover access to the inner nodes without us implementing a full
 * canvas-mode-switching UI. Renaming the on-canvas instance is the
 * standard header rename flow (BaseNode owns it).
 */
function CompositeSettingsContent({
  nodeId,
  config,
}: NodeBodyProps<CompositeNodeConfig>) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-col gap-2 p-1">
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        This composite holds {config.subgraph?.nodes.length ?? 0} nodes
        from the &quot;{config.recipeName}&quot; recipe. Unpack to edit
        the internals on the canvas.
      </p>
      <Button
        variant="outline"
        size="sm"
        className="h-7 gap-1 text-[11px]"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          // Imported lazily so the body file doesn't need to know
          // about workflow-store coupling at the module scope.
          const { unpackComposite } = await import(
            "@/lib/recipes/unpack-composite"
          );
          unpackComposite(nodeId);
        }}
      >
        <Trash2 className="h-3 w-3" />
        Unpack into subgraph
      </Button>
    </div>
  );
}

export const compositeNodeSchema = defineNode<CompositeNodeConfig>({
  kind: "composite",
  category: "compose",
  title: "Recipe",
  description:
    "A saved subgraph rendered as a single node. Internally runs the recipe's workflow; surfaces only the exposed inputs and outputs.",
  icon: Package,
  inputs: [],
  outputs: [],
  // Dynamic I/O resolved per-instance from config.exposedInputs/Outputs.
  // BaseNode picks these up via the canvas-flow wrapper; the engine
  // picks them up via `getNodeInputs`.
  getInputs: (config) =>
    config.exposedInputs.map((h) => ({
      id: h.label,
      label: h.label,
      dataType: h.dataType as never,
    })),
  getOutputs: (config) =>
    config.exposedOutputs.map((h) => ({
      id: h.label,
      label: h.label,
      dataType: h.dataType as never,
    })),
  defaultConfig: {
    recipeId: null,
    recipeName: "Untitled recipe",
    recipeVersion: null,
    subgraph: { version: 1, nodes: [], edges: [] },
    exposedInputs: [],
    exposedOutputs: [],
    exposedParams: [],
  },
  // Composites are NOT auto-reactive — the inner subgraph may include
  // expensive non-reactive nodes (LLM, Higgsfield) that the user doesn't
  // want firing on every keystroke. The reactive runner skips them; the
  // user runs them via the global Run / Run-here on the composite.
  reactive: false,
  execute: async ({ config, inputs, signal }) => {
    const { subgraph, exposedInputs, exposedOutputs } = config;

    // 1. Build phantom passthrough nodes + edges so the inner subgraph
    //    sees external composite inputs as upstream-emitted values.
    const phantomNodes: NodeInstance[] = [];
    const phantomEdges: WorkflowEdge[] = [];
    for (const exposed of exposedInputs) {
      const value = inputs[exposed.label];
      if (value === undefined) continue;
      // Pick the first item if the upstream emitted an array — composite
      // inputs that fan-out are a future feature; today we treat any
      // arriving value as a single payload.
      const single = Array.isArray(value) ? value[0] : value;
      if (!single) continue;
      const phantomId = `__pt_${exposed.internalNodeId}_${exposed.internalHandleId}`;
      phantomNodes.push({
        id: phantomId,
        kind: "passthrough",
        position: { x: 0, y: 0 },
        config: { value: single } as never,
      });
      phantomEdges.push({
        id: `${phantomId}_edge`,
        source: phantomId,
        sourceHandle: "out",
        target: exposed.internalNodeId,
        targetHandle: exposed.internalHandleId,
      });
    }

    // 2. Recurse into the engine with the augmented subgraph. Use a
    //    fresh cache so composite invocations don't share keys with
    //    the outer session — composite inputs may differ run-to-run
    //    even if the outer cache says otherwise.
    const subCache = new Map();
    const subResult = await runWorkflow({
      nodes: [...phantomNodes, ...subgraph.nodes],
      edges: [...phantomEdges, ...subgraph.edges],
      registry: nodeRegistry,
      cache: subCache as never,
      signal,
      mode: "full",
      // Sub-workflow progress doesn't surface to the user — the composite
      // is one logical step. We swallow internal status emits and only
      // surface the composite's own final emit to the outer execution
      // store. Consider piping internal progress into a tooltip / drawer
      // in a follow-up if users want to see what's happening inside.
      onProgress: () => {},
    });

    if (!subResult.ok) {
      throw new Error(
        `Recipe sub-workflow failed${subResult.failedNodeId ? ` at node ${subResult.failedNodeId}` : ""}`,
      );
    }

    // 3. Read the recorded outputs of every exposed-output target. If
    //    the user picked just one output (the common case), we return
    //    a single StandardizedOutput; multi-output recipes return an
    //    array so the engine can fan-out / mux normally.
    const collected: StandardizedOutput[] = [];
    for (const exposed of exposedOutputs) {
      const rec = subResult.records.get(exposed.internalNodeId);
      const out = rec?.output;
      if (!out) continue;
      if (Array.isArray(out)) {
        collected.push(...out);
      } else {
        collected.push(out);
      }
    }

    if (collected.length === 0) {
      // No outputs produced — surface as text empty so the engine has
      // a defined shape rather than `undefined`.
      return { type: "text", value: "" } as StandardizedOutput;
    }
    if (collected.length === 1) return collected[0]!;
    return collected;
  },
  Body: CompositeNodeBody,
  settings: {
    Content: CompositeSettingsContent,
  },
  size: {
    defaultWidth: 240,
    minWidth: 200,
    maxWidth: 400,
    resizable: "horizontal",
  },
});
