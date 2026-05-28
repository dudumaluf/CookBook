import { z } from "zod";

import { useAssetStore } from "@/lib/stores/asset-store";

import type { AssistantTool } from "../index";

/**
 * read_library — Slice 7.2 (ADR-0041).
 *
 * Returns the FULL asset library — every soul-id, image, group with
 * id, name, kind, scope, tags. Use when the library summary in the
 * system prompt doesn't have enough detail (e.g. you need a specific
 * image's full url, or a group's complete `assetIds[]` list).
 *
 * Filters available:
 *   - kind: limit to one type (image / soul-id / asset-group)
 *   - includeUrls: include full image URLs (default false to save tokens)
 */

const argsSchema = z
  .object({
    kind: z
      .enum(["image", "soul-id", "asset-group"])
      .optional(),
    includeUrls: z.boolean().optional(),
  })
  .strict();

export const readLibraryTool: AssistantTool = {
  name: "read_library",
  description:
    "Read the full asset library. Returns every asset (image, soul-id, group) with id, name, kind, scope. Optional `kind` filter narrows to one type. Optional `includeUrls` (default false) attaches full image URLs.",
  parameters: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: ["image", "soul-id", "asset-group"],
        description: "Limit to one asset kind.",
      },
      includeUrls: {
        type: "boolean",
        description: "Include full image URLs in the result. Default false.",
      },
    },
    additionalProperties: false,
  },
  execute: async (rawArgs) => {
    const args = argsSchema.parse(rawArgs ?? {});
    const all = useAssetStore.getState().assets;
    const filtered = args.kind
      ? all.filter((a) => a.kind === args.kind)
      : all;
    return {
      assets: filtered.map((a) => {
        const base = {
          id: a.id,
          kind: a.kind,
          name: a.name,
          scope: a.scope,
          tags: a.tags,
        };
        if (a.kind === "image" && args.includeUrls) {
          return {
            ...base,
            source: (a as { source: { type: string; url: string } }).source,
          };
        }
        if (a.kind === "soul-id") {
          const sid = a as unknown as {
            customReferenceId: string;
            variant: string;
            thumbnailUrl?: string;
          };
          return {
            ...base,
            customReferenceId: sid.customReferenceId,
            variant: sid.variant,
            ...(args.includeUrls && sid.thumbnailUrl
              ? { thumbnailUrl: sid.thumbnailUrl }
              : {}),
          };
        }
        if (a.kind === "asset-group") {
          const g = a as { assetIds: string[] };
          return { ...base, assetIds: g.assetIds };
        }
        return base;
      }),
    };
  },
};
