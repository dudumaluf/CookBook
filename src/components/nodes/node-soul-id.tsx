"use client";

import { Link as LinkIcon, Sparkle, Unlink, User } from "lucide-react";

import { defineNode } from "@/lib/engine/define-node";
import { useAssetStore } from "@/lib/stores/asset-store";
import type { NodeBodyProps, SoulIdRef } from "@/types/node";

/**
 * Soul ID — input node carrying a Higgsfield trained-character reference.
 *
 * `customReferenceId` + `variant` together are what HiggsfieldImageGen needs
 * to lock the rendered face to the user's likeness. Without a Soul ID wired
 * the image-gen node renders generically — see ADR-0029 for why we promote
 * this to a typed graph datatype instead of stuffing a UUID into a string.
 *
 * Slice 4.2: paste-by-UUID is the M0a stop-gap; the primary path is dragging
 * a SoulIdAsset from the Library (which the user populates via the
 * "Import Soul ID" popover that hits /api/higgsfield/soul-ids → list of
 * trained characters under their keypair). Training of new Soul IDs lands
 * in M0b per the ROADMAP.
 *
 * The node is `reactive: true` — output is a pure function of config so the
 * engine treats it as always-fresh, no Run click required for it to flow
 * downstream.
 */
export interface SoulIdNodeConfig {
  /** Foreign key to a `SoulIdAsset` in the library (the linked path). */
  assetId?: string;
  /**
   * Higgsfield's `custom_reference_id`. Mirrored into the config so the node
   * keeps working as a standalone if the linked asset is later removed from
   * the library — same pattern as the Image node's `url` denormalisation.
   */
  customReferenceId?: string;
  /** Soul model the character was trained on. Drives endpoint dispatch. */
  variant?: "v1" | "v2" | "cinema";
  /** Display name. Best-effort; falls back to the UUID prefix. */
  name?: string;
  /** Cover thumbnail URL from Higgsfield. Optional. */
  thumbnailUrl?: string | null;
}

const VARIANT_LABEL: Record<NonNullable<SoulIdNodeConfig["variant"]>, string> =
  {
    v2: "Soul 2",
    v1: "Soul 1",
    cinema: "Cinema",
  };

function SoulIdNodeBody({
  config,
  updateConfig,
}: NodeBodyProps<SoulIdNodeConfig>) {
  // Re-resolve from the asset-store when linked so library renames /
  // metadata edits propagate without a manual refresh — same pattern as
  // node-image.tsx.
  const linkedAsset = useAssetStore((s) =>
    config.assetId ? s.getAsset(config.assetId) : undefined,
  );
  const linkedSoulId =
    linkedAsset?.kind === "soul-id" ? linkedAsset : undefined;

  // Live values (linked-asset wins; falls back to denormalised config).
  const customReferenceId =
    linkedSoulId?.customReferenceId ?? config.customReferenceId;
  const variant = linkedSoulId?.variant ?? config.variant;
  const name = linkedSoulId?.name ?? config.name;
  const thumbnailUrl =
    linkedSoulId?.thumbnailUrl ?? config.thumbnailUrl ?? null;

  const hasCharacter = Boolean(customReferenceId && variant);

  return (
    <div className="flex w-full min-w-[240px] flex-col gap-1.5 px-3 pb-2.5 pt-0.5">
      {hasCharacter ? (
        <div className="flex items-center gap-2 rounded-md bg-foreground/[0.04] p-2">
          {thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={thumbnailUrl}
              alt={name ?? "Soul ID thumbnail"}
              className="h-10 w-10 shrink-0 rounded-md object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-foreground/10 text-muted-foreground">
              <User className="h-4 w-4" />
            </div>
          )}
          <div className="flex flex-1 flex-col gap-0.5 overflow-hidden">
            <span className="truncate text-xs font-medium text-foreground/90">
              {name ?? `Character ${customReferenceId!.slice(0, 8)}…`}
            </span>
            <span className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              <Sparkle className="h-2.5 w-2.5" />
              {variant ? VARIANT_LABEL[variant] : ""}
            </span>
          </div>
          {config.assetId ? (
            <button
              type="button"
              onClick={() => {
                // Preserve the snapshot so the unlinked node still works:
                // the engine's execute() reads from `config` directly when
                // not linked.
                updateConfig({
                  assetId: undefined,
                  customReferenceId,
                  variant,
                  name,
                  thumbnailUrl,
                });
              }}
              onPointerDown={(e) => e.stopPropagation()}
              aria-label="Unlink from library asset"
              className="text-muted-foreground hover:text-foreground"
            >
              <Unlink className="h-3 w-3" />
            </button>
          ) : null}
        </div>
      ) : (
        // Empty state — minimal copy that points at the Library popover.
        // Slice 4.2c lands the actual import flow.
        <div className="flex items-center gap-2 rounded-md border border-dashed border-border/40 bg-foreground/[0.02] px-2 py-2 text-[11px] text-muted-foreground">
          <LinkIcon className="h-3 w-3" />
          <span>Drag a Soul ID from the Library</span>
        </div>
      )}
    </div>
  );
}

export const soulIdNodeSchema = defineNode<SoulIdNodeConfig>({
  kind: "soul-id",
  category: "input",
  title: "Soul ID",
  description:
    "A trained Higgsfield character (your face). Wire it into HiggsfieldImageGen to lock generated images to your likeness.",
  icon: User,
  inputs: [],
  outputs: [{ id: "out", label: "out", dataType: "soul-id" }],
  defaultConfig: {},
  // Reactive: output is a pure function of config + (live) linked asset
  // state. No Run click needed — the engine treats it like Text / Image /
  // Number, an always-fresh source.
  reactive: true,
  execute: async ({ config }) => {
    // Linked-asset wins (so library updates propagate); fall back to the
    // denormalised snapshot.
    const linked = config.assetId
      ? useAssetStore.getState().getAsset(config.assetId)
      : undefined;
    const live =
      linked?.kind === "soul-id"
        ? {
            customReferenceId: linked.customReferenceId,
            variant: linked.variant,
            name: linked.name,
            thumbnailUrl: linked.thumbnailUrl ?? undefined,
          }
        : {
            customReferenceId: config.customReferenceId,
            variant: config.variant,
            name: config.name,
            thumbnailUrl: config.thumbnailUrl ?? undefined,
          };

    if (!live.customReferenceId || !live.variant) {
      throw new Error(
        "Soul ID node has no character — drag one from the Library or paste a customReferenceId.",
      );
    }

    const value: SoulIdRef = {
      customReferenceId: live.customReferenceId,
      variant: live.variant,
      name: live.name,
      thumbnailUrl: live.thumbnailUrl ?? undefined,
    };
    return { type: "soul-id", value };
  },
  Body: SoulIdNodeBody,
  // Width-only resize: body is a single horizontal row (thumb + text) so
  // vertical resize would just leave dead empty space. Same intuition as
  // the Image node's horizontal-only choice.
  size: {
    defaultWidth: 260,
    minWidth: 240,
    maxWidth: 420,
    resizable: "both",
  },
});
