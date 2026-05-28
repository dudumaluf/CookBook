import { getGenerationRepository } from "@/lib/repositories/supabase-generation-repository";
import type { GenerationRecord } from "@/lib/repositories/generation-repository";

/**
 * Knowledge dimension: gallery state — Slice 7.2 (ADR-0041).
 *
 * Recent generations the user has produced — a compact "what have I
 * been making lately" snapshot. The assistant uses it for context
 * ("you've been generating cyberpunk portraits — want me to keep
 * that style?") and as the starting set for `read_gallery({ filter })`
 * follow-ups.
 *
 * Strategy:
 *   1. Latest 15 generations across all kinds (covers ~last week of
 *      activity for a regular user).
 *   2. Plus any pinned generations (max 10) — pinned ≈ "user
 *      curated, treat as durable".
 *   3. De-duplicate by id.
 *
 * For each generation we surface:
 *   - id, kind, prompt_text (truncated), title (when set), createdAt
 *
 * URLs are NOT included — they're heavy and the assistant can fetch
 * them via `read_gallery({ filter })` if needed.
 */

const RECENT_LIMIT = 15;
const PINNED_LIMIT = 10;
const PROMPT_TRUNCATE = 120;

function truncate(s: string | null, n: number): string {
  if (!s) return "_(no prompt)_";
  if (s.length <= n) return s;
  return s.slice(0, n - 3) + "...";
}

function shortDate(iso: string): string {
  // 2026-05-28T13:41:31Z → 2026-05-28
  return iso.slice(0, 10);
}

function formatGeneration(r: GenerationRecord): string {
  const title = r.title ? `"${r.title}" ` : "";
  const pin = r.pinned ? "📌 " : "";
  return `  - ${pin}${r.id} ${title}[${r.nodeKind}] ${shortDate(r.createdAt)} · ${truncate(r.promptText, PROMPT_TRUNCATE)}`;
}

export async function buildGalleryKnowledge(
  projectId: string,
): Promise<string> {
  const repo = getGenerationRepository();
  let recent: GenerationRecord[] = [];
  let pinned: GenerationRecord[] = [];
  try {
    [recent, pinned] = await Promise.all([
      repo.list({ projectId, limit: RECENT_LIMIT }),
      repo.list({ projectId, pinnedOnly: true, limit: PINNED_LIMIT }),
    ]);
  } catch (err) {
    console.warn("[knowledge/gallery] list failed:", err);
    return `## GALLERY\n_(failed to load recent generations)_`;
  }

  // Merge + dedupe (pinned might overlap with recent).
  const seen = new Set<string>();
  const merged: GenerationRecord[] = [];
  for (const r of [...pinned, ...recent]) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    merged.push(r);
  }

  if (merged.length === 0) {
    return `## GALLERY\n_(empty — no generations yet for this project)_`;
  }

  const lines: string[] = [
    `## GALLERY (${merged.length} recent / pinned, of all generations)`,
    "",
    "Format: `id [kind] date · prompt` — pinned items prefixed 📌",
  ];
  for (const r of merged) lines.push(formatGeneration(r));
  return lines.join("\n");
}
