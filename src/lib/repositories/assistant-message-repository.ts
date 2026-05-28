import type { AssistantPlan } from "@/lib/assistant/types";

/**
 * AssistantMessageRepository — Slice 6.8 (ADR-0040).
 *
 * Persists every chat message (user / assistant) to
 * `cookbook_assistant_messages` so the conversation survives reload
 * and cross-machine sync.
 *
 * Mirrors the same Repository contract as projects / generations /
 * recipes (insert + list + remove + listForProject). No update — chat
 * messages are immutable once committed; if the assistant retries,
 * we append a new message rather than mutating the old one.
 */

export interface AssistantMessageRecord {
  id: string;
  projectId: string;
  ownerId: string;
  role: "user" | "assistant" | "system";
  content: string;
  plan: AssistantPlan | null;
  error: string | null;
  costUsd: number | null;
  createdAt: string;
}

export interface InsertAssistantMessageInput {
  projectId: string;
  ownerId: string;
  role: "user" | "assistant" | "system";
  content: string;
  plan?: AssistantPlan | null;
  error?: string | null;
  costUsd?: number | null;
}

export interface AssistantMessageRepository {
  insert(input: InsertAssistantMessageInput): Promise<AssistantMessageRecord>;
  listForProject(
    projectId: string,
    limit?: number,
  ): Promise<AssistantMessageRecord[]>;
  /** Wipe an entire project's chat. Used by "Clear" affordance. */
  clearForProject(projectId: string): Promise<void>;
}

export class AssistantMessageRepositoryError extends Error {
  readonly code:
    | "not_found"
    | "permission_denied"
    | "network"
    | "unknown";
  constructor(
    message: string,
    code: AssistantMessageRepositoryError["code"],
  ) {
    super(message);
    this.name = "AssistantMessageRepositoryError";
    this.code = code;
  }
}
