import { z } from "zod";

import { getGenerationRepository } from "@/lib/repositories/supabase-generation-repository";

import type { AssistantTool } from "../index";

/**
 * read_gallery — Slice 7.2 (ADR-0041).
 *
 * Query the user's persisted generations with rich filters. Use to
 * answer "show me my last 4 cyberpunk images", "find the prompt I
 * used in that pinned image", "what generations did I make
 * yesterday?".
 *
 * Output shape mirrors the GenerationRecord interface but trims to
 * the fields the LLM cares about (id, kind, title, promptText,
 * pinned, output type, createdAt).
 */

const argsSchema = z
  .object({
    nodeId: z.string().optional(),
    nodeKind: z.string().optional(),
    outputType: z.enum(["image", "text", "video"]).optional(),
    pinnedOnly: z.boolean().optional(),
    promptContains: z.string().optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();

export const readGalleryTool: AssistantTool = {
  name: "read_gallery",
  description:
    "Query the user's gallery (persisted generations). Filters: nodeId, nodeKind, outputType (image/text/video), pinnedOnly, promptContains (substring), limit (default 20, max 100).",
  parameters: {
    type: "object",
    properties: {
      nodeId: {
        type: "string",
        description: "Restrict to generations from one specific node id.",
      },
      nodeKind: {
        type: "string",
        description:
          "Restrict by source node kind (e.g. higgsfield-image-gen, llm-text).",
      },
      outputType: {
        type: "string",
        enum: ["image", "text", "video"],
        description: "Filter by output type.",
      },
      pinnedOnly: {
        type: "boolean",
        description: "Only return pinned (curated) generations.",
      },
      promptContains: {
        type: "string",
        description:
          "Case-insensitive substring search against prompt_text.",
      },
      limit: {
        type: "number",
        description: "Max rows (default 20, max 100).",
      },
    },
    additionalProperties: false,
  },
  execute: async (rawArgs, ctx) => {
    const args = argsSchema.parse(rawArgs ?? {});
    if (!ctx.projectId) {
      return { error: "no active project" };
    }
    const repo = getGenerationRepository();
    const rows = await repo.list({
      projectId: ctx.projectId,
      ...(args.nodeId !== undefined ? { nodeId: args.nodeId } : {}),
      ...(args.nodeKind !== undefined ? { nodeKind: args.nodeKind } : {}),
      ...(args.outputType !== undefined
        ? { outputType: args.outputType }
        : {}),
      ...(args.pinnedOnly !== undefined
        ? { pinnedOnly: args.pinnedOnly }
        : {}),
      ...(args.promptContains !== undefined
        ? { promptContains: args.promptContains }
        : {}),
      limit: args.limit ?? 20,
    });
    return {
      count: rows.length,
      generations: rows.map((r) => ({
        id: r.id,
        nodeId: r.nodeId,
        nodeKind: r.nodeKind,
        title: r.title,
        promptText: r.promptText,
        pinned: r.pinned,
        tags: r.tags,
        createdAt: r.createdAt,
        output: r.output,
      })),
    };
  },
};
