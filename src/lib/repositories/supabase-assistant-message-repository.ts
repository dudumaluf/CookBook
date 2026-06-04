import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  AssistantPlan,
  PersistedQuestion,
  PersistedToolReceipt,
} from "@/lib/assistant/types";
import { getSupabaseClient } from "@/lib/supabase/client";

import {
  type AssistantMessageRecord,
  type AssistantMessageRepository,
  AssistantMessageRepositoryError,
  type InsertAssistantMessageInput,
} from "./assistant-message-repository";

interface RawAssistantMessageRow {
  id: string;
  project_id: string;
  owner_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  plan: AssistantPlan | null;
  error: string | null;
  cost_usd: number | string | null;
  tool_receipts: PersistedToolReceipt[] | null;
  question: PersistedQuestion | null;
  created_at: string;
}

function rowToRecord(row: RawAssistantMessageRow): AssistantMessageRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    ownerId: row.owner_id,
    role: row.role,
    content: row.content,
    plan: row.plan,
    error: row.error,
    // Postgres `numeric` round-trips as string in some drivers; coerce.
    costUsd:
      row.cost_usd === null || row.cost_usd === undefined
        ? null
        : Number(row.cost_usd),
    toolReceipts: row.tool_receipts ?? null,
    question: row.question ?? null,
    createdAt: row.created_at,
  };
}

function mapError(
  err: unknown,
  fallback: string,
): AssistantMessageRepositoryError {
  const e = err as { code?: string; message?: string } | null;
  if (e?.code === "PGRST116") {
    return new AssistantMessageRepositoryError(
      e.message ?? fallback,
      "not_found",
    );
  }
  if (e?.code === "42501") {
    return new AssistantMessageRepositoryError(
      e.message ?? "Access denied by RLS policy",
      "permission_denied",
    );
  }
  return new AssistantMessageRepositoryError(
    e?.message ?? fallback,
    "unknown",
  );
}

export class SupabaseAssistantMessageRepository
  implements AssistantMessageRepository
{
  private client: SupabaseClient;

  constructor(client?: SupabaseClient) {
    this.client = client ?? getSupabaseClient();
  }

  async insert(
    input: InsertAssistantMessageInput,
  ): Promise<AssistantMessageRecord> {
    const payload = {
      project_id: input.projectId,
      owner_id: input.ownerId,
      role: input.role,
      content: input.content,
      plan: input.plan ?? null,
      error: input.error ?? null,
      cost_usd: input.costUsd ?? null,
      tool_receipts: input.toolReceipts ?? null,
      question: input.question ?? null,
    };
    const { data, error } = await this.client
      .from("cookbook_assistant_messages")
      .insert(payload)
      .select("*")
      .single();
    if (error) throw mapError(error, "Failed to insert assistant message");
    return rowToRecord(data as RawAssistantMessageRow);
  }

  async listForProject(
    projectId: string,
    limit: number = 200,
  ): Promise<AssistantMessageRecord[]> {
    const { data, error } = await this.client
      .from("cookbook_assistant_messages")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true })
      .limit(limit);
    if (error)
      throw mapError(error, "Failed to list assistant messages");
    return ((data ?? []) as RawAssistantMessageRow[]).map(rowToRecord);
  }

  async clearForProject(projectId: string): Promise<void> {
    const { error } = await this.client
      .from("cookbook_assistant_messages")
      .delete()
      .eq("project_id", projectId);
    if (error) throw mapError(error, "Failed to clear assistant messages");
  }
}

export function getAssistantMessageRepository(): AssistantMessageRepository {
  return new SupabaseAssistantMessageRepository();
}
