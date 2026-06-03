import { z } from "zod";

import { useAssetStore } from "@/lib/stores/asset-store";

import type { AssistantTool } from "../index";

/**
 * create_group — Tier 1.2 (2026-06-03).
 *
 * Bundle a list of image asset ids into an `asset-group`. The
 * assistant now does "I grouped your moodboard refs as 'Couch
 * scene'" via this tool. The store de-dupes incoming ids and
 * preserves first-seen order.
 *
 * `isUntitled` mirrors the canvas multi-drag pathway — when the LLM
 * is creating a group on the user's behalf they almost always want
 * a real, named group (so the auto-cleanup rule doesn't reap it on
 * the next reload). We default `isUntitled = false` here.
 */

const argsSchema = z
  .object({
    name: z.string().optional(),
    assetIds: z.array(z.string()),
    isUntitled: z.boolean().optional(),
    scope: z.enum(["project", "global"]).optional(),
  })
  .strict();

export const createGroupTool: AssistantTool = {
  name: "create_group",
  description:
    "Create an asset-group bundling a list of image asset ids. Returns the new groupId. De-dupes incoming ids while preserving order. Provide `name` for a real group; omit for an auto 'Untitled N' (only useful when you also pass isUntitled=true and intend the auto-cleanup rule to apply).",
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description:
          "Display name. Omit + isUntitled=true to opt into the 'Untitled N' auto-name.",
      },
      assetIds: {
        type: "array",
        items: { type: "string" },
        description:
          "Image asset ids to bundle. Order is preserved minus duplicates.",
      },
      isUntitled: {
        type: "boolean",
        description:
          "Default false. Set true ONLY if the group should be eligible for auto-cleanup when no node references it. The user-facing 'create group' flow you fire from chat almost always wants false.",
      },
      scope: {
        type: "string",
        enum: ["project", "global"],
        description: "Default 'project'.",
      },
    },
    required: ["assetIds"],
    additionalProperties: false,
  },
  execute: async (rawArgs) => {
    const args = argsSchema.parse(rawArgs);
    const id = useAssetStore.getState().createGroup({
      name: args.name,
      assetIds: args.assetIds,
      isUntitled: args.isUntitled ?? false,
      scope: args.scope ?? "project",
    });
    return { ok: true, groupId: id };
  },
};
