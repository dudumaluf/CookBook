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

export interface GenerationFilter {
  projectId: string;
  /** Restrict to a specific node id (per-node history view). */
  nodeId?: string;
  /** Restrict by schema kind (e.g. only `higgsfield-image-gen`). */
  nodeKind?: string;
  /** Only pinned rows. */
  pinnedOnly?: boolean;
  /** Substring search against `prompt_text`. Case-insensitive. */
  promptContains?: string;
  /** Hard cap on returned rows. Defaults to 100 in the impl. */
  limit?: number;
  /** Skip the first N rows for pagination. */
  offset?: number;
}

export interface GenerationRepository {
  insert(input: InsertGenerationInput): Promise<GenerationRecord>;
  list(filter: GenerationFilter): Promise<GenerationRecord[]>;
  /** Latest N rows for a specific node — used by per-node history cursors. */
  listForNode(
    projectId: string,
    nodeId: string,
    limit?: number,
  ): Promise<GenerationRecord[]>;
  setPinned(id: string, pinned: boolean): Promise<void>;
  setTags(id: string, tags: string[]): Promise<void>;
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
