import { z } from "zod";

import { useAssetStore } from "@/lib/stores/asset-store";

import type { AssistantTool } from "../index";

/**
 * add_to_group — Tier 1.2 (2026-06-03).
 *
 * Append asset ids to an existing group. The store de-dupes against
 * the existing membership and skips writes when nothing changed
 * (avoids render churn). Membership ids are NOT validated against
 * the asset list — defensive consumers (the iterator at runtime)
 * drop unresolvable ids. We surface the missing-asset case as a
 * warning in the response so the LLM can fix it on a later turn.
 */

const argsSchema = z
  .object({
    groupId: z.string().min(1),
    assetIds: z.array(z.string()).min(1),
  })
  .strict();

export const addToGroupTool: AssistantTool = {
  name: "add_to_group",
  description:
    "Append image asset ids to an existing asset-group. De-duped against current membership. Returns { added, skippedExisting, unknownIds[] } so the assistant can see what actually landed.",
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
    const existingMembership = new Set(group.assetIds);
    const known = new Set(store.assets.map((a) => a.id));
    const unknownIds: string[] = [];
    const skippedExisting: string[] = [];
    const toAdd: string[] = [];
    for (const id of args.assetIds) {
      if (!known.has(id)) {
        unknownIds.push(id);
        continue;
      }
      if (existingMembership.has(id)) {
        skippedExisting.push(id);
        continue;
      }
      toAdd.push(id);
    }
    // Only push known + new ids into the store. The store's own
    // dedup handles concurrent writes; we filter unknowns here so a
    // typo from the LLM doesn't end up as a phantom membership entry.
    if (toAdd.length > 0) {
      store.addToGroup(args.groupId, toAdd);
    }
    return {
      ok: true,
      added: toAdd.length,
      skippedExisting,
      unknownIds,
    };
  },
};
