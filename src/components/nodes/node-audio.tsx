"use client";

import { Loader2, Music, Unlink, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { defineNode } from "@/lib/engine/define-node";
import { importMediaFiles } from "@/lib/library/import-files";
import { useAssetStore } from "@/lib/stores/asset-store";
import type { NodeBodyProps } from "@/types/node";

/**
 * Audio input node (Slice C). Upload a song / narration from disk, drag a
 * library audio asset, or paste a URL. Outputs `{ type: "audio" }`. Reactive.
 * The performance pipeline feeds this into Audio Slice + Seedance for
 * lip-sync.
 */
export interface AudioNodeConfig {
  url: string;
  assetId?: string;
}

function AudioNodeBody({ config, updateConfig }: NodeBodyProps<AudioNodeConfig>) {
  const linkedAsset = useAssetStore((s) =>
    config.assetId ? s.getAsset(config.assetId) : undefined,
  );
  const linkedUrl =
    linkedAsset?.kind === "audio" ? linkedAsset.source.url : undefined;
  const effectiveUrl = config.assetId ? linkedUrl : config.url;
  const hasAudio = Boolean(effectiveUrl);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDropTarget, setIsDropTarget] = useState(false);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setIsUploading(true);
    let result;
    try {
      result = await importMediaFiles(Array.from(files), "audio");
    } finally {
      setIsUploading(false);
    }
    if (result.created > 0) {
      const firstId = result.ids[0]!;
      const first = useAssetStore.getState().getAsset(firstId);
      updateConfig({
        assetId: firstId,
        url: first?.kind === "audio" ? first.source.url : config.url,
      });
      toast.success("Audio uploaded and linked");
    }
    for (const err of result.errors) toast.error(err);
  }

  return (
    <div className="flex w-full min-w-[240px] flex-col gap-1.5 px-3 pb-2.5 pt-0.5">
      {hasAudio ? (
        <div className="flex items-center gap-2 rounded-md bg-foreground/[0.04] p-2">
          <Music className="h-4 w-4 shrink-0 text-accent" />
          <audio
            src={effectiveUrl}
            controls
            preload="metadata"
            onPointerDown={(e) => e.stopPropagation()}
            className="w-full"
          />
        </div>
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
          className={`flex h-20 w-full flex-col items-center justify-center gap-1.5 rounded-md border-2 border-dashed text-center transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
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
            {isUploading ? "Uploading…" : "Upload or drop audio"}
          </span>
        </button>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
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
          <Music className="h-3 w-3 shrink-0 text-accent" />
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

export const audioNodeSchema = defineNode<AudioNodeConfig>({
  kind: "audio",
  category: "input",
  title: "Audio",
  description:
    "A single audio file — upload a song / narration, drag a Library asset, or paste a URL. Feeds Audio Slice + Seedance lip-sync.",
  icon: Music,
  inputs: [],
  outputs: [{ id: "out", label: "out", dataType: "audio" }],
  defaultConfig: { url: "" },
  reactive: true,
  execute: async ({ config }) => {
    const linked = config.assetId
      ? useAssetStore.getState().getAsset(config.assetId)
      : undefined;
    if (linked?.kind === "audio") {
      return { type: "audio", value: { url: linked.source.url } };
    }
    return { type: "audio", value: { url: config.url } };
  },
  Body: AudioNodeBody,
  size: {
    defaultWidth: 260,
    minWidth: 220,
    maxWidth: 480,
    resizable: "both",
  },
});
