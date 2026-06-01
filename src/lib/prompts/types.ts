/**
 * Cookbook Library — prompt-registry types (Phase A).
 *
 * Shared shapes for the Prompts tab. Two flavors of prompt:
 *
 *   1. Code-defined  — declared in source as a const (REASONER_INSTRUCTIONS,
 *                      future role overlays, future node-default prompts).
 *                      Listed by `getCodePrompts()` in registry.ts.
 *   2. Recipe-internal — extracted by walking a recipe's subgraph for `text`
 *                        nodes (their `text` config) and `llm-text` nodes.
 *                        Built per recipe by `extractRecipePrompts()`.
 *
 * Both shapes share `PromptEntry` so the UI renders them through one path.
 */

/**
 * Where this prompt fits in the system. Drives Prompts-tab grouping +
 * the badge color in the UI.
 */
export type PromptSection =
  /** The base assistant prompt; future specialist role overlays. */
  | "assistant"
  /** Internal prompt baked into a recipe's subgraph. */
  | "recipe-internal"
  /** Default prompt for a node kind (the starter text for new instances). */
  | "node-default";

/**
 * One viewable prompt. Held read-only in Phase A; Phase C will add
 * `editable: true` for prompts the user can override.
 */
export interface PromptEntry {
  /** Stable id for React keys + future override lookup. */
  key: string;
  title: string;
  /**
   * Plain-English description: where + when this prompt fires. Shown
   * under the title in the Prompts tab so users understand the context
   * without reading code.
   */
  description: string;
  section: PromptSection;
  content: string;
  /**
   * Optional recipe pointer — set on `section: "recipe-internal"`
   * entries so the UI can link back to the source recipe in Tab 1.
   */
  recipeId?: string;
  recipeName?: string;
  /**
   * Optional internal-node id — set on `recipe-internal` entries so
   * the UI can show "from node `text-1` in `recipe-name`".
   */
  internalNodeId?: string;
  /**
   * Optional internal-node kind — `text` / `llm-text` / etc. — so the
   * UI can render a small icon + label without re-walking the
   * subgraph.
   */
  internalNodeKind?: string;
  /**
   * Optional purpose hint — e.g. "system" / "user" / "instructions" —
   * inferred from how the node is wired downstream. Helps the reader
   * understand what role this prompt plays in the recipe.
   */
  purpose?: string;
}
