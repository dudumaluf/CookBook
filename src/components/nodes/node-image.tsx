"use client";

import { Image as ImageIcon, Link as LinkIcon, Unlink } from "lucide-react";

import { defineNode } from "@/lib/engine/define-node";
import { useAssetStore } from "@/lib/stores/asset-store";
import type { NodeBodyProps } from "@/types/node";

/**
 * Image node config.
 *
 * `url` is the source of truth at execute-time (so a node can survive its
 * asset being deleted). `assetId`, when set, marks the node as "linked" to
 * a library asset — the body shows the asset name and renders a small
 * Unlink button so the user can break the link and keep the URL standalone.
 */
export interface ImageNodeConfig {
  url: string;
  assetId?: string;
}

function ImageNodeBody({
  config,
  updateConfig,
}: NodeBodyProps<ImageNodeConfig>) {
  const hasImage = Boolean(config.url?.trim());
  // Subscribe to the linked asset (if any) so renames / url edits in the
  // library propagate to the node body without a manual refresh.
  const linkedAsset = useAssetStore((s) =>
    config.assetId ? s.getAsset(config.assetId) : undefined,
  );
  // Asset URL is canonical when linked; fall back to the free-typed url.
  const effectiveUrl =
    linkedAsset?.kind === "image" ? linkedAsset.url : config.url;

  return (
    <div className="flex w-full min-w-[200px] flex-col gap-1.5">
      {hasImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={effectiveUrl}
          alt="Image source"
          className="aspect-square w-full rounded-md border border-border/60 bg-background/40 object-cover"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
      ) : (
        <div className="flex aspect-square w-full items-center justify-center rounded-md border border-dashed border-border/60 bg-background/40 text-muted-foreground/50">
          <ImageIcon className="h-6 w-6" />
        </div>
      )}

      {config.assetId ? (
        // Linked to a library asset: show the link chip + unlink action
        // instead of a raw URL field (the URL would just mirror the asset).
        <div className="flex items-center gap-1.5 rounded-md border border-border/60 bg-background/60 px-2 py-1 text-xs">
          <LinkIcon className="h-3 w-3 shrink-0 text-accent" />
          <span className="flex-1 truncate text-foreground/80">
            {linkedAsset?.name ?? "Linked asset (missing)"}
          </span>
          <button
            type="button"
            onClick={() => updateConfig({ assetId: undefined })}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label="Unlink from library asset"
            className="text-muted-foreground hover:text-foreground"
          >
            <Unlink className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <input
          type="text"
          value={config.url}
          onChange={(e) => updateConfig({ url: e.target.value })}
          placeholder="https://… (or drag an asset from the Library)"
          aria-label="Image URL"
          className="w-full rounded-md border border-border/60 bg-background/60 px-2 py-1 text-xs text-foreground outline-none placeholder:text-muted-foreground/70 focus:border-accent/60"
          onPointerDown={(e) => e.stopPropagation()}
        />
      )}
    </div>
  );
}

export const imageNodeSchema = defineNode<ImageNodeConfig>({
  kind: "image",
  category: "input",
  title: "Image",
  description: "A single image — paste a URL or drag an asset from the Library.",
  icon: ImageIcon,
  inputs: [],
  outputs: [{ id: "out", label: "out", dataType: "image" }],
  defaultConfig: { url: "" },
  reactive: true,
  execute: async ({ config }) => {
    // If linked, the asset's URL is canonical; otherwise use the free URL.
    const linked = config.assetId
      ? useAssetStore.getState().getAsset(config.assetId)
      : undefined;
    const url =
      linked?.kind === "image" ? linked.url : config.url;
    return { type: "image", value: { url } };
  },
  Body: ImageNodeBody,
});
