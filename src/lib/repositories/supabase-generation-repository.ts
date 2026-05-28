import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseClient } from "@/lib/supabase/client";
import type { NodeUsage, StandardizedOutput } from "@/types/node";

import {
  type FindSimilarFilter,
  type GenerationFilter,
  type GenerationRecord,
  type GenerationRepository,
  GenerationRepositoryError,
  type InsertGenerationInput,
  OUTPUT_TYPE_NODE_KINDS,
} from "./generation-repository";

interface RawGenerationRow {
  id: string;
  project_id: string;
  owner_id: string;
  node_id: string;
  node_kind: string;
  run_id: number;
  output: StandardizedOutput | StandardizedOutput[];
  usage: NodeUsage | null;
  inputs_snapshot: unknown | null;
  prompt_text: string | null;
  title: string | null;
  pinned: boolean;
  tags: string[];
  created_at: string;
}

function rowToRecord(row: RawGenerationRow): GenerationRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    ownerId: row.owner_id,
    nodeId: row.node_id,
    nodeKind: row.node_kind,
    runId: row.run_id,
    output: row.output,
    usage: row.usage,
    inputsSnapshot: row.inputs_snapshot,
    promptText: row.prompt_text,
    title: row.title ?? null,
    pinned: row.pinned,
    tags: row.tags ?? [],
    createdAt: row.created_at,
  };
}

function mapError(
  err: unknown,
  fallback: string,
): GenerationRepositoryError {
  const e = err as { code?: string; message?: string } | null;
  if (e?.code === "PGRST116") {
    return new GenerationRepositoryError(
      e.message ?? fallback,
      "not_found",
    );
  }
  if (e?.code === "42501") {
    return new GenerationRepositoryError(
      e.message ?? "Access denied by RLS policy",
      "permission_denied",
    );
  }
  return new GenerationRepositoryError(e?.message ?? fallback, "unknown");
}

export class SupabaseGenerationRepository implements GenerationRepository {
  private client: SupabaseClient;

  constructor(client?: SupabaseClient) {
    this.client = client ?? getSupabaseClient();
  }

  async insert(input: InsertGenerationInput): Promise<GenerationRecord> {
    const payload = {
      project_id: input.projectId,
      owner_id: input.ownerId,
      node_id: input.nodeId,
      node_kind: input.nodeKind,
      run_id: input.runId,
      output: input.output,
      usage: input.usage ?? null,
      inputs_snapshot: input.inputsSnapshot ?? null,
      prompt_text: input.promptText ?? null,
      tags: input.tags ?? [],
    };
    const { data, error } = await this.client
      .from("cookbook_generations")
      .insert(payload)
      .select("*")
      .single();
    if (error) throw mapError(error, "Failed to insert generation");
    return rowToRecord(data as RawGenerationRow);
  }

  async get(id: string): Promise<GenerationRecord | null> {
    const { data, error } = await this.client
      .from("cookbook_generations")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw mapError(error, "Failed to load generation");
    if (!data) return null;
    return rowToRecord(data as RawGenerationRow);
  }

  async list(filter: GenerationFilter): Promise<GenerationRecord[]> {
    let query = this.client
      .from("cookbook_generations")
      .select("*")
      .eq("project_id", filter.projectId)
      .order("created_at", { ascending: false });
    if (filter.nodeId) query = query.eq("node_id", filter.nodeId);
    if (filter.nodeKind) query = query.eq("node_kind", filter.nodeKind);
    if (filter.outputType) {
      // Translate the Gallery's user-facing chip into the underlying node
      // kinds we know produce that output type.
      const kinds = OUTPUT_TYPE_NODE_KINDS[filter.outputType];
      if (kinds.length > 0) {
        query = query.in("node_kind", kinds);
      } else {
        // Unknown / unmapped (e.g. video before M0c) — short-circuit to
        // an empty result rather than letting Postgres return everything.
        query = query.eq("node_kind", "__none__");
      }
    }
    if (filter.pinnedOnly) query = query.eq("pinned", true);
    if (filter.promptContains) {
      // Case-insensitive substring search via Postgres `ilike`.
      query = query.ilike("prompt_text", `%${filter.promptContains}%`);
    }
    const limit = filter.limit ?? 100;
    if (filter.offset) {
      query = query.range(filter.offset, filter.offset + limit - 1);
    } else {
      query = query.limit(limit);
    }
    const { data, error } = await query;
    if (error) throw mapError(error, "Failed to list generations");
    return ((data ?? []) as RawGenerationRow[]).map(rowToRecord);
  }

  async listForNode(
    projectId: string,
    nodeId: string,
    limit: number = 50,
  ): Promise<GenerationRecord[]> {
    return this.list({ projectId, nodeId, limit });
  }

  async findSimilar(
    filter: FindSimilarFilter,
  ): Promise<GenerationRecord[]> {
    // Slice 7.6 — full-text search via the `search_vector` tsvector
    // column populated by the migration. Future: add an embedding-
    // based path when generations have been embedded.
    const phrase = filter.query.trim();
    if (phrase.length === 0) return [];
    let query = this.client
      .from("cookbook_generations")
      .select("*")
      .order("created_at", { ascending: false });
    if (filter.scope === "project") {
      if (!filter.projectId) {
        throw new GenerationRepositoryError(
          "scope:'project' requires projectId",
          "unknown",
        );
      }
      query = query.eq("project_id", filter.projectId);
    } else {
      if (!filter.ownerId) {
        throw new GenerationRepositoryError(
          "scope:'owner' requires ownerId",
          "unknown",
        );
      }
      query = query.eq("owner_id", filter.ownerId);
    }
    if (filter.outputType) {
      const kinds = OUTPUT_TYPE_NODE_KINDS[filter.outputType];
      if (kinds.length > 0) query = query.in("node_kind", kinds);
      else query = query.eq("node_kind", "__none__");
    }
    // websearch_to_tsquery handles natural-language queries
    // (quoted phrases, AND/OR/NOT) gracefully, unlike plainto.
    query = query.textSearch("search_vector", phrase, {
      type: "websearch",
      config: "english",
    });
    query = query.limit(filter.limit ?? 20);
    const { data, error } = await query;
    if (error) throw mapError(error, "Failed to find similar generations");
    return ((data ?? []) as RawGenerationRow[]).map(rowToRecord);
  }

  async setPinned(id: string, pinned: boolean): Promise<void> {
    const { error } = await this.client
      .from("cookbook_generations")
      .update({ pinned })
      .eq("id", id);
    if (error) throw mapError(error, "Failed to update pin");
  }

  async setTags(id: string, tags: string[]): Promise<void> {
    const { error } = await this.client
      .from("cookbook_generations")
      .update({ tags })
      .eq("id", id);
    if (error) throw mapError(error, "Failed to update tags");
  }

  async setTitle(id: string, title: string | null): Promise<void> {
    // Trim user input; empty / whitespace-only resets to null so the UI
    // falls back to prompt_text || node_kind.
    const trimmed = title === null ? null : title.trim();
    const next = trimmed && trimmed.length > 0 ? trimmed : null;
    const { error } = await this.client
      .from("cookbook_generations")
      .update({ title: next })
      .eq("id", id);
    if (error) throw mapError(error, "Failed to update title");
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.client
      .from("cookbook_generations")
      .delete()
      .eq("id", id);
    if (error) throw mapError(error, "Failed to delete generation");
  }
}

export function getGenerationRepository(): GenerationRepository {
  return new SupabaseGenerationRepository();
}
