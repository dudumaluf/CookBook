import { buildIdentityKnowledge } from "./identity";

/**
 * Knowledge bus — Slice 7.1 (ADR-0041) shell, full implementation in
 * Slice 7.2.
 *
 * The bus is the single entry point for "what does the assistant know
 * right now?". Each dimension is a module under `knowledge/` that
 * builds a markdown / structured chunk to embed in the system prompt
 * (or, in 7.6, retrievable via RAG).
 *
 * Slice 7.1 ships ONE dimension: `identity`. The other 8 (catalog,
 * canvas, library, gallery, recipes, conversation, plus 2 reserved)
 * land in 7.2 — the bus structure exists today so adding them is
 * mechanical.
 *
 * `buildKnowledgeBundle({ relevance })` will eventually accept hints
 * to scope what's loaded (e.g. "user is asking about generations →
 * include gallery + conversation, skip library"). 7.1 ignores the
 * hints and just emits identity; 7.2 expands.
 */

export interface KnowledgeBundleOptions {
  /**
   * Hints the relevance scorer that picks which dimensions to load.
   * Slice 7.1 ignores; 7.2+ honors.
   */
  relevance?: {
    needsCanvas?: boolean;
    needsLibrary?: boolean;
    needsGallery?: boolean;
    needsRecipes?: boolean;
    needsConversation?: boolean;
  };
}

/**
 * Returns the system-prompt knowledge block as a single markdown
 * string. Caller embeds it into the system message of the LLM call.
 */
export function buildKnowledgeBundle(
  _options: KnowledgeBundleOptions = {},
): string {
  const sections: string[] = [];
  sections.push(buildIdentityKnowledge());
  // Future dimensions (Slice 7.2):
  //   sections.push(buildVocabularyKnowledge());
  //   sections.push(buildNodeCatalogKnowledge());
  //   sections.push(buildRecipeCatalogKnowledge(...));
  //   sections.push(buildCanvasKnowledge(...));
  //   sections.push(buildLibraryKnowledge(...));
  //   sections.push(buildGalleryKnowledge(...));
  //   sections.push(buildConversationKnowledge(...));
  return sections.join("\n\n");
}
