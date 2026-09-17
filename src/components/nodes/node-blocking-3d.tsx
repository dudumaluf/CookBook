"use client";

import { Box, Loader2, Maximize2 } from "lucide-react";
import dynamic from "next/dynamic";
import { useId, useState } from "react";

import { defineNode } from "@/lib/engine/define-node";
import { extractInputArrayByType } from "@/lib/engine/extract-input";
import { runBlockingAgent } from "@/lib/blocking/agent";
import { ensureWiredMeshes } from "@/lib/blocking/ops";
import { uploadMediaAsset } from "@/lib/library/upload-asset";

const BlockingEditor = dynamic(
  () =>
    import("@/components/nodes/blocking/blocking-editor").then(
      (m) => m.BlockingEditor,
    ),
  { ssr: false },
);
const BlockingViewport = dynamic(
  () =>
    import("@/components/nodes/blocking/blocking-viewport").then(
      (m) => m.BlockingViewport,
    ),
  { ssr: false },
);
import { useExecutionStore } from "@/lib/stores/execution-store";
import {
  createDefaultDocument,
  sanitizeBlockingDocument,
  type BlockingDocument,
} from "@/types/blocking";
import type { NodeBodyProps, StandardizedOutput, VideoRef } from "@/types/node";

export interface Blocking3dNodeConfig {
  scene?: BlockingDocument;
  fps?: number;
  width?: number;
  height?: number;
}

function sceneOf(config: Blocking3dNodeConfig): BlockingDocument {
  const scene = sanitizeBlockingDocument(config.scene);
  return {
    ...scene,
    ...(config.fps ? { fps: config.fps } : {}),
    ...(config.width ? { width: config.width } : {}),
    ...(config.height ? { height: config.height } : {}),
  };
}

function Blocking3dBody({
  nodeId,
  config,
  updateConfig,
}: NodeBodyProps<Blocking3dNodeConfig>) {
  const record = useExecutionStore((s) => s.records.get(nodeId));
  const status = record?.status;
  const output = record?.output;
  const resultUrl =
    output && !Array.isArray(output) && output.type === "video"
      ? output.value.url
      : null;
  const scene = sceneOf(config);
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState("");

  const commitScene = (next: BlockingDocument) => {
    updateConfig({
      scene: next,
      fps: next.fps,
      width: next.width,
      height: next.height,
    });
  };

  return (
    <div className="flex w-full min-w-[280px] flex-col gap-2 px-3 pb-2.5 pt-0.5">
      <div className="flex items-center justify-between text-[10.5px] text-muted-foreground">
        <span>
          {scene.objects.length} objects · {(scene.durationMs / 1000).toFixed(1)}s ·{" "}
          {scene.fps} fps
        </span>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-foreground/[0.06] hover:text-foreground"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setOpen(true)}
        >
          <Maximize2 className="h-3 w-3" />
          Open editor
        </button>
      </div>

      <div
        className="relative overflow-hidden rounded-md"
        style={{ aspectRatio: `${scene.width} / ${scene.height}` }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <BlockingViewport
          doc={scene}
          playheadMs={0}
          selectedId={null}
          gizmoMode="translate"
          onSelect={() => undefined}
          onTransformEnd={() => undefined}
          shotView
        />
      </div>

      <div className="flex items-center gap-1">
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void (async () => {
                const text = prompt.trim();
                if (!text) return;
                setBusy(true);
                try {
                  const result = await runBlockingAgent(
                    scene,
                    text,
                    new AbortController().signal,
                  );
                  commitScene(result.doc);
                  setLog(result.text || "Updated.");
                } catch (err) {
                  setLog(err instanceof Error ? err.message : "Agent failed.");
                } finally {
                  setBusy(false);
                }
              })();
            }
          }}
          placeholder="Prompt the scene…"
          className="h-7 flex-1 rounded-md border border-border/60 bg-background/40 px-2 text-[11px]"
        />
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
      </div>
      {log ? <p className="text-[10px] text-muted-foreground">{log}</p> : null}

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
          <span>Playblasting…</span>
        </div>
      ) : resultUrl ? (
        <div
          className="relative overflow-hidden rounded-md bg-black"
          style={{ aspectRatio: `${scene.width} / ${scene.height}` }}
        >
          <video
            key={resultUrl}
            src={resultUrl}
            className="h-full w-full object-contain"
            controls
            loop
            playsInline
            preload="metadata"
            onPointerDown={(e) => e.stopPropagation()}
          />
        </div>
      ) : (
        <p className="text-[10px] leading-snug text-muted-foreground/80">
          Block in the editor (or prompt), then Run to bake a reference MP4.
        </p>
      )}

      {open ? (
        <BlockingEditor
          doc={scene}
          onChange={commitScene}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}

function Blocking3dSettings({
  config,
  updateConfig,
}: NodeBodyProps<Blocking3dNodeConfig>) {
  const fpsId = useId();
  const scene = sceneOf(config);
  return (
    <div className="flex flex-col gap-3 text-xs">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={fpsId} className="font-medium">
          FPS
        </label>
        <select
          id={fpsId}
          value={String(scene.fps)}
          onChange={(e) =>
            updateConfig({
              fps: Number(e.target.value),
              scene: { ...scene, fps: Number(e.target.value) },
            })
          }
          className="h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs"
        >
          <option value="24">24</option>
          <option value="30">30</option>
          <option value="60">60</option>
        </select>
      </div>
    </div>
  );
}

export const blocking3dNodeSchema = defineNode<Blocking3dNodeConfig>({
  kind: "blocking-3d",
  category: "transform",
  title: "3D Blocking",
  description:
    "Previz stage: primitives + imported meshes, PSR/camera keyframes, prompt-driven scene ops. Run playblasts an MP4 for Seedance / Omni reference. No lights, no rigs.",
  icon: Box,
  inputs: [{ id: "mesh", label: "mesh", dataType: "mesh", multiple: true }],
  outputs: [{ id: "out", label: "out", dataType: "video" }],
  defaultConfig: {
    scene: createDefaultDocument(),
    fps: 24,
    width: 1280,
    height: 720,
  },
  configParams: {
    fps: { control: "select", options: ["24", "30", "60"], label: "fps" },
  },
  reactive: false,
  execute: async ({ config, inputs, signal }) => {
    const meshes = extractInputArrayByType(inputs, "mesh", "mesh");
    let scene = sceneOf(config);
    scene = ensureWiredMeshes(
      scene,
      meshes.map((m, i) => ({ url: m.url, name: `Mesh ${i + 1}` })),
    );
    const { playblastScene } = await import("@/lib/blocking/playblast");
    const result = await playblastScene(scene, signal);
    const file = new File([result.blob], "playblast.mp4", { type: "video/mp4" });
    const uploaded = await uploadMediaAsset(file, "videos");
    const ref: VideoRef = {
      url: uploaded.url,
      mime: "video/mp4",
      durationMs: result.durationMs,
      width: result.width,
      height: result.height,
    };
    return {
      output: { type: "video", value: ref } satisfies StandardizedOutput,
      usage: { model: "mediabunny blocking-3d" },
    };
  },
  Body: Blocking3dBody,
  settings: {
    Content: Blocking3dSettings,
    hasOverrides: (config) =>
      (config.fps !== undefined && config.fps !== 24) ||
      (config.scene !== undefined && config.scene.objects.length > 1),
  },
  size: {
    defaultWidth: 360,
    minWidth: 280,
    maxWidth: 720,
    resizable: "both",
  },
});
