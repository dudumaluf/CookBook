"use client";

import type { AssistantMessage } from "@/lib/assistant/types";
import {
  getAssistantMessageRepository,
} from "@/lib/repositories/supabase-assistant-message-repository";
import type { AssistantMessageRecord } from "@/lib/repositories/assistant-message-repository";
import { useAssistantStore } from "@/lib/stores/assistant-store";
import { useProjectStore } from "@/lib/stores/project-store";

/**
 * chat-sync — Slice 6.8 (ADR-0040).
 *
 * Two-way bridge between the in-memory `useAssistantStore` and the
 * cloud `cookbook_assistant_messages` table:
 *
 *   1. **`hydrateChatForProject(projectId)`** — load every existing
 *      message for the project (oldest-first), rehydrate the in-memory
 *      store. Called once after the project bootstrap finishes.
 *   2. **`persistMessage(message)`** — INSERT one message into the
 *      cloud table. Called by the prompt bar / chat sheet whenever a
 *      new message lands locally (user submission, assistant response,
 *      assistant error). Fire-and-forget; failures are logged but
 *      don't block the user (the in-memory copy is the canonical UX).
 *   3. **`clearChatForProject(projectId)`** — wipe both the in-memory
 *      store + the cloud table for the active project. Used by the
 *      ChatSheet's "Clear" button.
 *
 * Why no subscription / debounced auto-save here?
 *
 *   - Chat messages are **append-only**, immutable once committed. A
 *     subscription on the store would re-fire on every isThinking
 *     toggle and unnecessarily INSERT-storm the table.
 *   - Imperative `persistMessage` calls at the exact moment the
 *     message is committed give us full control + clean error
 *     handling without any debounce ambiguity.
 *
 * Translation between record (cloud shape) and message (UI shape):
 *
 *   record.cost_usd (numeric, nullable) ↔ message.costUsd (number?)
 *   record.created_at (timestamptz) ↔ message.timestamp (number, ms)
 */

function recordToMessage(row: AssistantMessageRecord): AssistantMessage {
  return {
    role: row.role,
    content: row.content,
    plan: row.plan ?? undefined,
    error: row.error ?? undefined,
    costUsd: row.costUsd ?? undefined,
    toolReceipts: row.toolReceipts ?? undefined,
    question: row.question ?? undefined,
    timestamp: new Date(row.createdAt).getTime(),
  };
}

export async function hydrateChatForProject(
  projectId: string,
): Promise<void> {
  try {
    const rows = await getAssistantMessageRepository().listForProject(
      projectId,
    );
    const messages = rows.map(recordToMessage);
    // Replace the in-memory chat with whatever the cloud has. New
    // sessions on a fresh device pick up the entire history; sessions
    // that already had something get the cloud's truth (cloud is
    // canonical for chat).
    useAssistantStore.setState({ messages });
  } catch (err) {
    console.warn("[chat-sync] hydrate failed:", err);
  }
}

export async function persistMessage(
  message: AssistantMessage,
): Promise<void> {
  const projectId = useProjectStore.getState().id;
  if (!projectId) return;
  // We need ownerId — read it from the auth client's current session
  // rather than threading it as a parameter; persistMessage is invoked
  // from prompt-bar code where ownerId would otherwise have to hop
  // through several call sites.
  const supabase = (
    await import("@/lib/supabase/client")
  ).getSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  try {
    await getAssistantMessageRepository().insert({
      projectId,
      ownerId: user.id,
      role: message.role,
      content: message.content,
      plan: message.plan ?? null,
      error: message.error ?? null,
      costUsd: message.costUsd ?? null,
      toolReceipts: message.toolReceipts ?? null,
      question: message.question ?? null,
    });
  } catch (err) {
    console.warn("[chat-sync] persist failed:", err);
  }
}

export async function clearChatForProject(): Promise<void> {
  const projectId = useProjectStore.getState().id;
  if (!projectId) {
    useAssistantStore.getState().clear();
    return;
  }
  try {
    await getAssistantMessageRepository().clearForProject(projectId);
  } catch (err) {
    console.warn("[chat-sync] clear failed:", err);
  } finally {
    useAssistantStore.getState().clear();
  }
}
