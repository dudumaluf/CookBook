"use client";

import { useRef, useState } from "react";
import {
  ChevronDown,
  Image as ImageIcon,
  Link as LinkIcon,
  Loader2,
  Unlink,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { defineNode } from "@/lib/engine/define-node";
import { importImageFiles } from "@/lib/library/import-files";
import { useAssetStore } from "@/lib/stores/asset-store";
import { aspectFromImageDimensions } from "@/lib/utils/aspect-ratio";
import type { NodeBodyProps } from "@/types/node";

/**
 * Image node config.
 *
 * - `assetId` (optional): foreign key to a Library asset. When set, the
 *   node is "linked" — preview + execute() resolve through the asset
 *   store so library renames / re-uploads propagate.
 * - `url` (optional, free-URL escape hatch): used when no asset is linked
 *   (the user pasted a URL or unlinked from a URL-source asset).
 *
 * Cloud-canonical storage (ADR-0018b) means `source.url` is always a real
 * fetchable URL — no `blob:` indirection — so this config doesn't need to
 * distinguish between linked-remote and linked-url cases.
 */
export interface ImageNodeConfig {
  url: string;
  assetId?: string;
}

function ImageNodeBody({
  config,
  updateConfig,
}: NodeBodyProps<ImageNodeConfig>) {
  // Subscribe to the linked asset (if any) so renames / re-uploads in the
  // library propagate to the node body without a manual refresh.
  const linkedAsset = useAssetStore((s) =>
    config.assetId ? s.getAsset(config.assetId) : undefined,
  );
  const linkedUrl =
    linkedAsset?.kind === "image" ? linkedAsset.source.url : undefined;
  // The free `config.url` is the fallback for unlinked nodes (paste flow).
  const effectiveUrl = config.assetId ? linkedUrl : config.url;
  const hasImage = Boolean(effectiveUrl);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDropTarget, setIsDropTarget] = useState(false);
  const [urlDisclosed, setUrlDisclosed] = useState(false);

  // Slice 5.6.2 — render the preview at the image's true aspect ratio
  // instead of forcing a square crop. Three signal sources, fastest-first:
  //   1. linked asset's stored width / height (set on upload, no flicker).
  //   2. fallback: <img onLoad> measures naturalDimensions and sets state.
  //   3. ultimate fallback: 1:1 (matches the old square behavior).
  const [imgNaturalDimensions, setImgNaturalDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const linkedDims =
    linkedAsset?.kind === "image" &&
    linkedAsset.width !== undefined &&
    linkedAsset.height !== undefined
      ? { width: linkedAsset.width, height: linkedAsset.height }
      : null;
  const previewDims = linkedDims ?? imgNaturalDimensions;
  const previewCssAspect = previewDims
    ? aspectFromImageDimensions(previewDims.width, previewDims.height)
    : "1 / 1";

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setIsUploading(true);
    let result;
    try {
      result = await importImageFiles(Array.from(files));
    } finally {
      setIsUploading(false);
    }
    // First successfully-imported asset becomes the linked asset of this
    // node. Extras stay in the Library (same pipeline as a Library upload),
    // surfaced through the same batched toast so the user knows where the
    // rest of their selection went.
    if (result.created > 0) {
      const firstId = result.ids[0]!;
      const first = useAssetStore.getState().getAsset(firstId);
      updateConfig({
        assetId: firstId,
        url:
          first?.kind === "image"
            ? first.source.url
            : config.url,
      });
      if (result.created === 1) {
        toast.success("Image uploaded and linked");
      } else {
        toast.success(
          `${result.created} images uploaded — first linked, rest in Library`,
        );
      }
    }
    for (const err of result.errors) toast.error(err);
  }

  return (
    // Outer wrapper owns the flush body padding (ADR-0021). Internal stack
    // gap is small to match the tightened chrome.
    <div className="flex w-full min-w-[240px] flex-col gap-1.5 px-3 pb-2.5 pt-0.5">
      {hasImage ? (
        <div
          className="relative"
          data-testid="image-preview"
          style={{ aspectRatio: previewCssAspect }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={effectiveUrl}
            alt="Image source"
            className="h-full w-full rounded-md bg-foreground/5 object-cover"
            onLoad={(e) => {
              // Measure-on-load for legacy assets that have no stored
              // width / height. Skip when we already have linked dims to
              // avoid stomping over a known-good signal.
              if (linkedDims) return;
              const img = e.currentTarget;
              if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                setImgNaturalDimensions({
                  width: img.naturalWidth,
                  height: img.naturalHeight,
                });
              }
            }}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
          {!config.assetId && config.url ? (
            // Free-URL preview gets a corner ✕ so the user can clear back to
            // the upload-zone empty state without hunting for an input.
            // Linked nodes use Unlink below instead — different semantics.
            <button
              type="button"
              onClick={() => updateConfig({ url: "" })}
              onPointerDown={(e) => e.stopPropagation()}
              aria-label="Clear image"
              className="absolute right-1.5 top-1.5 rounded-full bg-background/80 p-1 text-muted-foreground opacity-0 backdrop-blur transition-opacity hover:text-foreground group-hover:opacity-100 [div:hover>&]:opacity-100"
            >
              <X className="h-3 w-3" />
            </button>
          ) : null}
        </div>
      ) : (
        // Empty state = interactive upload zone. Click → OS picker; drop
        // OS image files → uploaded straight through the same pipeline as
        // the Library; the first one auto-links this node.
        <button
          type="button"
          disabled={isUploading}
          onClick={() => fileInputRef.current?.click()}
          onPointerDown={(e) => e.stopPropagation()}
          onDragOver={(e) => {
            if (
              isUploading ||
              !Array.from(e.dataTransfer.types).includes("Files")
            ) {
              return;
            }
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            setIsDropTarget(true);
          }}
          onDragLeave={() => setIsDropTarget(false)}
          onDrop={(e) => {
            if (isUploading) return;
            e.preventDefault();
            setIsDropTarget(false);
            void handleFiles(e.dataTransfer.files);
          }}
          className={`flex aspect-square w-full flex-col items-center justify-center gap-1.5 rounded-md border-2 border-dashed text-center transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
            isDropTarget
              ? "border-accent/70 bg-accent/10 text-foreground"
              : "border-border/40 bg-foreground/[0.02] text-muted-foreground hover:border-border/70 hover:bg-foreground/5"
          }`}
        >
          {isUploading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Upload className="h-5 w-5" />
          )}
          <div className="flex flex-col gap-0.5 px-3">
            <span className="text-[11px] leading-tight">
              {isUploading ? "Uploading…" : "Upload or drop image"}
            </span>
            <span className="text-[10px] leading-tight text-muted-foreground/70">
              or drag from Library
            </span>
          </div>
        </button>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => {
          void handleFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {config.assetId ? (
        // Linked to a library asset: show the link chip + unlink action.
        // Restyled flush-and-borderless to match the new chrome (ADR-0021).
        <div className="flex items-center gap-1.5 rounded-md bg-foreground/[0.04] px-2 py-1 text-xs">
          <LinkIcon className="h-3 w-3 shrink-0 text-accent" />
          <span className="flex-1 truncate text-foreground/80">
            {linkedAsset?.name ?? "Linked asset (missing)"}
          </span>
          <button
            type="button"
            onClick={() => {
              // Preserve the linked asset's url as the standalone fallback —
              // it's a real fetchable URL whether the source was `remote` or
              // a free `url`, so the unlinked node keeps working.
              updateConfig({
                assetId: undefined,
                url: linkedUrl ?? config.url,
              });
            }}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label="Unlink from library asset"
            className="text-muted-foreground hover:text-foreground"
          >
            <Unlink className="h-3 w-3" />
          </button>
        </div>
      ) : hasImage ? null : (
        // Empty + unlinked: tiny "Paste URL" disclosure for the rare case
        // the user already has a URL in hand. Lives below the upload zone
        // so it doesn't compete for primary attention.
        <>
          <button
            type="button"
            onClick={() => setUrlDisclosed((v) => !v)}
            onPointerDown={(e) => e.stopPropagation()}
            aria-expanded={urlDisclosed}
            aria-label="Toggle URL input"
            className="flex items-center gap-1 self-start text-[10.5px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <LinkIcon className="h-3 w-3" />
            <span>Or paste a URL</span>
            <ChevronDown
              className={`h-3 w-3 transition-transform ${urlDisclosed ? "rotate-180" : ""}`}
            />
          </button>
          {urlDisclosed ? (
            <input
              type="url"
              value={config.url}
              onChange={(e) => updateConfig({ url: e.target.value })}
              placeholder="https://…"
              aria-label="Image URL"
              className="w-full rounded-md bg-foreground/[0.04] px-2 py-1 text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus:bg-foreground/[0.06]"
              onPointerDown={(e) => e.stopPropagation()}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

export const imageNodeSchema = defineNode<ImageNodeConfig>({
  kind: "image",
  category: "input",
  title: "Image",
  description:
    "A single image — upload from disk, drag a Library asset, or paste a URL.",
  icon: ImageIcon,
  inputs: [],
  outputs: [{ id: "out", label: "out", dataType: "image" }],
  defaultConfig: { url: "" },
  reactive: true,
  execute: async ({ config }) => {
    // While linked, the asset's url is canonical (library re-upload should
    // propagate downstream automatically). When unlinked or asset missing,
    // fall back to the captured `config.url`.
    const linked = config.assetId
      ? useAssetStore.getState().getAsset(config.assetId)
      : undefined;
    if (linked?.kind === "image") {
      return { type: "image", value: { url: linked.source.url } };
    }
    return { type: "image", value: { url: config.url } };
  },
  Body: ImageNodeBody,
  // Size contract (ADR-0028). Width-only resize: the preview's aspect
  // ratio is derived from the linked asset (or the loaded image) — height
  // naturally follows width, so a "both" handle would be redundant and a
  // vertical-only handle would be confusing (the image wouldn't actually
  // stretch). Horizontal range tuned so a preview stays useful (≥ 200 px)
  // but doesn't dominate the canvas (≤ 480 px).
  size: {
    defaultWidth: 240,
    minWidth: 200,
    maxWidth: 480,
    resizable: "horizontal",
  },
});
