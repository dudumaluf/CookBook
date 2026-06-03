import { z } from "zod";

import { useAssetStore } from "@/lib/stores/asset-store";

import type { AssistantTool } from "../index";

/**
 * create_image_asset_from_url — Tier 1.2 (2026-06-03).
 *
 * Library mutation #1. Mirrors the "Paste URL" affordance the user
 * has in the Library panel; the assistant can now do "I added that
 * Pinterest image to your library as `Cool moodboard`" without the
 * user having to drag.
 *
 * `scope` defaults to `"project"` (current-project bucket); pass
 * `"global"` for cross-project assets. The store records the URL
 * verbatim — bytes don't get copied to our bucket. If the URL goes
 * 404 later, the asset's preview degrades but no error throws.
 */

const argsSchema = z
  .object({
    url: z.string().url(),
    name: z.string().optional(),
    tags: z.array(z.string()).optional(),
    scope: z.enum(["project", "global"]).optional(),
  })
  .strict();

export const createImageAssetFromUrlTool: AssistantTool = {
  name: "create_image_asset_from_url",
  description:
    "Add an image asset to the library by URL (no upload — we record the URL verbatim). Returns the new assetId. Use after the user pastes / mentions a remote image they want in the library.",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "Public URL of the image. Must be reachable.",
      },
      name: {
        type: "string",
        description:
          "Display name in the library. Defaults to the URL's last segment.",
      },
      tags: {
        type: "array",
        items: { type: "string" },
        description: "Optional tag list for searchability.",
      },
      scope: {
        type: "string",
        enum: ["project", "global"],
        description:
          "Asset scope. 'project' (default) = current project only. 'global' = visible across all projects.",
      },
    },
    required: ["url"],
    additionalProperties: false,
  },
  execute: async (rawArgs) => {
    const args = argsSchema.parse(rawArgs);
    const id = useAssetStore.getState().createImageAssetFromUrl({
      url: args.url,
      name: args.name,
      tags: args.tags,
      scope: args.scope ?? "project",
    });
    return { ok: true, assetId: id };
  },
};
