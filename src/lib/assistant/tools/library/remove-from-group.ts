import { z } from "zod";

import { useAssetStore } from "@/lib/stores/asset-store";

import type { AssistantTool } from "../index";

/**
 * remove_from_group — Tier 1.2 (2026-06-03).
 *
 * Remove asset ids from an existing group. Unlike the inverse, this
 * NEVER deletes the underlying asset — the iterator + library
 * panel still see it. Ids that aren't in the group are silently
 * ignored (idempotent). The group survives empty.
 */

const argsSchema = z
  .object({
    groupId: z.string().min(1),
    assetIds: z.array(z.string()).min(1),
  })
  .strict();

export const removeFromGroupTool: AssistantTool = {
  name: "remove_from_group",
  description:
    "Remove asset ids from an asset-group. Asset records survive. Ids that weren't in the group are silently ignored. Returns the group's new size.",
  parameters: {
    type: "object",
    properties: {
      groupId: { type: "string" },
      assetIds: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
      },
    },
    required: ["groupId", "assetIds"],
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
    store.removeFromGroup(args.groupId, args.assetIds);
    // Re-read to compute the post-op size for the LLM.
    const after = useAssetStore
      .getState()
      .assets.find((a) => a.id === args.groupId);
    const size =
      after?.kind === "asset-group" ? after.assetIds.length : 0;
    return { ok: true, groupSize: size };
  },
};
