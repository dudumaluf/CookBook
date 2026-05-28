import { buildCanvasKnowledge } from "./canvas";
import { buildGalleryKnowledge } from "./gallery";
import { buildIdentityKnowledge } from "./identity";
import { buildLibraryKnowledge } from "./library";
import { buildNodeCatalogKnowledge } from "./node-catalog";
import { buildRecipeCatalogKnowledge } from "./recipes";
import { buildVocabularyKnowledge } from "./vocabulary";
import { getToolDefinitions } from "@/lib/assistant/tools";
import type { ChatMessage } from "@/lib/llm/types";

import { buildConversationMessages } from "./conversation";

/**
 * Knowledge bus — Slice 7.2 (ADR-0041).
 *
 * Single entry point for "what does the assistant know right now?".
 * Returns:
 *   - `system`: a long markdown string going into the system prompt
 *     (identity + vocabulary + node catalog + recipes + canvas +
 *     library + gallery + tool surface description).
 *   - `messages`: the conversation history converted to OpenAI Chat
 *     Completions `messages[]` shape, ready to prepend to the new
 *     user message.
 *
 * Slice 7.2 ships ALL eight knowledge dimensions. The `relevance`
 * hints are honored as filters (skip dimensions when the caller
 * knows they're irrelevant) but default to "include everything"
 * because token budget at M0a-scale is comfortable.
 *
 * The function is async because two dimensions (recipes + gallery)
 * are DB-backed. Callers (the assistant) await once at the top of
 * `planFromAssistant`.
 */

export interface KnowledgeBundleOptions {
  /** Owner uuid — required; recipe catalog scopes by it. */
  ownerId: string;
  /** Project uuid — required; gallery scopes by it. */
  projectId: string;
  /**
   * Hints to skip specific dimensions (default: include all). Useful
   * for cost-sensitive flows or when the assistant is recursing on
   * itself and doesn't need the full context blob again.
   */
  skip?: {
    canvas?: boolean;
    library?: boolean;
    gallery?: boolean;
    recipes?: boolean;
    nodeCatalog?: boolean;
    conversation?: boolean;
  };
}

export interface KnowledgeBundle {
  /** Concatenated markdown for the system prompt. */
  system: string;
  /** OpenAI-shape conversation history (oldest-first). */
  messages: ChatMessage[];
}

export async function buildKnowledgeBundle(
  options: KnowledgeBundleOptions,
): Promise<KnowledgeBundle> {
  const { ownerId, projectId, skip = {} } = options;

  // Two async dimensions in parallel for speed.
  const [recipeMd, galleryMd] = await Promise.all([
    skip.recipes ? null : buildRecipeCatalogKnowledge(ownerId),
    skip.gallery ? null : buildGalleryKnowledge(projectId),
  ]);

  const sections: string[] = [];
  sections.push(buildIdentityKnowledge());
  sections.push(buildVocabularyKnowledge());
  if (!skip.nodeCatalog) sections.push(buildNodeCatalogKnowledge());
  if (recipeMd) sections.push(recipeMd);
  if (!skip.canvas) sections.push(buildCanvasKnowledge());
  if (!skip.library) sections.push(buildLibraryKnowledge());
  if (galleryMd) sections.push(galleryMd);
  // Tool surface description — auto-generated from the registry. Empty
  // until Slice 7.2 read tools register; populated by 7.2 onwards.
  const tools = getToolDefinitions();
  if (tools.length > 0) {
    const lines = ["## TOOLS YOU CAN CALL"];
    for (const t of tools) {
      lines.push(
        `### \`${t.function.name}\``,
        t.function.description,
      );
    }
    sections.push(lines.join("\n\n"));
  }

  const messages = skip.conversation ? [] : buildConversationMessages();

  return {
    system: sections.join("\n\n"),
    messages,
  };
}
