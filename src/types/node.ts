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
 * `image`/`video` carry asset refs (URL + minimal metadata).
 */
export type DataType = "text" | "image" | "video" | "number" | "any";

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
 * StandardizedOutput is the *only* shape that nodes emit. The engine and the
 * `extractInputByType` util both rely on this discriminated union.
 *
 * A node can emit either a single value or an array (iterators).
 */
export type StandardizedOutput =
  | { type: "text"; value: string }
  | { type: "image"; value: ImageRef }
  | { type: "video"; value: VideoRef }
  | { type: "number"; value: number };

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

export interface NodeSchema<TConfig = unknown> {
  kind: string;
  category: NodeCategory;
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  inputs: NodeIO[];
  outputs: NodeIO[];
  defaultConfig: TConfig;
  /**
   * Reactive nodes derive their output from `config` alone (Text, Image,
   * Number). They don't need an explicit "Run" — the run engine treats them
   * as always-fresh sources. Executable nodes (LLMText, HiggsfieldImageGen,
   * …) require a run + cache.
   */
  reactive?: boolean;
  /**
   * Execution function. Optional in Slice 1 because Text/Image are reactive
   * and the run engine (Slice 3) is not built yet. Becomes required once the
   * engine ships.
   */
  execute?: (ctx: ExecContext<TConfig>) => Promise<
    StandardizedOutput | StandardizedOutput[]
  >;
  /** React component rendered inside the BaseNode card. */
  Body: ComponentType<NodeBodyProps<TConfig>>;
}

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
}

export interface NodeInstance<TConfig = unknown> {
  id: string;
  kind: string;
  position: { x: number; y: number };
  config: TConfig;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
}
