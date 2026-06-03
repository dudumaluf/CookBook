import { z } from "zod";

import { useAssetStore } from "@/lib/stores/asset-store";

import type { AssistantTool } from "../index";

/**
 * read_library — Slice 7.2 (ADR-0041).
 *
 * Returns the FULL asset library — every soul-id, image, video, audio,
 * group with id, name, kind, scope, tags. Use when the library summary
 * in the system prompt doesn't have enough detail (e.g. you need a
 * specific image's full url, or a group's complete `assetIds[]` list).
 *
 * Filters available:
 *   - kind: limit to one type (image / video / audio / soul-id /
 *     asset-group). 2026-06: `video` + `audio` added so the assistant
 *     can read media assets the M1 multimodal arc unlocked. Asset
 *     store has supported these kinds since Slice A but the tool
 *     enum was image / soul-id / asset-group only.
 *   - includeUrls: include full media URLs (default false to save tokens)
 */

const argsSchema = z
  .object({
    kind: z
      .enum(["image", "video", "audio", "soul-id", "asset-group"])
      .optional(),
    includeUrls: z.boolean().optional(),
  })
  .strict();

export const readLibraryTool: AssistantTool = {
  name: "read_library",
  description:
    "Read the full asset library. Returns every asset (image, video, audio, soul-id, group) with id, name, kind, scope. Optional `kind` filter narrows to one type. Optional `includeUrls` (default false) attaches full media URLs.",
  parameters: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: ["image", "video", "audio", "soul-id", "asset-group"],
        description: "Limit to one asset kind.",
      },
      includeUrls: {
        type: "boolean",
        description: "Include full media URLs in the result. Default false.",
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
        if (a.kind === "video" || a.kind === "audio") {
          const m = a as {
            source: { type: string; url?: string };
            durationMs?: number;
            width?: number;
            height?: number;
          };
          return {
            ...base,
            ...(m.durationMs !== undefined ? { durationMs: m.durationMs } : {}),
            ...(a.kind === "video" && m.width !== undefined
              ? { width: m.width }
              : {}),
            ...(a.kind === "video" && m.height !== undefined
              ? { height: m.height }
              : {}),
            ...(args.includeUrls ? { source: m.source } : {}),
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
