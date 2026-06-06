"use client";

import { Film, Loader2, Unlink, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { defineNode } from "@/lib/engine/define-node";
import { importMediaFiles } from "@/lib/library/import-files";
import { useAssetStore } from "@/lib/stores/asset-store";
import type { NodeBodyProps } from "@/types/node";

/**
 * Video input node (Slice C). Upload a clip from disk, drag a library video
 * asset, or paste a URL. Outputs `{ type: "video" }`. Reactive (pure config).
 * Used as a driving-video / reference-video source for Seedance.
 */
export interface VideoNodeConfig {
  url: string;
  assetId?: string;
}

function VideoNodeBody({ config, updateConfig }: NodeBodyProps<VideoNodeConfig>) {
  const linkedAsset = useAssetStore((s) =>
    config.assetId ? s.getAsset(config.assetId) : undefined,
  );
  const linkedUrl =
    linkedAsset?.kind === "video" ? linkedAsset.source.url : undefined;
  const effectiveUrl = config.assetId ? linkedUrl : config.url;
  const hasVideo = Boolean(effectiveUrl);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDropTarget, setIsDropTarget] = useState(false);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setIsUploading(true);
    let result;
    try {
      result = await importMediaFiles(Array.from(files), "video");
    } finally {
      setIsUploading(false);
    }
    if (result.created > 0) {
      const firstId = result.ids[0]!;
      const first = useAssetStore.getState().getAsset(firstId);
      updateConfig({
        assetId: firstId,
        url: first?.kind === "video" ? first.source.url : config.url,
      });
      toast.success("Video uploaded and linked");
    }
    for (const err of result.errors) toast.error(err);
  }

  return (
    <div className="flex w-full min-w-[240px] flex-col gap-1.5 px-3 pb-2.5 pt-0.5">
      {hasVideo ? (
        <video
          src={effectiveUrl}
          controls
          loop
          playsInline
          onPointerDown={(e) => e.stopPropagation()}
          className="block w-full rounded-md bg-black"
          style={{ aspectRatio: "16 / 9" }}
        />
      ) : (
        <button
          type="button"
          disabled={isUploading}
          onClick={() => fileInputRef.current?.click()}
          onPointerDown={(e) => e.stopPropagation()}
          onDragOver={(e) => {
            if (
              isUploading ||
              !Array.from(e.dataTransfer.types).includes("Files")
            )
              return;
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
          className={`flex aspect-video w-full flex-col items-center justify-center gap-1.5 rounded-md border-2 border-dashed text-center transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
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
          <span className="px-3 text-[11px] leading-tight">
            {isUploading ? "Uploading…" : "Upload or drop a video"}
          </span>
        </button>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => {
          void handleFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {config.assetId ? (
        <div className="flex items-center gap-1.5 rounded-md bg-foreground/[0.04] px-2 py-1 text-xs">
          <Film className="h-3 w-3 shrink-0 text-accent" />
          <span className="flex-1 truncate text-foreground/80">
            {linkedAsset?.name ?? "Linked asset (missing)"}
          </span>
          <button
            type="button"
            onClick={() =>
              updateConfig({ assetId: undefined, url: linkedUrl ?? config.url })
            }
            onPointerDown={(e) => e.stopPropagation()}
            aria-label="Unlink from library asset"
            className="text-muted-foreground hover:text-foreground"
          >
            <Unlink className="h-3 w-3" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

export const videoNodeSchema = defineNode<VideoNodeConfig>({
  kind: "video",
  category: "input",
  title: "Video",
  description:
    "A single video — upload from disk, drag a Library asset, or paste a URL. Feeds Seedance as a reference / driving clip.",
  icon: Film,
  inputs: [],
  outputs: [{ id: "out", label: "out", dataType: "video" }],
  defaultConfig: { url: "" },
  reactive: true,
  execute: async ({ config }) => {
    const linked = config.assetId
      ? useAssetStore.getState().getAsset(config.assetId)
      : undefined;
    if (linked?.kind === "video") {
      return { type: "video", value: { url: linked.source.url } };
    }
    return { type: "video", value: { url: config.url } };
  },
  Body: VideoNodeBody,
  size: {
    defaultWidth: 280,
    minWidth: 220,
    maxWidth: 560,
    resizable: "both",
  },
});
