"use client";

import { Download, Image as ImageIcon, Loader2, ScissorsLineDashed } from "lucide-react";
import { useId } from "react";

import { defineNode } from "@/lib/engine/define-node";
import { extractInputByType } from "@/lib/engine/extract-input";
import { downloadFromUrl, safeFilename } from "@/lib/library/download";
import { uploadImageAsset } from "@/lib/library/upload-asset";
import { extractFrame, type FramePosition } from "@/lib/media";
import { useExecutionStore } from "@/lib/stores/execution-store";
import type { ImageRef, NodeBodyProps, StandardizedOutput } from "@/types/node";

import { PreviewImage } from "./preview-image";

/**
 * Frame Extract — pull a specific frame of a video as an image.
 *
 * Mode: first / last / at a specific time (seconds). The modular counterpart
 * of the Continuity Builder's inline frame-chaining: extract a chunk's last
 * frame → feed it as the next chunk's start frame (Seedance image-to-video)
 * or reference. Browser-side (mediabunny WebCodecs); non-reactive because
 * decoding a frame is heavy enough to run on demand.
 *
 * Input:  video (single)
 * Output: image (single)
 */

export type FramePositionMode = "first" | "last" | "at";

export interface FrameExtractNodeConfig {
  position?: FramePositionMode;
  /** Timestamp (seconds) used when position === "at". */
  atSec?: number;
}

const DEFAULT_POSITION: FramePositionMode = "last";
const DEFAULT_AT_SEC = 0;

function positionLabel(config: FrameExtractNodeConfig): string {
  const pos = config.position ?? DEFAULT_POSITION;
  if (pos === "at") return `@ ${config.atSec ?? DEFAULT_AT_SEC}s`;
  return `${pos} frame`;
}

function FrameExtractBody({ nodeId, config }: NodeBodyProps<FrameExtractNodeConfig>) {
  const record = useExecutionStore((s) => s.records.get(nodeId));
  const status = record?.status;
  const output = record?.output;
  const url =
    output && !Array.isArray(output) && output.type === "image"
      ? output.value.url
      : null;

  return (
    <div className="flex w-full min-w-[220px] flex-col gap-2 px-3 pb-2.5 pt-0.5">
      <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
        <span>{positionLabel(config)}</span>
      </div>
      {status === "error" && record?.error ? (
        <p
          role="alert"
          className="rounded-md bg-destructive/10 px-2 py-1.5 text-[11px] leading-snug text-destructive"
        >
          {record.error}
        </p>
      ) : status === "running" ? (
        <div className="flex items-center gap-2 rounded-md bg-foreground/[0.04] px-2 py-2 text-[11px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Extracting frame…</span>
        </div>
      ) : url ? (
        <div className="flex flex-col gap-1.5">
          <PreviewImage
            url={url}
            alt="Extracted frame"
            downloadName={`frame-${positionLabel(config)}`}
            className="bg-black"
          />
          <button
            type="button"
            onClick={() =>
              void downloadFromUrl(
                url,
                safeFilename(`frame-${positionLabel(config)}`, "frame") + ".png",
              )
            }
            onPointerDown={(e) => e.stopPropagation()}
            className="flex items-center gap-1 self-end rounded-md border border-border/60 bg-background/40 px-1.5 py-0.5 text-[10.5px] text-foreground/80 hover:bg-foreground/10"
          >
            <Download className="h-3 w-3" /> Download
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-md border border-dashed border-border/40 bg-foreground/[0.02] px-2 py-2 text-[11px] text-muted-foreground">
          <ImageIcon className="h-3 w-3" />
          <span>Wire a video, then Run</span>
        </div>
      )}
    </div>
  );
}

function FrameExtractSettings({
  config,
  updateConfig,
}: NodeBodyProps<FrameExtractNodeConfig>) {
  const positionId = useId();
  const atId = useId();
  const position = config.position ?? DEFAULT_POSITION;
  return (
    <div className="flex flex-col gap-3 text-xs">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={positionId} className="font-medium text-foreground/90">
          Frame
        </label>
        <select
          id={positionId}
          value={position}
          onChange={(e) =>
            updateConfig({ position: e.target.value as FramePositionMode })
          }
          className="h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs"
        >
          <option value="last">Last frame (continue from)</option>
          <option value="first">First frame</option>
          <option value="at">At a specific time…</option>
        </select>
      </div>

      {position === "at" ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={atId} className="font-medium text-foreground/90">
            Time (seconds)
          </label>
          <input
            id={atId}
            type="number"
            min={0}
            step={0.1}
            value={config.atSec ?? DEFAULT_AT_SEC}
            onChange={(e) =>
              updateConfig({ atSec: Math.max(0, Number(e.target.value)) })
            }
            className="h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs"
          />
        </div>
      ) : null}
    </div>
  );
}

export const frameExtractNodeSchema = defineNode<FrameExtractNodeConfig>({
  kind: "frame-extract",
  category: "transform",
  title: "Frame Extract",
  description:
    "Pull a frame of a video as an image — first, last, or at a specific time (seconds). Client-side (mediabunny). The modular building block for frame-chaining continuity.",
  icon: ScissorsLineDashed,
  inputs: [{ id: "video", label: "video", dataType: "video" }],
  outputs: [{ id: "out", label: "out", dataType: "image" }],
  configParams: {
    position: { control: "select", options: ["first", "last", "at"], label: "frame" },
    atSec: { control: "number", label: "time (s)" },
  },
  defaultConfig: { position: DEFAULT_POSITION },
  reactive: false,
  execute: async ({ config, inputs }) => {
    const video = extractInputByType(inputs, "video", "video");
    if (!video?.url) {
      throw new Error("Wire a video into the `video` handle.");
    }
    const mode = config.position ?? DEFAULT_POSITION;
    const position: FramePosition =
      mode === "at"
        ? { atMs: Math.max(0, config.atSec ?? DEFAULT_AT_SEC) * 1000 }
        : mode;
    const blob = await extractFrame(video.url, position);
    const name =
      mode === "at" ? `frame-at-${config.atSec ?? DEFAULT_AT_SEC}s.png` : `frame-${mode}.png`;
    const file = new File([blob], name, { type: "image/png" });
    const uploaded = await uploadImageAsset(file);
    const ref: ImageRef = { url: uploaded.url, mime: "image/png" };
    return {
      output: { type: "image", value: ref } satisfies StandardizedOutput,
      usage: { model: "mediabunny extract-frame" },
    };
  },
  Body: FrameExtractBody,
  settings: { Content: FrameExtractSettings },
  size: {
    defaultWidth: 240,
    minWidth: 220,
    maxWidth: 480,
    resizable: "both",
  },
});
