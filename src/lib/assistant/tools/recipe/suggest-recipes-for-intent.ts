import { z } from "zod";

import { ROLES } from "@/lib/assistant/roles";
import { getRecipeRepository } from "@/lib/repositories/supabase-recipe-repository";

import type { AssistantTool } from "../index";

const argsSchema = z
  .object({
    userMessage: z
      .string()
      .min(1)
      .describe(
        "The user's original message (or a paraphrased intent). Used to score recipes by keyword overlap.",
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .describe("Max suggestions to return. Default 5."),
  })
  .strict();

/**
 * Heuristic recipe scorer — Phase E (Cookbook Library, ADR-0064).
 *
 * Pure function. Splits the user message into normalized tokens and
 * counts overlap with each recipe's name, description, and category.
 * Name hits weigh more than description hits which weigh more than
 * category hits.
 *
 * We deliberately keep this lo-fi — no embedding lookup, no RAG. The
 * tool returns CANDIDATES; the assistant decides which (if any) to
 * actually use, and explains its reasoning to the user. Empty result
 * = "I don't see a recipe that matches; let me build something
 * fresh." That outcome is fine and in fact useful: it tells the
 * assistant to fall back to construct-from-scratch.
 */
export function scoreRecipesForIntent(
  recipes: Array<{
    id: string;
    name: string;
    description: string;
    category: string;
    ownerId: string | null;
  }>,
  userMessage: string,
  limit: number,
): Array<{
  recipeId: string;
  name: string;
  description: string;
  category: string;
  isSystem: boolean;
  score: number;
  matched: string[];
}> {
  const tokens = tokenize(userMessage);
  if (tokens.length === 0) return [];

  const scored = recipes.map((r) => {
    const nameTokens = new Set(tokenize(r.name));
    const descTokens = new Set(tokenize(r.description));
    const categoryTokens = new Set(tokenize(r.category));
    const matched = new Set<string>();
    let score = 0;
    for (const t of tokens) {
      if (nameTokens.has(t)) {
        score += 3;
        matched.add(t);
      }
      if (descTokens.has(t)) {
        score += 1;
        matched.add(t);
      }
      if (categoryTokens.has(t)) {
        score += 0.5;
        matched.add(t);
      }
    }
    return {
      recipeId: r.id,
      name: r.name,
      description: r.description,
      category: r.category,
      isSystem: r.ownerId === null,
      score,
      matched: Array.from(matched),
    };
  });

  return scored
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "do", "for", "from",
  "give", "go", "had", "has", "have", "he", "her", "him", "his", "i",
  "if", "in", "into", "is", "it", "its", "let", "like", "make", "me",
  "my", "no", "not", "now", "of", "on", "or", "our", "out", "she",
  "so", "some", "than", "that", "the", "their", "them", "then", "there",
  "these", "they", "this", "to", "us", "want", "was", "we", "were",
  "what", "when", "which", "who", "will", "with", "would", "you", "your",
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

const ROLE_HINTS: Record<string, string> = {
  storyboard:
    "If the user wants multi-panel storyboards or visual continuity across shots, consider switch_role to `storyboard-director`.",
  panel: "Storyboard recipes pair well with the storyboard-director role.",
  panels: "Storyboard recipes pair well with the storyboard-director role.",
  shot:
    "Single-shot scene work pairs with the timeline-director role for time-based prompts, or stays in general for one-off scenes.",
  scene:
    "If the request is a single descriptive scene, the simple-scene-prompter recipe + general role is usually the lightest path.",
  timeline:
    "Multi-beat / timed shots pair with the timeline-director role.",
  recipe:
    "Composing or refactoring a recipe pairs with the recipe-architect role.",
  prompt:
    "Crafting a prompt from a brief pairs with the prompt-engineer role.",
  video: "Video work pairs well with timeline-director or storyboard-director.",
};

function deriveRoleHints(matched: string[]): string[] {
  const hints = new Set<string>();
  for (const t of matched) {
    if (ROLE_HINTS[t]) hints.add(ROLE_HINTS[t]);
  }
  return Array.from(hints);
}

/**
 * `suggest_recipes_for_intent` — Phase E.
 *
 * Returns the top N recipes that match the user's stated intent,
 * with role-pairing hints derived from the matched keywords. The
 * General role uses this BEFORE constructing from scratch — recipes
 * are usually faster + better-tested than ad-hoc graphs.
 *
 * Returns `{ ok: true, suggestions: [...], roleHints: [...] }` so
 * the assistant can reason over both signals (which recipe + which
 * role) in one tool call.
 */
export const suggestRecipesForIntentTool: AssistantTool = {
  name: "suggest_recipes_for_intent",
  description:
    "Score the recipe catalog against the user's stated intent and return the top matches with role-pairing hints. Use this BEFORE constructing from scratch — a system or saved recipe is usually faster + more reliable than a fresh graph. Empty results mean 'no recipe matches; fall back to construct'. The hints suggest which assistant role pairs well with the matched recipes (so the General role can recommend a switch_role).",
  parameters: {
    type: "object",
    properties: {
      userMessage: {
        type: "string",
        description:
          "The user's message or a paraphrased intent — what are they trying to make?",
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 10,
        description: "Max suggestions to return (default 5).",
      },
    },
    required: ["userMessage"],
    additionalProperties: false,
  },
  execute: async (rawArgs, ctx) => {
    const args = argsSchema.parse(rawArgs ?? {});
    const limit = args.limit ?? 5;
    const recipes = await getRecipeRepository().list({
      ownerId: ctx.ownerId ?? null,
      includeSystem: true,
      limit: 200,
    });
    const suggestions = scoreRecipesForIntent(
      recipes.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description ?? "",
        category: r.category ?? "",
        ownerId: r.ownerId ?? null,
      })),
      args.userMessage,
      limit,
    );

    const matched = new Set<string>();
    for (const s of suggestions) for (const t of s.matched) matched.add(t);
    const roleHints = deriveRoleHints(Array.from(matched));

    return {
      ok: true,
      suggestions,
      roleHints,
      knownRoles: ROLES.map((r) => ({ id: r.id, label: r.label })),
      hint:
        suggestions.length === 0
          ? "No recipe matched. Either ask the user for a clearer intent, or fall back to constructing a fresh graph from the schema registry."
          : "Consider read_recipe on the top match before instantiating, especially if the user's intent has nuance.",
    };
  },
};
