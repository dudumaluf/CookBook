import { z } from "zod";

import { useAssetStore } from "@/lib/stores/asset-store";

import type { AssistantTool } from "../index";

/**
 * remove_asset — Tier 1.2 (2026-06-03).
 *
 * Drop an asset from the library by id. Routes through the store's
 * `removeAsset` (image / soul-id) or `removeGroup` (asset-group)
 * depending on the kind, so the right cleanup path runs (remote
 * bucket delete for `remote`-source images, group-only drop for
 * groups — group members survive).
 *
 * Idempotent: a missing id resolves to `{ ok: true, removed: false }`.
 * The LLM gets a clear signal whether the call did anything without
 * having to retry-on-error.
 */

const argsSchema = z.object({ assetId: z.string().min(1) }).strict();

export const removeAssetTool: AssistantTool = {
  name: "remove_asset",
  description:
    "Delete an asset (image, soul-id, or asset-group) from the library by id. Idempotent — returns { ok: true, removed: false } if the id isn't there. Group ids drop the group only (member assets survive).",
  parameters: {
    type: "object",
    properties: {
      assetId: { type: "string" },
    },
    required: ["assetId"],
    additionalProperties: false,
  },
  execute: async (rawArgs) => {
    const args = argsSchema.parse(rawArgs);
    const store = useAssetStore.getState();
    const asset = store.assets.find((a) => a.id === args.assetId);
    if (!asset) return { ok: true, removed: false };
    if (asset.kind === "asset-group") {
      store.removeGroup(asset.id);
    } else {
      await store.removeAsset(asset.id);
    }
    return { ok: true, removed: true };
  },
};
