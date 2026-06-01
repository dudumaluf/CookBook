import { buildCanvasKnowledge } from "./canvas";
import { buildGalleryKnowledge } from "./gallery";
import { buildIdentityKnowledge } from "./identity";
import { buildLibraryKnowledge } from "./library";
import { buildNodeCatalogKnowledge } from "./node-catalog";
import { buildRecipeCatalogKnowledge } from "./recipes";
import { buildSelectionKnowledge } from "./selection";
import { buildVocabularyKnowledge } from "./vocabulary";
import { getToolDefinitions } from "@/lib/assistant/tools";
import type { ChatMessage } from "@/lib/llm/types";

import { buildConversationMessages } from "./conversation";

/**
 * Knowledge bus — Slice 7.2 (ADR-0041), refined by Slice 1 of
 * "Smarter assistant".
 *
 * Single entry point for "what does the assistant know right now?".
 * Returns:
 *   - `staticPrefix`: identity + vocabulary + node catalog + tool
 *     surface description. Stable across a session — cacheable on
 *     models that honor Anthropic-style `cache_control` markers.
 *   - `dynamicSuffix`: recipes + canvas + selection + library +
 *     gallery. Recomputed per call (canvas changes, gallery grows).
 *   - `system` (legacy): the concatenated `staticPrefix\n\ndynamicSuffix`,
 *     same string the assistant has always seen. Kept for backward
 *     compatibility with any caller that doesn't care about the split.
 *   - `messages`: the conversation history converted to OpenAI Chat
 *     Completions `messages[]` shape, ready to prepend to the new
 *     user message.
 *
 * Why split here vs in the reasoner: only the knowledge bundle knows
 * which dimensions are static. Surfacing the split as a typed return
 * shape lets the reasoner emit a structured system message (two
 * content blocks, with `cache_control` on the prefix) when the
 * selected model supports caching, and a plain string otherwise.
 *
 * The function is async because two dimensions (recipes + gallery)
 * are DB-backed. Callers (the assistant) await once at the top of
 * `runReasoner`.
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
    /**
     * Skip the focused selection block (defaults: included whenever
     * `selectedNodeIds.length >= 2`). The block is auto-skipped on
     * 0/1-node selections — flip this to `true` to also skip
     * multi-node selections (used by tests + cost-sensitive recursive
     * tool calls).
     */
    selection?: boolean;
  };
}

export interface KnowledgeBundle {
  /**
   * Static portion of the system prompt — identity, vocabulary,
   * node catalog, tool descriptions. Doesn't change within a
   * session, so caching providers (Anthropic / Gemini) can serve
   * subsequent turns from a discounted cache read.
   */
  staticPrefix: string;
  /**
   * Dynamic portion — recipes, canvas, selection, library, gallery.
   * Recomputed each call because graph + gallery state evolves.
   */
  dynamicSuffix: string;
  /**
   * Legacy concatenated form: `staticPrefix + "\n\n" + dynamicSuffix`.
   * Same string the assistant has always seen. Kept so callers that
   * don't care about the split (or are running on caching-incapable
   * models) can keep their existing code path.
   */
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

  // Static — identity / vocabulary / node catalog / tool surface.
  // These don't change within a session.
  const staticSections: string[] = [];
  staticSections.push(buildIdentityKnowledge());
  staticSections.push(buildVocabularyKnowledge());
  if (!skip.nodeCatalog) staticSections.push(buildNodeCatalogKnowledge());
  // Tool surface description — auto-generated from the registry. Lives
  // in the static prefix because the registry is stable per release.
  const tools = getToolDefinitions();
  if (tools.length > 0) {
    const lines = ["## TOOLS YOU CAN CALL"];
    for (const t of tools) {
      lines.push(
        `### \`${t.function.name}\``,
        t.function.description,
      );
    }
    staticSections.push(lines.join("\n\n"));
  }

  // Dynamic — recipes / canvas / selection / library / gallery.
  // These change as the user works (new gallery entries, edited canvas,
  // different selection) so they invalidate the cache by design.
  const dynamicSections: string[] = [];
  if (recipeMd) dynamicSections.push(recipeMd);
  if (!skip.canvas) dynamicSections.push(buildCanvasKnowledge());
  // Selection block lives RIGHT after canvas — same scope, more focused.
  // Returns null when the user has 0/1 nodes selected, so we just skip
  // the push instead of branching on selection size here.
  const selectionMd = buildSelectionKnowledge({ skip: skip.selection });
  if (selectionMd) dynamicSections.push(selectionMd);
  if (!skip.library) dynamicSections.push(buildLibraryKnowledge());
  if (galleryMd) dynamicSections.push(galleryMd);

  const messages = skip.conversation ? [] : buildConversationMessages();

  const staticPrefix = staticSections.join("\n\n");
  const dynamicSuffix = dynamicSections.join("\n\n");
  // Legacy concatenation matches what callers used to receive — newline
  // separator between non-empty halves so two-block / one-string forms
  // produce identical text content.
  const system =
    staticPrefix && dynamicSuffix
      ? `${staticPrefix}\n\n${dynamicSuffix}`
      : staticPrefix || dynamicSuffix;

  return {
    staticPrefix,
    dynamicSuffix,
    system,
    messages,
  };
}
