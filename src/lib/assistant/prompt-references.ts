/**
 * Prompt references (chat attachments + @-mentions).
 *
 * When the user attaches a file or @-mentions a Library asset / Gallery
 * generation in the prompt bar, we carry a small descriptor so the
 * reasoner can tell the assistant "the user pointed at THESE items — use
 * them directly" (vs the generic library/gallery listing in the knowledge
 * bundle). The descriptor stays tiny (id + label + url + type) so it's
 * cheap to thread through and to render as a chip.
 */

export type PromptReferenceKind = "asset" | "generation";

export type PromptReferenceMedia =
  | "image"
  | "video"
  | "audio"
  | "text"
  | "soul-id"
  | "group"
  | "other";

export interface PromptReference {
  /** Stable chip id (UI-local). */
  id: string;
  kind: PromptReferenceKind;
  /** Underlying asset id or generation id (what the assistant wires/reads). */
  refId: string;
  /** User-visible, editable name (asset name / generation title). */
  label: string;
  mediaType: PromptReferenceMedia;
  /** Thumbnail / media URL for the chip + for the assistant to consume. */
  url?: string;
}

/**
 * Render the references as a compact note appended to the user's message
 * so the assistant knows exactly which items to use (with their id + url
 * so it can wire them into nodes).
 */
export function buildReferencesNote(refs: readonly PromptReference[]): string {
  if (refs.length === 0) return "";
  const lines = refs.map((r) => {
    const parts = [
      `"${r.label}"`,
      `${r.mediaType} ${r.kind}`,
      `id=${r.refId}`,
      r.url ? `url=${r.url}` : "",
    ].filter(Boolean);
    return `- ${parts.join(" · ")}`;
  });
  return [
    "[Referenced items the user attached or @-mentioned — use these directly when building/running the workflow:]",
    ...lines,
  ].join("\n");
}
