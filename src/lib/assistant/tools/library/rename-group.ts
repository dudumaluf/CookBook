import { z } from "zod";

import { useAssetStore } from "@/lib/stores/asset-store";

import type { AssistantTool } from "../index";

/**
 * rename_group — Tier 1.2 (2026-06-03).
 *
 * Rename an asset-group. Empty / whitespace-only names are rejected
 * (mirrors the store's defensive guard). The store flips
 * `isUntitled → false` on first rename — once the user / assistant
 * has named it intentionally, the auto-cleanup rule no longer
 * applies. We surface the rename as the tool's primary side effect
 * but don't expose `isUntitled` on the tool surface (the store
 * owns that policy).
 */

const argsSchema = z
  .object({
    groupId: z.string().min(1),
    name: z.string().min(1),
  })
  .strict();

export const renameGroupTool: AssistantTool = {
  name: "rename_group",
  description:
    "Rename an asset-group. Empty names are rejected. Side effect: clears the auto-cleanup flag on first rename so the group isn't reaped when the linked iterator goes away.",
  parameters: {
    type: "object",
    properties: {
      groupId: { type: "string" },
      name: { type: "string" },
    },
    required: ["groupId", "name"],
    additionalProperties: false,
  },
  execute: async (rawArgs) => {
    const args = argsSchema.parse(rawArgs);
    const store = useAssetStore.getState();
    const group = store.assets.find((a) => a.id === args.groupId);
    if (!group) {
      return { ok: false, error: `No asset with id ${args.groupId}` };
    }
    if (group.kind !== "asset-group") {
      return {
        ok: false,
        error: `Asset ${args.groupId} is kind '${group.kind}', not 'asset-group'.`,
      };
    }
    if (args.name.trim().length === 0) {
      return { ok: false, error: "Group name cannot be empty / whitespace." };
    }
    store.renameGroup(args.groupId, args.name);
    return { ok: true };
  },
};
