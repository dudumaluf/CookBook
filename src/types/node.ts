/**
 * Core node-graph types.
 *
 * These types are the contract between the engine, the workflow store, and
 * the visual layer. Keep them framework-agnostic — no React, no React Flow.
 * The React Flow bridge lives in `src/components/canvas/canvas-flow.tsx`.
 *
 * Decisions live in ADR-0014 (DECISIONS.md).
 */

import type { ComponentType } from "react";

/* ────────────────────────────────────────────────────────────────────────── */
/* Datatypes                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * The set of datatypes that can flow through edges. `any` accepts everything;
 * `image`/`video`/`audio` carry asset refs (URL + minimal metadata); `soul-id`
 * carries a Higgsfield Soul ID character reference (Slice 4 / ADR-0029).
 *
 * `audio` lands with the multimodal media arc (Slice A) — needed so a song
 * can flow through the graph (sliced into windows, fed to Seedance for
 * lip-sync). `video` was reserved since Slice 4 and is now activated by the
 * same arc.
 */
export type DataType =
  | "text"
  | "image"
  | "video"
  | "audio"
  | "mesh"
  | "number"
  | "soul-id"
  | "any";

export interface ImageRef {
  url: string;
  width?: number;
  height?: number;
  mime?: string;
}

export interface VideoRef {
  url: string;
  durationMs?: number;
  width?: number;
  height?: number;
  mime?: string;
}

/**
 * Audio reference (Slice A — multimodal media arc). A URL to an audio file
 * (song, narration, SFX) plus minimal metadata. `durationMs` is what the
 * Audio Slice node + the Continuity Builder rely on to window a track into
 * 15s chunks aligned to Seedance's per-call limit.
 */
export interface AudioRef {
  url: string;
  durationMs?: number;
  mime?: string;
}

/**
 * 3D mesh reference (M1 — image-to-3D arc). A URL to a binary glTF (`.glb`)
 * file plus optional sibling formats (`.obj`) and a thumbnail. The Hunyuan
 * 3D Pro node ships with this; other 3D models will reuse the same shape.
 *
 * The viewer (`<model-viewer>`) consumes the GLB url; `thumbnailUrl` is
 * shown while the heavy GLB downloads, and `objUrl` gives the user a
 * download for DCC tools that prefer OBJ.
 */
export interface MeshRef {
  /** Required: GLB url (binary glTF — what the viewer + most pipelines use). */
  url: string;
  /** Optional sibling format. */
  objUrl?: string;
  /** Optional preview PNG rendered server-side by the model. */
  thumbnailUrl?: string;
  /** File size in bytes for the GLB, when reported. */
  sizeBytes?: number;
  mime?: string;
}

/**
 * Higgsfield Soul ID character reference. The `customReferenceId` is the
 * UUID Higgsfield assigns each trained character; `variant` ("v1" / "v2" /
 * "cinema") is what the character was trained as and dictates which
 * generation endpoint can use it (per ADR-0029).
 *
 * Carries an optional `name` + `thumbnailUrl` for UI presentation; consumers
 * (`HiggsfieldImageGen.execute()`) only need the id + variant.
 */
export interface SoulIdRef {
  customReferenceId: string;
  variant: "v1" | "v2" | "cinema";
  name?: string;
  thumbnailUrl?: string;
}

/**
 * StandardizedOutput is the *only* shape that nodes emit. The engine and the
 * `extractInputByType` util both rely on this discriminated union.
 *
 * A node can emit either a single value or an array (iterators).
 */
export type StandardizedOutput =
  | { type: "text"; value: string }
  | { type: "image"; value: ImageRef }
  | { type: "video"; value: VideoRef }
  | { type: "audio"; value: AudioRef }
  | { type: "mesh"; value: MeshRef }
  | { type: "number"; value: number }
  | { type: "soul-id"; value: SoulIdRef };

/* ────────────────────────────────────────────────────────────────────────── */
/* Schema                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Categories drive how the Add-node popover (and the LLM assistant catalog)
 * groups nodes. Keep this list short — if you find yourself wanting a tenth
 * category, the granularity is wrong.
 */
export type NodeCategory =
  | "input"
  | "iterator"
  | "ai-vision"
  | "ai-text"
  | "ai-image"
  | "ai-video"
  | "transform"
  | "compose"
  | "output";

/** A single input or output handle on a node. */
export interface NodeIO {
  /** Local handle id, stable across the node's lifetime. */
  id: string;
  label: string;
  dataType: DataType;
  /** If true, this input can accept multiple incoming edges (used by iterators). */
  multiple?: boolean;
}

/**
 * Body component contract: a node's body is a React component that receives
 * the live instance + a way to update its config. The body owns its own UI
 * (textarea, image preview, model picker, etc.).
 */
export interface NodeBodyProps<TConfig = unknown> {
  nodeId: string;
  config: TConfig;
  updateConfig: (partial: Partial<TConfig>) => void;
  selected: boolean;
}

/**
 * Declarative description of a config field's UI control. Read by the recipe
 * params editor so that exposing a field on a composite keeps the original
 * node's control (dropdown / toggle / number) instead of degrading to a bare
 * text box. Without it, the editor can only infer from the JS type (string →
 * text), losing dropdown options. Mirrors `RecipeExposedParam`'s control set.
 */
export interface NodeConfigParamSpec {
  control: "select" | "number" | "text" | "toggle";
  /** Choices for a `select` control. */
  options?: readonly string[];
  min?: number;
  max?: number;
  step?: number;
  /** Friendly label; defaults to the config key. */
  label?: string;
}

export interface NodeSchema<TConfig = unknown> {
  kind: string;
  category: NodeCategory;
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  /**
   * Static handle declarations. The 99% case — most nodes know their
   * inputs and outputs at design time.
   */
  inputs: NodeIO[];
  outputs: NodeIO[];
  /**
   * Slice 6.6 — composite nodes (recipes saved as a single node) carry
   * their I/O in `config.exposedInputs/Outputs`, so their handle list is
   * per-instance. When `getInputs` / `getOutputs` is provided, callers
   * (BaseNode renderer + engine input resolver) prefer the dynamic list
   * over the static one. Most nodes leave these undefined.
   */
  getInputs?: (config: TConfig) => NodeIO[];
  getOutputs?: (config: TConfig) => NodeIO[];
  /**
   * Per-config-key control descriptors for the recipe params editor. Keyed
   * by config field name. Lets a recipe surface a field with the same
   * dropdown/toggle/number the node's own settings use. Optional.
   */
  configParams?: Record<string, NodeConfigParamSpec>;
  defaultConfig: TConfig;
  /**
   * Reactive nodes derive their output from `config` alone (Text, Image,
   * Number). They don't need an explicit "Run" — the run engine treats them
   * as always-fresh sources. Executable nodes (LLMText, HiggsfieldImageGen,
   * …) require a run + cache.
   */
  reactive?: boolean;
  /**
   * Iterator nodes emit a `StandardizedOutput[]` whose items are meant to be
   * **fan-out** to single-input downstream nodes — i.e. the downstream
   * runs once per iterator item, in parallel (bounded by maxConcurrent).
   *
   * Without this flag, an array output feeding a single input only delivers
   * the first item to the downstream (legacy serial behavior). Setting
   * `iterator: true` is the explicit opt-in to fan-out.
   *
   * See ADR-0030 (M0a Slice 4.4 — fan-out execution).
   */
  iterator?: boolean;
  /**
   * Opt this node out of the engine's hash cache for the given config
   * (multimodal arc). Returns `true` to force a fresh execute() every run
   * even when nothing changed — used by generation nodes when `seed === -1`
   * ("random each run"), so the user can press Run repeatedly for variations
   * without editing config. Default (absent): cacheable.
   */
  isCacheBusting?: (config: TConfig) => boolean;
  /**
   * Execution function. Optional in Slice 1 because Text/Image are reactive
   * and the run engine (Slice 3) is not built yet. Becomes required once the
   * engine ships.
   *
   * Return shapes (both supported, picked based on whether the node wants
   * to report usage):
   *   - `StandardizedOutput | StandardizedOutput[]` — legacy/simple. Used
   *     by reactive nodes and any executable that has no cost story.
   *   - `{ output, usage? }` — rich. Used by LLM / image-gen nodes to
   *     report cost / token counts / model id alongside the output. The
   *     runner extracts both and stores `usage` in the ExecutionRecord
   *     so the Queue panel can surface it without each node having to
   *     hand-roll its own side channel.
   */
  execute?: (ctx: ExecContext<TConfig>) => Promise<NodeExecuteResult>;
  /** React component rendered inside the BaseNode card. */
  Body: ComponentType<NodeBodyProps<TConfig>>;
  /**
   * Optional settings affordance, surfaced as a standardized `⋯` (three-dot)
   * trigger in the top-right of the BaseNode header — opposite side of the
   * node title — that opens a Popover with `Content`. Provide this when a
   * node grows knobs the user might want to tune without bloating the body
   * for the 80% case who never touch them (temperature / max tokens /
   * reasoning on LLM Text, sampler / steps on future image-gen nodes, etc.).
   *
   * `Content` is a React component receiving the same `NodeBodyProps` as
   * `Body`, so settings UIs can share helpers freely. `hasOverrides`
   * (optional) drives the accent dot indicator on the trigger — when it
   * returns true, the user sees at a glance that the node has something
   * non-default set without opening the popover.
   *
   * The trigger placement + icon + popover wrapper are owned by BaseNode
   * (ADR-0027) so every settings-capable node reads identically in the
   * canvas — only the popover *content* changes per node kind.
   */
  settings?: {
    Content: ComponentType<NodeBodyProps<TConfig>>;
    hasOverrides?: (config: TConfig) => boolean;
  };
  /**
   * Optional sizing contract for the node card (ADR-0028). When omitted,
   * the node is purely content-driven with no min/max and no user resize.
   *
   * Provide this for any node whose body can grow unbounded with content
   * (LLM Text output, Text textarea, Image preview, future video preview…)
   * — `defaultWidth` + `maxWidth` cap the silhouette so a long LLM response
   * doesn't stretch the node across the canvas; `resizable` opts in to the
   * standardized bottom-right drag handle so the user can grow the card
   * for better readability when they want to.
   *
   * Min/max constraints apply to both the content-driven natural size and
   * the user-resized size (NodeResizeControl honors them too), so the
   * silhouette stays within the design bounds either way.
   */
  size?: NodeSizeSchema;
}

/**
 * Per-axis or both-axis resize affordance, declared by `NodeSchema.size`.
 *
 * - `"none"` (default if `size` is omitted entirely) — fixed, content-driven.
 * - `"horizontal"` — user can drag the right edge handle to change width.
 * - `"vertical"` — user can drag the bottom edge handle to change height.
 * - `"both"` — user can drag the bottom-right corner handle to change both.
 */
export type NodeResizable = "none" | "horizontal" | "vertical" | "both";

/**
 * Sizing contract for a node kind (ADR-0028).
 *
 * Every field is optional so a node can opt in to *just* the constraints it
 * cares about. The most common combo is `defaultWidth` + `maxWidth` + a
 * scrollable body section (so a long output never blows up the silhouette).
 *
 * `default*` is the initial size when the user has never resized. Once the
 * user drags the resize handle, `NodeInstance.size` overrides it for that
 * instance only.
 */
export interface NodeSizeSchema {
  /** Initial width before any user resize. Unset = content-driven (CSS auto). */
  defaultWidth?: number;
  /** Initial height before any user resize. Unset = content-driven. */
  defaultHeight?: number;
  /** Floor for both content-driven and user-resized width. */
  minWidth?: number;
  /** Ceiling for both content-driven and user-resized width. */
  maxWidth?: number;
  /** Floor for both content-driven and user-resized height. */
  minHeight?: number;
  /** Ceiling for both content-driven and user-resized height. */
  maxHeight?: number;
  /**
   * Whether the user can manually resize the node and along which axis.
   * Default: `"none"`. When set, BaseNode renders a standardized drag
   * handle (`"both"` → bottom-right corner; `"horizontal"` → right edge;
   * `"vertical"` → bottom edge) bound to React Flow's NodeResizeControl
   * with the schema's min/max as the drag bounds.
   */
  resizable?: NodeResizable;
}

/**
 * Optional usage block a node can attach to its execution result. Every
 * field is optional so partial reporting works (e.g. a future audio node
 * that only knows duration but not cost). Lives in `ExecutionRecord.usage`
 * after the runner extracts it.
 */
export interface NodeUsage {
  /** USD as reported by the upstream provider. */
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  /**
   * The model that actually ran. Useful when the user picked one model
   * and the provider re-routed (Fal OpenRouter does this occasionally
   * during rate-limited periods) — surfacing it in the queue keeps the
   * billing surface honest.
   */
  model?: string;
}

/** Rich form an `execute()` can return when it wants to report usage. */
export interface NodeOutputWithUsage {
  output: StandardizedOutput | StandardizedOutput[];
  usage?: NodeUsage;
}

/** What an `execute()` may return — either the simple output or the rich shape. */
export type NodeExecuteResult =
  | StandardizedOutput
  | StandardizedOutput[]
  | NodeOutputWithUsage;

/* ────────────────────────────────────────────────────────────────────────── */
/* Runtime                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

export interface ExecContext<TConfig = unknown> {
  nodeId: string;
  config: TConfig;
  /**
   * Inputs keyed by handle id. Each value can be a single StandardizedOutput
   * or an array (when `multiple: true` on the input handle).
   */
  inputs: Record<
    string,
    StandardizedOutput | StandardizedOutput[] | undefined
  >;
  signal: AbortSignal;
  /**
   * Optional progress reporter (Slice D — multimodal media arc). The engine
   * wires this so a long-running, multi-step node (the Continuity Builder
   * looping Seedance per chunk) can emit intermediate progress + partial
   * output WITHOUT finishing. The engine forwards each call to `onProgress`
   * as a `running` record with the given `fanOut` / `output`. Nodes that
   * don't loop ignore it (backward-compatible — all existing nodes do).
   */
  reportProgress?: (progress: ExecProgress) => void;
}

/**
 * Partial progress a long-running node emits mid-execute (Slice D). Mirrors
 * the `fanOut` ring already used by the parallel fan-out path, plus an
 * optional partial output so the UI can preview chunks as they land.
 */
export interface ExecProgress {
  fanOut?: { total: number; done: number };
  output?: StandardizedOutput | StandardizedOutput[];
}

export interface NodeInstance<TConfig = unknown> {
  id: string;
  kind: string;
  position: { x: number; y: number };
  config: TConfig;
  /**
   * Optional per-instance label. When set, overrides `schema.title` in the
   * node header — useful for distinguishing multiple nodes of the same kind
   * in a recipe ("Subject", "Mood", "Background", …). Edited inline via
   * double-click on the header title. Empty / undefined falls back to the
   * schema title so wiping the label restores the default.
   */
  label?: string;
  /**
   * Per-instance dimensions set by the user via the resize handle (ADR-0028).
   * When present, overrides `schema.size.defaultWidth` / `defaultHeight` for
   * this node only. Both axes optional so a node can be widened without
   * forcing a height, or vice versa. React Flow honors these via the node's
   * `width` / `height` props; the schema's `min*` / `max*` still clamp.
   */
  size?: { width?: number; height?: number };
}

export interface WorkflowEdge {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Execution                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Per-node execution status during (and after) a run.
 *
 * - `idle`: never run yet, or `clearRun()` since the last run.
 * - `pending`: in the current run's topological order, not yet started.
 * - `running`: `execute()` is in flight.
 * - `done`: completed this run; output stored.
 * - `cached`: skipped because the cache key matched a previous run's output;
 *   `output` is populated from the cache. We surface this separately from
 *   `done` so the UI can hint "this was free" and so the cost preview can
 *   exclude it from the total.
 * - `error`: `execute()` threw; downstream nodes stay `pending`.
 * - `cancelled`: the run was aborted (user re-clicked Run, navigated away,
 *   etc.) before this node finished.
 */
export type ExecutionStatus =
  | "idle"
  | "pending"
  | "running"
  | "done"
  | "cached"
  | "error"
  | "cancelled";

/**
 * Live record the execution store keeps per node id during + after a run.
 *
 * `hash` is the cache key derived from `{ kind, config, upstream hashes }`.
 * Same hash across runs ⇒ deterministic cache hit; modifying any upstream
 * node mutates that upstream's hash and propagates through the graph so
 * everything downstream is re-evaluated automatically.
 */
export interface ExecutionRecord {
  status: ExecutionStatus;
  output?: StandardizedOutput | StandardizedOutput[];
  /** Last error message — populated only when `status === "error"`. */
  error?: string;
  /** ms spent inside `execute()` — undefined for `cached` / `idle`. */
  elapsedMs?: number;
  /** Stable content hash used as the cache key for this node + inputs. */
  hash?: string;
  /**
   * Provider-reported usage (cost, tokens, actual model id). Present for
   * nodes that opt in via the `{ output, usage }` return shape; absent
   * for reactive / cost-free nodes (Text, Image, …). Survives a `cached`
   * hit so the queue can still credit "saved X" against the cumulative
   * run total.
   */
  usage?: NodeUsage;
  /**
   * Fan-out progress (Slice 4.4 / ADR-0030). When the engine is running a
   * node N times in parallel against an iterator's items, this surfaces
   * "running 3/8" to the UI without extra subscribe plumbing.
   *
   * `total` is the iterator size; `done` is how many child executions
   * have finished (success OR failure — UI distinguishes via `status`).
   * Absent when the node isn't a fan-out target.
   */
  fanOut?: { total: number; done: number };
  /**
   * Per-node ring buffer of past `done` outputs (Slice 5.8). Capped at
   * `HISTORY_CAP` (10). View-only — UI navigates via the
   * `<IteratorCursor>` cursor on supported nodes (Higgsfield + LLM
   * Text). The current run's output is also the last entry, so the
   * cursor at `history.length - 1` shows the live result.
   *
   * Cached records do NOT add an entry — replays aren't new outputs.
   * Cleared by `clearRun()` along with `records`.
   */
  history?: ExecutionHistoryEntry[];
}

/** A single entry in `ExecutionRecord.history` (Slice 5.8). */
export interface ExecutionHistoryEntry {
  output: StandardizedOutput | StandardizedOutput[];
  usage?: NodeUsage;
  elapsedMs?: number;
  /** Run id at the moment this entry was captured. */
  runId: number;
  /** Wall-clock ms at capture (Date.now()). */
  timestamp: number;
}
