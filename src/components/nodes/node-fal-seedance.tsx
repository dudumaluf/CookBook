"use client";

import { Clapperboard, Film, Loader2 } from "lucide-react";
import { useEffect, useId } from "react";

import { defineNode } from "@/lib/engine/define-node";
import { extractInputArrayByType, extractInputByType } from "@/lib/engine/extract-input";
import { callSeedanceVideo } from "@/lib/fal/call-seedance";
import {
  SEEDANCE_ASPECT_RATIOS,
  SEEDANCE_RESOLUTIONS,
  type SeedanceVideoRequest,
  isRandomSeed,
  RANDOM_SEED,
  resolveSeed,
} from "@/lib/fal/types";
import { validateSeedanceRequest } from "@/lib/media/constraints";
import { useExecutionStore } from "@/lib/stores/execution-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import { parseAspectRatio } from "@/lib/utils/aspect-ratio";
import type { NodeBodyProps, NodeIO, StandardizedOutput, VideoRef } from "@/types/node";

import { IteratorCursor } from "./iterator-cursor";
import {
  MediaPreviewPlaceholder,
  MediaPreviewVideo,
} from "./media-preview";
import { useNodeHistoryCursor } from "./use-node-history-cursor";

/**
 * Seedance Video — the executable video-generation node (Slice B).
 *
 * Wraps Fal's `bytedance/seedance-2.0/*`. One node covers all three Fal
 * endpoints; the server wrapper dispatches by which references are wired:
 *   - any image/video reference -> reference-to-video (up to 9 img + 3 vid
 *     + 3 audio; native lip-sync + person-swap + continuity via extension)
 *   - none                      -> text-to-video
 *
 * Inputs:
 *   - prompt (text)        — scene / continuation description
 *   - image  (image, ×N)   — reference images (@Image1..) — identity, frames
 *   - video  (video, ×N)   — reference videos (@Video1..) — motion/continuity
 *   - audio  (audio, ×N)   — reference audio (@Audio1..) — lip-sync to a song
 *
 * Output:
 *   - out (video)          — the generated clip
 *
 * Settings (BaseNode `⋯`): duration, aspect ratio, resolution, native audio
 * toggle, seed, fast tier.
 *
 * Non-reactive (costs money). Runs on Run / Run-here only.
 */

export type SeedanceDuration = number | "auto";

/**
 * How the node uses its wired media (ADR-0054):
 *   - "reference"   — references (images/videos/audio) -> reference/text-to-video
 *   - "first-frame" — first wired image is the literal START frame -> image-to-video
 *   - "first-last"  — first wired image = start, second = end -> image-to-video
 * image-to-video is a DISTINCT Fal model: literal frame control, no video/
 * audio refs, caps at 720p.
 */
export type SeedanceMode = "reference" | "first-frame" | "first-last";

export interface SeedanceVideoNodeConfig {
  mode?: SeedanceMode;
  duration?: SeedanceDuration;
  aspectRatio?: (typeof SEEDANCE_ASPECT_RATIOS)[number];
  resolution?: (typeof SEEDANCE_RESOLUTIONS)[number];
  generateAudio?: boolean;
  seed?: number;
  fast?: boolean;
  /** Reference mode: how many image/video/audio sockets to show. Auto-grow. */
  imagePorts?: number;
  videoPorts?: number;
  audioPorts?: number;
  /**
   * Reference mode: friendly name inherited from the node wired into each
   * slot (slot id → name), so the prompt can say `@img_performance` instead
   * of `@Image1`. Synced from the graph; the socket shows it and `execute`
   * rewrites the prompt name → the Fal positional token.
   */
  refNames?: Record<string, string>;
}

/** Sanitize a node label into a prompt-safe `@token` name (no spaces/punct). */
function sanitizeRefName(name: string): string {
  return name
    .trim()
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const DEFAULT_ASPECT = "auto" as const;
const DEFAULT_RESOLUTION = "720p" as const;
const DEFAULT_MODE: SeedanceMode = "reference";

/** Fal reference-to-video per-type caps (mirrors seedanceVideoRequestSchema). */
const REF_CAPS = { image: 9, video: 3, audio: 3 } as const;
type RefBase = keyof typeof REF_CAPS;
const REF_DATATYPE: Record<RefBase, "image" | "video" | "audio"> = {
  image: "image",
  video: "video",
  audio: "audio",
};

function refPortCount(config: SeedanceVideoNodeConfig, base: RefBase): number {
  const raw =
    base === "image"
      ? config.imagePorts
      : base === "video"
        ? config.videoPorts
        : config.audioPorts;
  return Math.min(REF_CAPS[base], Math.max(1, raw ?? 1));
}

/**
 * The exact token Fal parses in the prompt for a given socket: `image-0` ->
 * `@Image1`, `video-1` -> `@Video2`, etc. (1-indexed, capitalized). The socket
 * order we send to Fal IS this numbering, so the token on a socket is stable.
 */
function refToken(base: RefBase, index: number): string {
  const Cap = base.charAt(0).toUpperCase() + base.slice(1);
  return `@${Cap}${index + 1}`;
}

/** Indexed reference sockets for reference mode: prompt + image/video/audio-N. */
function referenceInputs(config: SeedanceVideoNodeConfig): NodeIO[] {
  const out: NodeIO[] = [{ id: "prompt", label: "prompt", dataType: "text" }];
  for (const base of ["image", "video", "audio"] as const) {
    const n = refPortCount(config, base);
    for (let i = 0; i < n; i++) {
      const id = `${base}-${i}`;
      // Label = the connected node's name (`@img_performance`) when wired +
      // renamed, else the positional Fal token (`@Image1`). The label is what
      // you type in the prompt.
      const name = config.refNames?.[id];
      out.push({
        id,
        label: name ? `@${name}` : refToken(base, i),
        dataType: REF_DATATYPE[base],
      });
    }
  }
  return out;
}

function hasSeedanceOverrides(config: SeedanceVideoNodeConfig): boolean {
  return (
    (config.mode !== undefined && config.mode !== DEFAULT_MODE) ||
    config.duration !== undefined ||
    (config.aspectRatio !== undefined && config.aspectRatio !== DEFAULT_ASPECT) ||
    (config.resolution !== undefined &&
      config.resolution !== DEFAULT_RESOLUTION) ||
    config.generateAudio === false ||
    !isRandomSeed(config.seed) ||
    config.fast === true
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/* Body                                                                   */
/* ────────────────────────────────────────────────────────────────────── */

function SeedanceVideoNodeBody({
  nodeId,
  config,
  updateConfig,
}: NodeBodyProps<SeedanceVideoNodeConfig>) {
  const record = useExecutionStore((s) => s.records.get(nodeId));
  const status = record?.status;
  const history = record?.history ?? [];

  // Reference mode: auto-grow per-type sockets. Track the highest connected
  // index per base as a STABLE string (selector must not return a fresh
  // object — that loops, React #185), then keep one empty trailing socket up
  // to each Fal cap.
  const mode = config.mode ?? DEFAULT_MODE;
  // Stable string snapshot of the ref slots: per-type max index + each wired
  // slot's source node name. A string (not an object) keeps the selector
  // equality stable (returning a fresh object loops — React #185).
  const connectedKey = useWorkflowStore((s) => {
    const m: Record<RefBase, number> = { image: -1, video: -1, audio: -1 };
    const names: string[] = [];
    for (const e of s.edges) {
      if (e.target !== nodeId || !e.targetHandle) continue;
      for (const base of ["image", "video", "audio"] as const) {
        if (e.targetHandle.startsWith(`${base}-`)) {
          const idx = Number(e.targetHandle.slice(base.length + 1));
          if (Number.isFinite(idx)) m[base] = Math.max(m[base], idx);
          const src = s.nodes.find((n) => n.id === e.source);
          const label = (src?.label ?? "").trim();
          if (label) names.push(`${e.targetHandle}=${label}`);
        }
      }
    }
    return `${m.image},${m.video},${m.audio}|${names.sort().join("|")}`;
  });
  useEffect(() => {
    if (mode !== "reference") return;
    // Split ONLY on the first "|": the name part itself contains "|"-joined
    // pairs, so `split("|", 2)` would drop all but the first name (bug: only
    // the alphabetically-first slot kept its name).
    const sep = connectedKey.indexOf("|");
    const counts = sep === -1 ? connectedKey : connectedKey.slice(0, sep);
    const namePart = sep === -1 ? "" : connectedKey.slice(sep + 1);
    const [mi, mv, ma] = counts.split(",").map(Number) as [number, number, number];
    const want = {
      imagePorts: Math.min(REF_CAPS.image, Math.max(1, mi + 2)),
      videoPorts: Math.min(REF_CAPS.video, Math.max(1, mv + 2)),
      audioPorts: Math.min(REF_CAPS.audio, Math.max(1, ma + 2)),
    };
    const refNames: Record<string, string> = {};
    if (namePart) {
      for (const pair of namePart.split("|")) {
        const [slot, ...rest] = pair.split("=");
        const safe = sanitizeRefName(rest.join("="));
        if (slot && safe) refNames[slot] = safe;
      }
    }
    const patch: Partial<SeedanceVideoNodeConfig> = {};
    if (refPortCount(config, "image") !== want.imagePorts) patch.imagePorts = want.imagePorts;
    if (refPortCount(config, "video") !== want.videoPorts) patch.videoPorts = want.videoPorts;
    if (refPortCount(config, "audio") !== want.audioPorts) patch.audioPorts = want.audioPorts;
    if (JSON.stringify(config.refNames ?? {}) !== JSON.stringify(refNames)) {
      patch.refNames = refNames;
    }
    if (Object.keys(patch).length > 0) updateConfig(patch);
  }, [mode, connectedKey, config, updateConfig]);

  const { cursor, setCursor } = useNodeHistoryCursor(nodeId, history.length);

  const activeOutput =
    history.length > 0 ? history[cursor]?.output : record?.output;

  const videoUrl: string | null =
    activeOutput &&
    !Array.isArray(activeOutput) &&
    activeOutput.type === "video"
      ? activeOutput.value.url
      : Array.isArray(activeOutput)
        ? (activeOutput.find((o) => o.type === "video") as
            | (StandardizedOutput & { type: "video" })
            | undefined
          )?.value.url ?? null
        : null;

  const configuredAspect =
    config.aspectRatio && config.aspectRatio !== "auto"
      ? (parseAspectRatio(config.aspectRatio)?.cssAspect ?? "16 / 9")
      : "16 / 9";

  // Prompt-reference tokens for the currently-wired slots, so the user knows
  // exactly what to type (@Image1, @Video1, …). Built from the connected key.
  const refTokens = (() => {
    if (mode !== "reference") return [] as string[];
    const counts = connectedKey.split("|", 1)[0] ?? "-1,-1,-1";
    const [mi, mv, ma] = counts.split(",").map(Number) as [number, number, number];
    const names = config.refNames ?? {};
    const toks: string[] = [];
    const add = (base: RefBase, max: number) => {
      for (let i = 0; i <= max; i++) {
        const slot = `${base}-${i}`;
        toks.push(names[slot] ? `@${names[slot]}` : refToken(base, i));
      }
    };
    add("image", mi);
    add("video", mv);
    add("audio", ma);
    return toks;
  })();

  return (
    <div className="flex w-full min-w-[280px] flex-col gap-2 px-3 pb-2.5 pt-0.5">
      <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
        <span>{config.aspectRatio ?? DEFAULT_ASPECT}</span>
        <span className="text-muted-foreground/60">·</span>
        <span>{config.resolution ?? DEFAULT_RESOLUTION}</span>
        {config.mode && config.mode !== DEFAULT_MODE ? (
          <>
            <span className="text-muted-foreground/60">·</span>
            <span className="text-accent">
              {config.mode === "first-last" ? "first+last" : "first frame"}
            </span>
          </>
        ) : null}
        {config.fast ? (
          <>
            <span className="text-muted-foreground/60">·</span>
            <span className="text-accent">fast</span>
          </>
        ) : null}
      </div>

      {refTokens.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
          <span className="text-muted-foreground/60">prompt refs:</span>
          {refTokens.map((t) => (
            <code
              key={t}
              className="rounded bg-foreground/[0.06] px-1 font-mono text-foreground/80"
            >
              {t}
            </code>
          ))}
        </div>
      ) : null}

      <div className="relative">
        {history.length > 1 ? (
          <div
            data-testid="seedance-history-cursor"
            className="absolute right-1 top-1 z-10"
          >
            <IteratorCursor
              count={history.length}
              cursor={cursor}
              onCursorChange={setCursor}
              ariaLabelPrefix="Clip"
              className="bg-background/75 shadow-sm backdrop-blur-sm"
            />
          </div>
        ) : null}

      {status === "error" && record?.error ? (
        <p
          role="alert"
          className="rounded-md bg-destructive/10 px-2 py-1.5 text-[11px] leading-snug text-destructive"
        >
          {record.error}
        </p>
      ) : status === "running" ? (
        <MediaPreviewPlaceholder
          aspectRatio={configuredAspect}
          testId="seedance-running"
          className="flex-col gap-1.5"
        >
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-[10px]">Rendering — up to a few minutes</span>
        </MediaPreviewPlaceholder>
      ) : videoUrl ? (
        <MediaPreviewVideo
          url={videoUrl}
          aspectRatio={configuredAspect}
          loop
          testId="seedance-result"
          className="bg-black"
        />
      ) : (
        <div className="flex items-center gap-2 rounded-md border border-dashed border-border/40 bg-foreground/[0.02] px-2 py-2 text-[11px] text-muted-foreground">
          <Film className="h-3 w-3" />
          <span>Wire a prompt (+ optional refs), then Run</span>
        </div>
      )}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/* Settings popover content                                               */
/* ────────────────────────────────────────────────────────────────────── */

function SeedanceVideoSettingsContent({
  config,
  updateConfig,
}: NodeBodyProps<SeedanceVideoNodeConfig>) {
  const modeId = useId();
  const durationId = useId();
  const aspectId = useId();
  const resolutionId = useId();
  const seedId = useId();

  const mode = config.mode ?? DEFAULT_MODE;
  const isImageMode = mode !== "reference";

  return (
    <div className="flex flex-col gap-3 text-xs">
      {/* Mode */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={modeId} className="font-medium text-foreground/90">
          Mode
        </label>
        <select
          id={modeId}
          value={mode}
          onChange={(e) =>
            updateConfig({ mode: e.target.value as SeedanceMode })
          }
          className="h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs"
        >
          <option value="reference">reference (images / videos / audio)</option>
          <option value="first-frame">first frame (animate start image)</option>
          <option value="first-last">first + last frame (start → end)</option>
        </select>
        {isImageMode ? (
          <p className="text-[10px] leading-snug text-muted-foreground">
            image-to-video: uses the wired{" "}
            {mode === "first-last" ? "images as start + end frame" : "image as the start frame"}
            . Ignores video/audio refs; caps at 720p.
          </p>
        ) : null}
      </div>

      {/* Duration */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={durationId} className="font-medium text-foreground/90">
          Duration
        </label>
        <select
          id={durationId}
          value={config.duration === undefined ? "auto" : String(config.duration)}
          onChange={(e) =>
            updateConfig({
              duration:
                e.target.value === "auto" ? "auto" : Number(e.target.value),
            })
          }
          className="h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs"
        >
          <option value="auto">auto</option>
          {[4, 5, 6, 8, 10, 12, 15].map((s) => (
            <option key={s} value={s}>
              {s}s
            </option>
          ))}
        </select>
      </div>

      {/* Aspect ratio */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={aspectId} className="font-medium text-foreground/90">
          Aspect ratio
        </label>
        <select
          id={aspectId}
          value={config.aspectRatio ?? DEFAULT_ASPECT}
          onChange={(e) =>
            updateConfig({
              aspectRatio: e.target
                .value as SeedanceVideoNodeConfig["aspectRatio"],
            })
          }
          className="h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs"
        >
          {SEEDANCE_ASPECT_RATIOS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>

      {/* Resolution */}
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={resolutionId}
          className="font-medium text-foreground/90"
        >
          Resolution
        </label>
        <select
          id={resolutionId}
          value={config.resolution ?? DEFAULT_RESOLUTION}
          onChange={(e) =>
            updateConfig({
              resolution: e.target
                .value as SeedanceVideoNodeConfig["resolution"],
            })
          }
          className="h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs"
        >
          {SEEDANCE_RESOLUTIONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>

      {/* Native audio toggle */}
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={config.generateAudio !== false}
          onChange={(e) => updateConfig({ generateAudio: e.target.checked })}
        />
        <span className="text-foreground/90">
          Generate native audio (lip-sync / SFX / music)
        </span>
      </label>

      {/* Fast tier toggle */}
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={config.fast === true}
          onChange={(e) => updateConfig({ fast: e.target.checked })}
        />
        <span className="text-foreground/90">Fast tier (cheaper, quicker)</span>
      </label>

      {/* Seed */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={seedId} className="font-medium text-foreground/90">
          Seed
          <span className="ml-1 text-[10px] font-normal text-muted-foreground">
            (-1 = random each run)
          </span>
        </label>
        <input
          id={seedId}
          type="number"
          step={1}
          placeholder="-1"
          value={config.seed ?? RANDOM_SEED}
          onChange={(e) => {
            const raw = e.target.value;
            updateConfig({
              seed: raw === "" ? RANDOM_SEED : Number(raw),
            });
          }}
          className="h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs"
        />
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/* Schema                                                                 */
/* ────────────────────────────────────────────────────────────────────── */

export const seedanceVideoNodeSchema = defineNode<SeedanceVideoNodeConfig>({
  kind: "seedance-video",
  category: "ai-video",
  title: "Seedance Video",
  description:
    "Generate video with ByteDance Seedance 2.0. Reference mode: wire a prompt + reference images/videos/audio into the numbered sockets and reference them in the prompt as @Image1, @Video1, @Audio1 (the socket label shows its exact token). Up to 9 images / 3 videos / 3 audios; sockets grow as you wire. Or switch to image-to-video mode for literal first/last frame. Native synced audio + person-swap + lip-sync.",
  icon: Clapperboard,
  inputs: referenceInputs({}),
  // Handles follow the mode (ADR-0054): image-to-video shows literal
  // start/(end) frame sockets instead of the reference image/video/audio set,
  // so the first/last-frame contract is visible on the node, not hidden in
  // settings.
  getInputs: (config) => {
    const mode = config.mode ?? DEFAULT_MODE;
    if (mode === "first-frame") {
      return [
        { id: "prompt", label: "prompt", dataType: "text" },
        { id: "start", label: "start frame", dataType: "image" },
      ];
    }
    if (mode === "first-last") {
      return [
        { id: "prompt", label: "prompt", dataType: "text" },
        { id: "start", label: "start frame", dataType: "image" },
        { id: "end", label: "end frame", dataType: "image" },
      ];
    }
    // Reference mode: numbered per-type sockets that auto-grow up to the Fal
    // caps (9 images / 3 videos / 3 audios).
    return referenceInputs(config);
  },
  outputs: [{ id: "out", label: "out", dataType: "video" }],
  configParams: {
    mode: { control: "select", options: ["reference", "first-frame", "first-last"], label: "mode" },
    aspectRatio: { control: "select", options: SEEDANCE_ASPECT_RATIOS, label: "aspect ratio" },
    resolution: { control: "select", options: SEEDANCE_RESOLUTIONS, label: "resolution" },
    generateAudio: { control: "toggle", label: "native audio" },
    fast: { control: "toggle", label: "fast tier" },
    seed: { control: "number", label: "seed" },
  },
  defaultConfig: {
    generateAudio: true,
    resolution: DEFAULT_RESOLUTION,
    seed: RANDOM_SEED,
  },
  reactive: false,
  // seed === -1 (or unset) -> random each run -> bust the cache.
  isCacheBusting: (config) => isRandomSeed(config.seed),
  execute: async ({ config, inputs, signal }) => {
    const mode = config.mode ?? DEFAULT_MODE;
    const prompt = (
      extractInputByType(inputs, "prompt", "text") ?? ""
    ).trim();

    const common = {
      ...(config.duration !== undefined ? { duration: config.duration } : {}),
      ...(config.aspectRatio ? { aspectRatio: config.aspectRatio } : {}),
      ...(config.resolution ? { resolution: config.resolution } : {}),
      ...(config.generateAudio !== undefined
        ? { generateAudio: config.generateAudio }
        : {}),
      // Resolve -1 / unset to a concrete random seed each run.
      seed: resolveSeed(config.seed),
      ...(config.fast ? { fast: true } : {}),
    } as const;

    let request: SeedanceVideoRequest;
    if (mode === "first-frame" || mode === "first-last") {
      // image-to-video: dedicated start/(end) frame sockets (ADR-0054).
      const startImageUrl = extractInputByType(inputs, "start", "image")?.url;
      if (!startImageUrl) {
        throw new Error(
          "image-to-video needs a start frame — wire an image into the `start frame` socket.",
        );
      }
      const endImageUrl =
        mode === "first-last"
          ? extractInputByType(inputs, "end", "image")?.url
          : undefined;
      if (mode === "first-last" && !endImageUrl) {
        throw new Error(
          "First + last mode needs an `end frame` wired too.",
        );
      }
      request = {
        prompt,
        startImageUrl,
        ...(endImageUrl ? { endImageUrl } : {}),
        ...common,
      };
    } else {
      // Gather each type from its numbered sockets in order, then any legacy
      // single multi-handle (pre-ADR-0058 graphs) as a fallback.
      const extractOne = (handle: string, base: RefBase): string | undefined => {
        const r =
          base === "image"
            ? extractInputByType(inputs, handle, "image")
            : base === "video"
              ? extractInputByType(inputs, handle, "video")
              : extractInputByType(inputs, handle, "audio");
        return r?.url || undefined;
      };
      const extractMany = (handle: string, base: RefBase): string[] => {
        const arr =
          base === "image"
            ? extractInputArrayByType(inputs, handle, "image")
            : base === "video"
              ? extractInputArrayByType(inputs, handle, "video")
              : extractInputArrayByType(inputs, handle, "audio");
        return arr.map((r) => r.url).filter(Boolean);
      };
      // Gather filled sockets in index order; assign SEQUENTIAL Fal tokens to
      // the filled ones (gap-proof) and remember which friendly name maps to
      // which token, so we can rewrite the prompt.
      const nameToToken: Record<string, string> = {};
      const refNames = config.refNames ?? {};
      const gather = (base: RefBase): string[] => {
        const urls: string[] = [];
        for (let i = 0; i < REF_CAPS[base]; i++) {
          const u = extractOne(`${base}-${i}`, base);
          if (!u) continue;
          urls.push(u);
          const token = refToken(base, urls.length - 1); // sequential position
          const name = refNames[`${base}-${i}`];
          if (name) nameToToken[name] = token;
        }
        const legacy = extractMany(base, base);
        return [...urls, ...legacy].slice(0, REF_CAPS[base]);
      };
      const imageUrls = gather("image");
      const videoUrls = gather("video");
      const audioUrls = gather("audio");

      // Rewrite `@friendlyName` → the Fal positional token. Longest names
      // first so one name can't partially shadow another. Direct `@Image1`
      // tokens in the prompt are left untouched.
      const finalPrompt = Object.entries(nameToToken)
        .sort((a, b) => b[0].length - a[0].length)
        .reduce(
          (text, [name, token]) =>
            text.replace(
              new RegExp(`@${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"),
              token,
            ),
          prompt,
        );

      const hasRefs =
        imageUrls.length > 0 || videoUrls.length > 0 || audioUrls.length > 0;
      if (prompt.length === 0 && !hasRefs) {
        throw new Error(
          "Nothing to generate — wire a prompt (or reference media) into the node.",
        );
      }

      // Client-side constraint check before spending (Slice A helpers).
      const durationSec =
        typeof config.duration === "number" ? config.duration : undefined;
      const violations = validateSeedanceRequest({
        durationSec,
        imageCount: imageUrls.length,
        videoCount: videoUrls.length,
        audioCount: audioUrls.length,
      });
      if (violations.length > 0) {
        throw new Error(violations.map((v) => v.message).join(" "));
      }

      request = {
        prompt: finalPrompt,
        ...(imageUrls.length ? { imageUrls } : {}),
        ...(videoUrls.length ? { videoUrls } : {}),
        ...(audioUrls.length ? { audioUrls } : {}),
        ...common,
      };
    }

    const result = await callSeedanceVideo({ ...request, signal });

    const ref: VideoRef = { url: result.videoUrl, mime: result.mime };
    return {
      output: { type: "video", value: ref },
      usage: { model: result.model },
    };
  },
  Body: SeedanceVideoNodeBody,
  settings: {
    Content: SeedanceVideoSettingsContent,
    hasOverrides: hasSeedanceOverrides,
  },
  size: {
    defaultWidth: 360,
    minWidth: 280,
    maxWidth: 720,
    resizable: "both",
  },
});
