import { z } from "zod";

import { getRecipeRepository } from "@/lib/repositories/supabase-recipe-repository";

import type { AssistantTool } from "../index";

/**
 * list_recipe_versions — Tier 1.3 (2026-06-03).
 *
 * List historical versions of a recipe (everything in
 * `cookbook_recipe_versions` for this recipeId, ordered most-recent
 * first). The current version lives on `cookbook_recipes` itself and
 * is also surfaced here as the first row so the LLM gets the full
 * timeline in one shot.
 *
 * Each row carries enough metadata to narrate ("v3 saved 2 days ago
 * by you, named 'Storyboard Director', 12 nodes, 18 edges") without
 * the LLM having to call additional tools. The actual subgraph bytes
 * are NOT included by default — they're heavy and rarely needed for
 * version-list narration. Pass `includeSubgraph: true` to surface
 * them when the LLM is about to diff or rollback.
 */

const argsSchema = z
  .object({
    recipeId: z.string().min(1),
    includeSubgraph: z.boolean().optional(),
  })
  .strict();

interface VersionRow {
  version: number;
  name: string;
  description: string | null;
  category: string | null;
  savedBy: string | null;
  createdAt: string;
  nodeCount: number;
  edgeCount: number;
  isCurrent: boolean;
  subgraph?: unknown;
}

export const listRecipeVersionsTool: AssistantTool = {
  name: "list_recipe_versions",
  description:
    "List a recipe's version history (current + all archived versions). Returns rows ordered most-recent first with version number, name, savedBy, createdAt, node/edge counts, and isCurrent. Pass includeSubgraph=true to surface the full subgraph bytes (heavier — only for diff/rollback).",
  parameters: {
    type: "object",
    properties: {
      recipeId: { type: "string" },
      includeSubgraph: {
        type: "boolean",
        description:
          "Default false. Set true when about to diff or restore a version.",
      },
    },
    required: ["recipeId"],
    additionalProperties: false,
  },
  execute: async (rawArgs) => {
    const args = argsSchema.parse(rawArgs);
    const repo = getRecipeRepository();
    const current = await repo.get(args.recipeId);
    if (!current) {
      return {
        ok: false,
        error: `No recipe with id ${args.recipeId}`,
      };
    }
    const archived = await repo.listVersions(args.recipeId);
    const rows: VersionRow[] = [];
    rows.push({
      version: current.version,
      name: current.name,
      description: current.description,
      category: current.category,
      savedBy: null, // current row doesn't track who pressed save last
      createdAt: current.createdAt,
      nodeCount: current.subgraph.nodes.length,
      edgeCount: current.subgraph.edges.length,
      isCurrent: true,
      ...(args.includeSubgraph ? { subgraph: current.subgraph } : {}),
    });
    for (const v of archived) {
      rows.push({
        version: v.version,
        name: v.name,
        description: v.description,
        category: v.category,
        savedBy: v.savedBy,
        createdAt: v.createdAt,
        nodeCount: v.subgraph.nodes.length,
        edgeCount: v.subgraph.edges.length,
        isCurrent: false,
        ...(args.includeSubgraph ? { subgraph: v.subgraph } : {}),
      });
    }
    return {
      ok: true,
      recipeId: args.recipeId,
      currentVersion: current.version,
      versionCount: rows.length,
      versions: rows,
    };
  },
};
