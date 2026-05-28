import { z } from "zod";

import { getGenerationRepository } from "@/lib/repositories/supabase-generation-repository";

import type { AssistantTool } from "../index";

/**
 * find_similar_generations — Slice 7.6 (ADR-0045).
 *
 * Search the user's persisted generations by natural-language query.
 * Slice 7.6 ships full-text search over the `search_vector` tsvector
 * column populated for prompt_text + title; the same tool will gain
 * pgvector cosine similarity transparently once embeddings are
 * populated (no API change for the LLM).
 *
 * Scope:
 *   - "project" (default): only this project's generations.
 *   - "owner": every project the user owns. Use when the assistant
 *     needs cross-session memory ("you made this last week in the
 *     Editorial project — want me to riff on it?").
 *
 * Returns up to `limit` rows (default 8, max 50) sorted newest-first.
 */

const argsSchema = z
  .object({
    query: z.string().min(1),
    scope: z.enum(["project", "owner"]).optional(),
    outputType: z.enum(["image", "text", "video"]).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();

export const findSimilarGenerationsTool: AssistantTool = {
  name: "find_similar_generations",
  description:
    "Search persisted generations by natural-language query. Pass `scope: 'owner'` for cross-project memory; default 'project' searches the current one only. Returns id, kind, prompt, title, output, createdAt for the top matches.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Natural-language search. Quoted phrases honored (e.g. '\"film noir\" portrait').",
      },
      scope: {
        type: "string",
        enum: ["project", "owner"],
        description:
          "'project' = current project only (default). 'owner' = all of the user's projects.",
      },
      outputType: {
        type: "string",
        enum: ["image", "text", "video"],
      },
      limit: {
        type: "number",
        description: "Max rows (default 8, max 50).",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
  execute: async (rawArgs, ctx) => {
    const args = argsSchema.parse(rawArgs);
    const scope = args.scope ?? "project";
    if (scope === "project" && !ctx.projectId) {
      return { ok: false, error: "no active project" };
    }
    if (scope === "owner" && !ctx.ownerId) {
      return { ok: false, error: "no authenticated owner" };
    }
    const rows = await getGenerationRepository().findSimilar({
      query: args.query,
      scope,
      ...(scope === "project" ? { projectId: ctx.projectId } : {}),
      ...(scope === "owner" ? { ownerId: ctx.ownerId } : {}),
      ...(args.outputType ? { outputType: args.outputType } : {}),
      limit: args.limit ?? 8,
    });
    return {
      ok: true,
      count: rows.length,
      generations: rows.map((r) => ({
        id: r.id,
        nodeKind: r.nodeKind,
        title: r.title,
        promptText: r.promptText,
        output: r.output,
        createdAt: r.createdAt,
      })),
    };
  },
};
