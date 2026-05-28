/**
 * GenerationRepository — Slice 6.2 (ADR-0035).
 *
 * The durable record of every output a node has ever produced. Gallery
 * subscribes to it; per-node history cursors query it; the assistant DSL
 * queries it to answer "show me my last 8 portraits".
 *
 * Same Repository pattern as `ProjectRepository` (ADR-0005, ADR-0034) —
 * an interface here, a Supabase impl in the sibling file. Tests stub the
 * interface so they never touch real Postgres.
 */

import type { StandardizedOutput, NodeUsage } from "@/types/node";

export interface GenerationRecord {
  id: string;
  projectId: string;
  ownerId: string;
  nodeId: string;
  nodeKind: string;
  runId: number;
  output: StandardizedOutput | StandardizedOutput[];
  usage: NodeUsage | null;
  inputsSnapshot: unknown | null;
  promptText: string | null;
  /**
   * User-editable display name (Slice 6.5). Null when the user hasn't
   * renamed; UI falls back to `promptText || nodeKind`.
   */
  title: string | null;
  pinned: boolean;
  tags: string[];
  createdAt: string;
}

export interface InsertGenerationInput {
  projectId: string;
  ownerId: string;
  nodeId: string;
  nodeKind: string;
  runId: number;
  output: StandardizedOutput | StandardizedOutput[];
  usage?: NodeUsage | null;
  inputsSnapshot?: unknown | null;
  promptText?: string | null;
  /** Optional initial tags. Most callers leave this empty. */
  tags?: string[];
}

/**
 * Gallery output-type filter (Slice 6.5). Translates to a `node_kind IN`
 * predicate at the repository layer — the Gallery UI exposes one chip
 * per type. Easier for the Gallery to surface than a raw nodeKind list.
 */
export type GenerationOutputType = "image" | "text" | "video";

/** Maps a Gallery output type to the kinds whose outputs match it. */
export const OUTPUT_TYPE_NODE_KINDS: Record<GenerationOutputType, string[]> = {
  image: ["higgsfield-image-gen"],
  text: ["llm-text"],
  video: [], // Reserved for M0c (Higgsfield video).
};

export interface GenerationFilter {
  projectId: string;
  /** Restrict to a specific node id (per-node history view). */
  nodeId?: string;
  /** Restrict by schema kind (e.g. only `higgsfield-image-gen`). */
  nodeKind?: string;
  /** Restrict by Gallery output type — image/text/video chips. */
  outputType?: GenerationOutputType;
  /** Only pinned rows. */
  pinnedOnly?: boolean;
  /** Substring search against `prompt_text`. Case-insensitive. */
  promptContains?: string;
  /** Hard cap on returned rows. Defaults to 100 in the impl. */
  limit?: number;
  /** Skip the first N rows for pagination. */
  offset?: number;
}

/**
 * Slice 7.6 — semantic / lexical search across the user's generations.
 * `scope: "project"` filters by `projectId`; `scope: "owner"` searches
 * across all projects of the same owner (`ownerId`). Use the latter
 * when the assistant needs cross-project memory.
 */
export interface FindSimilarFilter {
  query: string;
  scope: "project" | "owner";
  projectId?: string;
  ownerId?: string;
  outputType?: GenerationOutputType;
  limit?: number;
}

export interface GenerationRepository {
  insert(input: InsertGenerationInput): Promise<GenerationRecord>;
  list(filter: GenerationFilter): Promise<GenerationRecord[]>;
  /** Fetch a single row by id. Slice 7.4 — needed by the eval tools. */
  get(id: string): Promise<GenerationRecord | null>;
  /** Latest N rows for a specific node — used by per-node history cursors. */
  listForNode(
    projectId: string,
    nodeId: string,
    limit?: number,
  ): Promise<GenerationRecord[]>;
  /**
   * Slice 7.6 — find generations whose prompt_text + title match the
   * query lexically (full-text search) or semantically (when embeddings
   * exist). `scope: "owner"` enables cross-project search.
   */
  findSimilar(filter: FindSimilarFilter): Promise<GenerationRecord[]>;
  setPinned(id: string, pinned: boolean): Promise<void>;
  setTags(id: string, tags: string[]): Promise<void>;
  /** User-set display title; pass null to clear. (Slice 6.5) */
  setTitle(id: string, title: string | null): Promise<void>;
  remove(id: string): Promise<void>;
}

export class GenerationRepositoryError extends Error {
  readonly code:
    | "not_found"
    | "permission_denied"
    | "network"
    | "unknown";
  constructor(message: string, code: GenerationRepositoryError["code"]) {
    super(message);
    this.name = "GenerationRepositoryError";
    this.code = code;
  }
}
