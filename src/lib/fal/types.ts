import { z } from "zod";

// Seed convention (RANDOM_SEED / resolveSeed / isRandomSeed) lives in
// @/lib/utils/seed — shared with the Higgsfield node too. Re-exported here
// for the existing Fal node imports.
export { RANDOM_SEED, resolveSeed, isRandomSeed } from "@/lib/utils/seed";

/**
 * Fal media types — Slice B (multimodal media arc).
 *
 * Request/response contract for the Seedance video endpoint, mirroring the
 * Higgsfield types pattern (Zod request schema validated at the route +
 * typed success/error responses). The CLIENT sends this shape to
 * `/api/fal/seedance`; the server wrapper translates it to Fal's
 * `bytedance/seedance-2.0/*` input and dispatches via `@fal-ai/client`.
 *
 * Source of truth for the field set: Fal docs (confirmed 2026-05-28) +
 * docs/FAL-CATALOG.md. Constraints are validated client-side first
 * (src/lib/media/constraints.ts) and again here.
 */

export const SEEDANCE_ASPECT_RATIOS = [
  "auto",
  "21:9",
  "16:9",
  "4:3",
  "1:1",
  "3:4",
  "9:16",
] as const;

export const SEEDANCE_RESOLUTIONS = ["480p", "720p", "1080p"] as const;

/**
 * Seedance model tiers (ADR-0078) — the same `bytedance/seedance-2.0/*` family
 * at three speed / cost points:
 *   - "standard" — Seedance 2.0 (highest quality; up to 1080p)
 *   - "fast"     — `/fast/` tier (lower latency + cost; caps at 720p)
 *   - "mini"     — `/mini/` tier (cheapest + quickest; caps at 720p;
 *                  reference-to-video only for now — image-to-video later)
 */
export const SEEDANCE_MODEL_TIERS = ["standard", "fast", "mini"] as const;
export type SeedanceModelTier = (typeof SEEDANCE_MODEL_TIERS)[number];

export const seedanceVideoRequestSchema = z
  .object({
    /** Scene / continuation description. Required for text-to-video. */
    prompt: z.string().default(""),
    /** Reference images (@Image1..@Image9). */
    imageUrls: z.array(z.string().url()).max(9).optional(),
    /** Reference videos (@Video1..@Video3) — continuity / motion. */
    videoUrls: z.array(z.string().url()).max(3).optional(),
    /** Reference audio (@Audio1..@Audio3) — lip-sync / rhythm. */
    audioUrls: z.array(z.string().url()).max(3).optional(),
    /**
     * image-to-video: the starting frame the model animates FROM. Its
     * presence switches the endpoint to `image-to-video` (a distinct model
     * from reference-to-video — literal first/last frame control instead of
     * soft references). Mutually exclusive with the reference arrays.
     */
    startImageUrl: z.string().url().optional(),
    /** image-to-video: optional ending frame (start→end transition). */
    endImageUrl: z.string().url().optional(),
    /** 4-15s, or "auto" to let the model decide. */
    duration: z
      .union([z.literal("auto"), z.number().int().min(4).max(15)])
      .optional(),
    aspectRatio: z.enum(SEEDANCE_ASPECT_RATIOS).optional(),
    resolution: z.enum(SEEDANCE_RESOLUTIONS).optional(),
    /** Native synchronized audio (default true on Fal; same cost on/off). */
    generateAudio: z.boolean().optional(),
    seed: z.number().int().optional(),
    /**
     * Model tier (ADR-0078): "standard" | "fast" | "mini". Drives which
     * `bytedance/seedance-2.0/*` family endpoint the wrapper dispatches to.
     */
    model: z.enum(SEEDANCE_MODEL_TIERS).optional(),
    /**
     * @deprecated Legacy fast-tier boolean, superseded by `model`. Kept so
     * older persisted nodes / in-flight payloads still resolve to the fast
     * tier; the node sends `model` now.
     */
    fast: z.boolean().optional(),
  })
  .strict();

export type SeedanceVideoRequest = z.infer<typeof seedanceVideoRequestSchema>;

export interface SeedanceVideoSuccessResponse {
  videoUrl: string;
  mime?: string;
  seed?: number;
  /** The Fal endpoint id that produced it (for usage attribution). */
  model: string;
}

/**
 * Async queue flow (ADR-0057). Submitting returns a request id + the endpoint
 * it was queued on; the client then polls the status route until done. This
 * replaces the old single blocking request, which a network blip / tab
 * backgrounding / function timeout would kill mid-render (Fal finishes, the
 * client never gets the video).
 */
export interface SeedanceSubmitResponse {
  requestId: string;
  endpoint: string;
}

export const seedanceStatusRequestSchema = z
  .object({
    endpoint: z.string().min(1),
    requestId: z.string().min(1),
  })
  .strict();

export type SeedanceStatusRequest = z.infer<typeof seedanceStatusRequestSchema>;

export type SeedanceStatusResponse =
  | { status: "pending" }
  | ({ status: "done" } & SeedanceVideoSuccessResponse);

export type FalErrorCode =
  | "invalid_request"
  | "missing_key"
  | "aborted"
  | "upstream_error"
  | "timeout"
  | "unknown";

/**
 * Turn a @fal-ai/client error into a readable message. Fal's 422
 * (ValidationError) carries `body.detail` (FastAPI shape:
 * [{ loc, msg, type }]) — surfacing the offending field beats a bare
 * "Unprocessable Entity". Falls back to the generic message otherwise.
 */
export function describeFalError(err: unknown): string {
  const e = err as {
    status?: number;
    body?: { detail?: unknown };
    message?: string;
  };
  const detail = e?.body?.detail;
  if (Array.isArray(detail)) {
    const parts = detail
      .map((d) => {
        const dd = d as { loc?: unknown[]; msg?: string };
        const field = Array.isArray(dd.loc)
          ? dd.loc.filter((x) => x !== "body").join(".")
          : "";
        return field ? `${field}: ${dd.msg}` : (dd.msg ?? "");
      })
      .filter(Boolean);
    if (parts.length > 0) return parts.join("; ");
  }
  if (typeof detail === "string") return detail;
  return e?.message ?? "Fal request failed";
}

export interface FalErrorResponse {
  error: string;
  code?: FalErrorCode;
}

/* ────────────────────────── Fal image generation ──────────────────────── */

/**
 * The image models we expose (Slice F). One node, a model picker. Each maps
 * to a text-to-image endpoint + an edit endpoint (used when reference images
 * are wired). Endpoint ids are best-effort from the Fal catalog and verified
 * during the test phase. Default: nano-banana-2 (the user's daily driver).
 */
export const FAL_IMAGE_MODELS = [
  "nano-banana-2",
  "flux-2-pro",
  "seedream-v4.5",
  "krea-v2-medium",
  "krea-v2-large",
] as const;

export type FalImageModel = (typeof FAL_IMAGE_MODELS)[number];

/** Default Fal Image model — used as a fallback when normalizing an
 *  unknown / legacy `config.model` so the canvas never crashes on a
 *  bad value. Mirrors `DEFAULT_MODEL` in `node-fal-image.tsx`. */
export const FAL_IMAGE_DEFAULT_MODEL: FalImageModel = "nano-banana-2";

/**
 * Coerce a free-form `config.model` to a known {@link FalImageModel}. Tries
 * exact match first, then strips the `fal-ai/` endpoint prefix (the
 * assistant occasionally writes the endpoint id by mistake — see
 * `image-api.ts` `gen: "fal-ai/nano-banana-2"`). Falls back to
 * {@link FAL_IMAGE_DEFAULT_MODEL} for anything else so the canvas stays
 * resilient to legacy / hand-edited project documents.
 *
 * Pure + dependency-free so both the runtime renderer AND the graph
 * migrator can use it without pulling in the node registry.
 */
export function normalizeFalImageModel(raw: unknown): FalImageModel {
  if (typeof raw !== "string" || raw.length === 0) {
    return FAL_IMAGE_DEFAULT_MODEL;
  }
  if ((FAL_IMAGE_MODELS as readonly string[]).includes(raw)) {
    return raw as FalImageModel;
  }
  if (raw.startsWith("fal-ai/")) {
    const stripped = raw.slice("fal-ai/".length);
    if ((FAL_IMAGE_MODELS as readonly string[]).includes(stripped)) {
      return stripped as FalImageModel;
    }
  }
  return FAL_IMAGE_DEFAULT_MODEL;
}

export const FAL_IMAGE_MODEL_LABELS: Record<FalImageModel, string> = {
  "nano-banana-2": "Nano Banana 2 (Google)",
  "flux-2-pro": "Flux 2 [pro]",
  "seedream-v4.5": "Seedream 4.5 (ByteDance)",
  "krea-v2-medium": "Krea 2 Medium",
  "krea-v2-large": "Krea 2 Large",
};

/* Per-model option sets (verified from Fal docs 2026-05-29). Each model takes
 * a DIFFERENT size control + extras — so the node renders only the controls a
 * model actually supports rather than a one-size-fits-all panel. */
export const NANO_ASPECT_RATIOS = [
  "auto", "21:9", "16:9", "3:2", "4:3", "5:4", "1:1",
  "4:5", "3:4", "2:3", "9:16", "4:1", "1:4", "8:1", "1:8",
] as const;
export const NANO_RESOLUTIONS = ["0.5K", "1K", "2K", "4K"] as const;
export const FLUX_IMAGE_SIZES = [
  "square_hd", "square", "portrait_4_3", "portrait_16_9",
  "landscape_4_3", "landscape_16_9",
] as const;
export const SEEDREAM_IMAGE_SIZES = [
  "square_hd", "square", "portrait_4_3", "portrait_16_9",
  "landscape_4_3", "landscape_16_9", "auto_2K", "auto_4K",
] as const;

/**
 * Custom-resolution constraints for the Fal models that accept a
 * `{ width, height }` object in `image_size` (Flux 2 Pro and Seedream 4.5;
 * Krea genuinely does not — Fal docs: "Krea returns a fixed-resolution
 * image per ratio — no width/height"). Seedream additionally enforces
 * 1920–4096px per axis; Flux is unconstrained beyond positive integers.
 */
export const FLUX_CUSTOM_SIZE = {
  min: 256,
  max: 2048,
  default: 1024,
} as const;
export const SEEDREAM_CUSTOM_SIZE = {
  min: 1920,
  max: 4096,
  default: 2048,
} as const;
export const KREA_ASPECT_RATIOS = [
  "1:1", "4:3", "3:2", "16:9", "2.35:1", "4:5", "2:3", "9:16",
] as const;
export const KREA_CREATIVITY = ["raw", "low", "medium", "high"] as const;

/**
 * What each image model actually accepts. Absent field = control hidden and
 * the wrapper drops any stale value. `editRefs` = max wired images for the
 * edit endpoint; `styleReferences` = max wired images used as Krea style
 * guides (no edit endpoint — refs steer style, with per-call strength).
 */
export interface FalImageModelCaps {
  aspectRatios?: readonly string[];
  imageSizes?: readonly string[];
  resolutions?: readonly string[];
  numImages?: { max: number };
  creativity?: readonly string[];
  styleReferences?: { max: number };
  editRefs?: { max: number };
}

export const FAL_IMAGE_MODEL_CAPS: Record<FalImageModel, FalImageModelCaps> = {
  "nano-banana-2": {
    aspectRatios: NANO_ASPECT_RATIOS,
    resolutions: NANO_RESOLUTIONS,
    numImages: { max: 4 },
    editRefs: { max: 14 },
  },
  "flux-2-pro": {
    imageSizes: FLUX_IMAGE_SIZES,
    editRefs: { max: 8 },
  },
  "seedream-v4.5": {
    imageSizes: SEEDREAM_IMAGE_SIZES,
    numImages: { max: 6 },
    editRefs: { max: 10 },
  },
  "krea-v2-medium": {
    aspectRatios: KREA_ASPECT_RATIOS,
    creativity: KREA_CREATIVITY,
    styleReferences: { max: 10 },
  },
  "krea-v2-large": {
    aspectRatios: KREA_ASPECT_RATIOS,
    creativity: KREA_CREATIVITY,
    styleReferences: { max: 10 },
  },
};

/** Krea style-reference entry: a public image URL + influence strength. */
export const falStyleReferenceSchema = z
  .object({
    imageUrl: z.string().url(),
    strength: z.number().optional(),
  })
  .strict();

export type FalStyleReference = z.infer<typeof falStyleReferenceSchema>;

/** Custom dimensions for `image_size` — Flux 2 Pro, Seedream 4.5. */
export const falImageCustomSizeSchema = z
  .object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();

export type FalImageCustomSize = z.infer<typeof falImageCustomSizeSchema>;

export const falImageRequestSchema = z
  .object({
    model: z.enum(FAL_IMAGE_MODELS),
    prompt: z.string().min(1),
    /** When present (edit-capable models), switches to the edit endpoint. */
    imageUrls: z.array(z.string().url()).max(14).optional(),
    numImages: z.number().int().min(1).max(6).optional(),
    seed: z.number().int().optional(),
    /** nano-banana / krea. */
    aspectRatio: z.string().optional(),
    /** flux / seedream — preset name OR { width, height }. */
    imageSize: z.union([z.string(), falImageCustomSizeSchema]).optional(),
    /** nano-banana. */
    resolution: z.string().optional(),
    /** krea. */
    creativity: z.string().optional(),
    /** krea — wired images as style guides. */
    styleReferences: z.array(falStyleReferenceSchema).max(10).optional(),
  })
  .strict();

export type FalImageRequest = z.infer<typeof falImageRequestSchema>;

export interface FalImageSuccessResponse {
  imageUrls: string[];
  seed?: number;
  model: string;
}

/* ───────────────────── ElevenLabs audio isolation ───────────────────── */

/** Fal `fal-ai/elevenlabs/audio-isolation` — isolate vocals from audio/video. */
export const AUDIO_ISOLATION_ENDPOINT = "fal-ai/elevenlabs/audio-isolation";

export const audioIsolationRequestSchema = z
  .object({
    /** Isolate from an audio file. */
    audioUrl: z.string().url().optional(),
    /** Isolate from a video file (uses its audio track). */
    videoUrl: z.string().url().optional(),
  })
  .strict()
  .refine((d) => Boolean(d.audioUrl) || Boolean(d.videoUrl), {
    message: "Either audioUrl or videoUrl is required",
  });

export type AudioIsolationRequest = z.infer<typeof audioIsolationRequestSchema>;

export interface AudioIsolationSuccessResponse {
  audioUrl: string;
  mime?: string;
  model: string;
}

export interface AudioIsolationSubmitResponse {
  requestId: string;
  endpoint: string;
}

export const audioIsolationStatusRequestSchema = z
  .object({
    endpoint: z.string().min(1),
    requestId: z.string().min(1),
  })
  .strict();

export type AudioIsolationStatusRequest = z.infer<
  typeof audioIsolationStatusRequestSchema
>;

export type AudioIsolationStatusResponse =
  | { status: "pending" }
  | ({ status: "done" } & AudioIsolationSuccessResponse);

/* ───────────────────── SAM 3 image segmentation ───────────────────── */

/** Fal `fal-ai/sam-3/image` — promptable segmentation / cutout. */
export const SAM3_ENDPOINT = "fal-ai/sam-3/image";

export const SAM3_OUTPUT_FORMATS = ["jpeg", "png", "webp"] as const;
export type Sam3OutputFormat = (typeof SAM3_OUTPUT_FORMATS)[number];

export const sam3RequestSchema = z
  .object({
    imageUrl: z.string().url(),
    /** Text prompt for what to segment (e.g. "person", "wheel"). */
    prompt: z.string().optional(),
    applyMask: z.boolean().optional(),
    returnMultipleMasks: z.boolean().optional(),
    maxMasks: z.number().int().min(1).max(32).optional(),
    outputFormat: z.enum(SAM3_OUTPUT_FORMATS).optional(),
    includeScores: z.boolean().optional(),
    includeBoxes: z.boolean().optional(),
  })
  .strict();

export type Sam3Request = z.infer<typeof sam3RequestSchema>;

export interface Sam3SuccessResponse {
  /** Primary cutout / masked preview (`output.image` when apply_mask). */
  primaryUrl?: string;
  /** Raw mask image URLs (`output.masks`). */
  maskUrls: string[];
  scores?: number[];
  model: string;
}

/* ───────────────────── Hunyuan 3D Pro image-to-3d ───────────────────── */

/** Fal `fal-ai/hunyuan-3d/v3.1/pro/image-to-3d` — generate a GLB mesh from images. */
export const HUNYUAN3D_ENDPOINT = "fal-ai/hunyuan-3d/v3.1/pro/image-to-3d";

export const HUNYUAN3D_GENERATE_TYPES = ["Normal", "Geometry"] as const;
export type Hunyuan3dGenerateType = (typeof HUNYUAN3D_GENERATE_TYPES)[number];

export const HUNYUAN3D_FACE_COUNT_MIN = 40_000;
export const HUNYUAN3D_FACE_COUNT_MAX = 1_500_000;
export const HUNYUAN3D_FACE_COUNT_DEFAULT = 500_000;

export const hunyuan3dRequestSchema = z
  .object({
    /** Required: front view image. */
    inputImageUrl: z.string().url(),
    /** Optional multi-view images (any combination). */
    backImageUrl: z.string().url().optional(),
    leftImageUrl: z.string().url().optional(),
    rightImageUrl: z.string().url().optional(),
    topImageUrl: z.string().url().optional(),
    bottomImageUrl: z.string().url().optional(),
    leftFrontImageUrl: z.string().url().optional(),
    rightFrontImageUrl: z.string().url().optional(),

    generateType: z.enum(HUNYUAN3D_GENERATE_TYPES).optional(),
    /** Adds $0.15 when true and generateType !== "Geometry". */
    enablePbr: z.boolean().optional(),
    /** Adds $0.15 when set. Range 40k–1.5M. */
    faceCount: z
      .number()
      .int()
      .min(HUNYUAN3D_FACE_COUNT_MIN)
      .max(HUNYUAN3D_FACE_COUNT_MAX)
      .optional(),
  })
  .strict();

export type Hunyuan3dRequest = z.infer<typeof hunyuan3dRequestSchema>;

export interface Hunyuan3dSuccessResponse {
  /** GLB url — the canonical mesh URL the viewer renders. */
  glbUrl: string;
  /** Optional sibling format. */
  objUrl?: string;
  /** Optional thumbnail PNG. */
  thumbnailUrl?: string;
  /** GLB file size in bytes if reported. */
  sizeBytes?: number;
  seed?: number;
  model: string;
}

export interface Hunyuan3dSubmitResponse {
  requestId: string;
  endpoint: string;
}

export const hunyuan3dStatusRequestSchema = z
  .object({
    endpoint: z.string().min(1),
    requestId: z.string().min(1),
  })
  .strict();

export type Hunyuan3dStatusRequest = z.infer<typeof hunyuan3dStatusRequestSchema>;

export type Hunyuan3dStatusResponse =
  | { status: "pending" }
  | ({ status: "done" } & Hunyuan3dSuccessResponse);

/* ───────────────────────── Marlin video VLM ──────────────────────────── */

/** Fal `fal-ai/marlin` — 2B video VLM. Captions a clip with scene + events. */
export const MARLIN_ENDPOINT = "fal-ai/marlin";

/**
 * Marlin's canonical training prompt. The docs explicitly warn that
 * overriding usually degrades output quality, so the node defaults to
 * this and treats it as a knob, not a required field.
 */
export const MARLIN_DEFAULT_PROMPT =
  "Provide a spatial description of this clip followed by time-ranged events.\nFor each event, give the time range as <start - end> and a short description.";

export const MARLIN_MAX_TOKENS_MIN = 64;
export const MARLIN_MAX_TOKENS_MAX = 4_096;
export const MARLIN_MAX_TOKENS_DEFAULT = 2_048;

export const marlinRequestSchema = z
  .object({
    videoUrl: z.string().url(),
    prompt: z.string().min(1).default(MARLIN_DEFAULT_PROMPT),
    maxTokens: z
      .number()
      .int()
      .min(MARLIN_MAX_TOKENS_MIN)
      .max(MARLIN_MAX_TOKENS_MAX)
      .optional(),
    doSample: z.boolean().optional(),
    /** Only used when doSample = true. */
    temperature: z.number().min(0).max(2).optional(),
    topP: z.number().min(0).max(1).optional(),
  })
  .strict();

export type MarlinRequest = z.infer<typeof marlinRequestSchema>;

export interface MarlinEventSegment {
  start: number;
  end: number;
  text: string;
}

export interface MarlinSuccessResponse {
  /** Spatial description of the clip. */
  scene: string;
  /** Time-ranged events. */
  events: MarlinEventSegment[];
  /** Full post-thinking caption text (Scene + Events) — the canonical text output. */
  text: string;
  model: string;
}

export interface MarlinSubmitResponse {
  requestId: string;
  endpoint: string;
}

export const marlinStatusRequestSchema = z
  .object({
    endpoint: z.string().min(1),
    requestId: z.string().min(1),
  })
  .strict();

export type MarlinStatusRequest = z.infer<typeof marlinStatusRequestSchema>;

export type MarlinStatusResponse =
  | { status: "pending" }
  | ({ status: "done" } & MarlinSuccessResponse);

/* ──────────────────── HeyGen Lipsync Precision ──────────────────── */

/** Fal `fal-ai/heygen/v3/lipsync/precision` — replace/dub audio on a video with avatar lipsync. */
export const HEYGEN_LIPSYNC_ENDPOINT = "fal-ai/heygen/v3/lipsync/precision";

export const heygenLipsyncRequestSchema = z
  .object({
    videoUrl: z.string().url(),
    audioUrl: z.string().url(),
    title: z.string().max(200).optional(),
    enableCaption: z.boolean().optional(),
    /** Default true — let HeyGen stretch/trim video to fit new audio. */
    enableDynamicDuration: z.boolean().optional(),
    disableMusicTrack: z.boolean().optional(),
    enableSpeechEnhancement: z.boolean().optional(),
    /** Partial-lipsync window. Both must be set (or neither). */
    startTime: z.number().nonnegative().optional(),
    endTime: z.number().nonnegative().optional(),
  })
  .strict()
  .refine(
    (v) =>
      (v.startTime === undefined && v.endTime === undefined) ||
      (v.startTime !== undefined &&
        v.endTime !== undefined &&
        v.endTime > v.startTime),
    {
      message:
        "startTime and endTime must both be set, with endTime > startTime",
      path: ["endTime"],
    },
  );

export type HeygenLipsyncRequest = z.infer<typeof heygenLipsyncRequestSchema>;

export interface HeygenLipsyncSuccessResponse {
  videoUrl: string;
  /** Optional caption file when `enableCaption` is true and HeyGen returns one. */
  captionUrl?: string;
  mime?: string;
  model: string;
}

export interface HeygenLipsyncSubmitResponse {
  requestId: string;
  endpoint: string;
}

export const heygenLipsyncStatusRequestSchema = z
  .object({
    endpoint: z.string().min(1),
    requestId: z.string().min(1),
  })
  .strict();

export type HeygenLipsyncStatusRequest = z.infer<
  typeof heygenLipsyncStatusRequestSchema
>;

export type HeygenLipsyncStatusResponse =
  | { status: "pending" }
  | ({ status: "done" } & HeygenLipsyncSuccessResponse);

/* ────────────────── ElevenLabs Scribe V2 (speech → text) ────────────────── */

/** Fal `fal-ai/elevenlabs/speech-to-text/scribe-v2` — fast STT with word-level timestamps + speaker diarization. */
export const SCRIBE_V2_ENDPOINT =
  "fal-ai/elevenlabs/speech-to-text/scribe-v2";

/**
 * Per-word transcription segment. `type: "word"` is an actual token; `"spacing"`
 * marks the gap between words. Both come back interleaved from Fal so a UI
 * that renders inline timing can stitch them in order without inventing
 * spacing of its own.
 */
export interface ScribeV2WordSegment {
  start: number;
  end: number;
  text: string;
  /** Defaults to `"word"` when Fal omits the field. */
  type: "word" | "spacing";
  /** Set only when `diarize: true`; e.g. `"speaker_0"`. */
  speakerId?: string;
}

/**
 * Per-keyterm Fal limits. Up to 100 terms, each ≤ 50 chars. Adds 30%
 * to the per-minute price when ANY keyterm is set.
 */
export const SCRIBE_V2_KEYTERMS_MAX_COUNT = 100;
export const SCRIBE_V2_KEYTERMS_MAX_LENGTH = 50;

export const scribeV2RequestSchema = z
  .object({
    audioUrl: z.string().url(),
    /** ISO 639-2 / language code (e.g. "eng", "spa"). Omit for auto-detect. */
    languageCode: z.string().min(1).max(8).optional(),
    /** Tag laughter / applause / etc. Default true on Fal. */
    tagAudioEvents: z.boolean().optional(),
    /** Annotate speakers (`speaker_0`, `speaker_1`, …). Default true on Fal. */
    diarize: z.boolean().optional(),
    /**
     * Bias terms — words / phrases the model should prefer to transcribe.
     * Adds 30% to base price when non-empty. Capped per Fal's docs.
     */
    keyterms: z
      .array(z.string().min(1).max(SCRIBE_V2_KEYTERMS_MAX_LENGTH))
      .max(SCRIBE_V2_KEYTERMS_MAX_COUNT)
      .optional(),
  })
  .strict();

export type ScribeV2Request = z.infer<typeof scribeV2RequestSchema>;

export interface ScribeV2SuccessResponse {
  /** Full reconstructed transcript — the canonical text output. */
  text: string;
  /** Detected (or echoed) language code. */
  languageCode: string;
  /** Confidence in language detection (0..1). */
  languageProbability: number;
  /** Word-level segments with start / end timestamps + speaker id. */
  words: ScribeV2WordSegment[];
  model: string;
}

export interface ScribeV2SubmitResponse {
  requestId: string;
  endpoint: string;
}

export const scribeV2StatusRequestSchema = z
  .object({
    endpoint: z.string().min(1),
    requestId: z.string().min(1),
  })
  .strict();

export type ScribeV2StatusRequest = z.infer<typeof scribeV2StatusRequestSchema>;

export type ScribeV2StatusResponse =
  | { status: "pending" }
  | ({ status: "done" } & ScribeV2SuccessResponse);

/* ─────────────────── VEED Subtitles (video → subtitled video) ─────────────────── */

/** Fal `veed/subtitles` — burn auto-transcribed, styled subtitles into a video. */
export const VEED_SUBTITLES_ENDPOINT = "veed/subtitles";

/**
 * Subtitle style presets, split by pricing tier (Fal docs, confirmed
 * 2026-06-19):
 *   - DYNAMIC (2x multiplier): richer, context-aware rendering that adapts
 *     to the input.
 *   - BASIC (1x multiplier): fixed, lightweight styling with predictable
 *     output.
 * Kept as two tier arrays so the node can group / 2x-label the dynamic ones
 * and the cost note can detect a dynamic pick without a separate map. The
 * Zod enum + dropdown source ({@link VEED_SUBTITLE_PRESETS}) is built from
 * both.
 */
export const VEED_DYNAMIC_PRESETS = [
  "glass", "whisper", "glide2", "fusion", "glide", "terminal",
  "handwritten", "backdrop", "backdrop2",
] as const;

export const VEED_BASIC_PRESETS = [
  "simple", "plain", "beans", "corpo", "boo", "shadeplay", "casper",
  "capri", "lowkey", "vinta", "diego", "ali", "slay", "kitty", "hustle",
  "karl", "sprout", "flex", "mint", "rizz", "vegas",
] as const;

/** Every preset (dynamic first, then basic) — source for the Zod enum. */
export const VEED_SUBTITLE_PRESETS = [
  ...VEED_DYNAMIC_PRESETS,
  ...VEED_BASIC_PRESETS,
] as const;

export type VeedSubtitlePreset = (typeof VEED_SUBTITLE_PRESETS)[number];

/** Default to a BASIC (1x) preset so the node never silently 2x-bills. */
export const VEED_SUBTITLE_DEFAULT_PRESET: VeedSubtitlePreset = "simple";

/** True when `preset` is a dynamic (2x-multiplier) one. Dependency-free so
 *  both the node UI and the cost note can call it. */
export function isVeedDynamicPreset(preset: string): boolean {
  return (VEED_DYNAMIC_PRESETS as readonly string[]).includes(preset);
}

/**
 * SOURCE audio language — improves transcription accuracy. Should match the
 * spoken audio, NOT the output subtitle language. Optional (omit to
 * auto-detect). Full list from the Fal `veed/subtitles` schema.
 */
export const VEED_SUBTITLE_LANGUAGES = [
  "af-ZA", "am-ET", "ar-AE", "ar-BH", "ar-DZ", "ar-EG", "ar-IL", "ar-IQ",
  "ar-JO", "ar-KW", "ar-LB", "ar-MA", "ar-OM", "ar-PS", "ar-QA", "ar-SA",
  "ar-TN", "ast-ES", "az-AZ", "ba", "bas", "be-BY", "bg-BG", "br", "bs-BA",
  "ca-ES", "ceb-PH", "ckb-IQ", "cs-CZ", "cy-GB", "da-DK", "de-DE", "dyu",
  "el-GR", "en-AU", "en-GB", "en-IN", "en-NZ", "en-US", "eo", "es-AR",
  "es-BO", "es-CL", "es-CO", "es-CR", "es-DO", "es-EC", "es-ES", "es-GT",
  "es-HN", "es-MX", "es-NI", "es-PA", "es-PE", "es-PR", "es-PY", "es-SV",
  "es-US", "es-UY", "es-VE", "et-EE", "eu-ES", "fa-IR", "ff", "fi-FI",
  "fil-PH", "fo", "fr-CA", "fr-FR", "fy", "ga", "gd", "gl-ES", "ha-NG",
  "haw", "he-IL", "hr-HR", "hsb", "ht", "hu-HU", "hy-AM", "id-ID", "ig",
  "is-IS", "it-IT", "ja-JP", "ja-Latn-JP", "jv-ID", "ka-GE", "kab",
  "kam-KE", "kea-CV", "kk-KZ", "ko-KR", "ku", "ky-KG", "la", "lb-LU", "lg",
  "lij", "ln-CD", "lo-LA", "lt-LT", "luo-KE", "lv-LV", "mg", "mi-NZ",
  "mk-MK", "mn-MN", "ms-MY", "mt-MT", "nb-NO", "nl-NL", "nn", "nso-ZA",
  "ny-MW", "oc-FR", "pl-PL", "ps-AF", "pt-BR", "pt-PT", "ro-RO", "roh",
  "ru-RU", "rw-RW", "sah", "sk-SK", "sl-SI", "sm", "sn-ZW", "so-SO",
  "sq-AL", "sr-Latn-RS", "sr-RS", "srd", "ss", "su-ID", "sv-SE", "sw-KE",
  "sw-TZ", "tg-TJ", "th-TH", "tk", "tn", "tok", "ton", "tr-TR", "ts-ZA",
  "tt", "uk-UA", "umb-AO", "ur-IN", "ur-PK", "uz-UZ", "vi-VN", "vro",
  "wo-SN", "xh-ZA", "yi", "yo-NG", "yue-Hant-HK", "zh", "zh-HK", "zh-TW",
  "zu-ZA",
] as const;

export type VeedSubtitleLanguage = (typeof VEED_SUBTITLE_LANGUAGES)[number];

/**
 * Translation target language — translate the subtitles INTO this language
 * (+$0.20/min). Omit to keep the original spoken language. A larger list
 * than {@link VEED_SUBTITLE_LANGUAGES}. Full list from the Fal schema.
 */
export const VEED_TRANSLATION_LANGUAGES = [
  "ab", "ace", "ach", "af-ZA", "ak", "alz", "am-ET", "ar-AE", "ar-BH",
  "ar-DZ", "ar-EG", "ar-IL", "ar-IQ", "ar-JO", "ar-KW", "ar-LB", "ar-MA",
  "ar-OM", "ar-PS", "ar-QA", "ar-SA", "ar-TN", "awa", "ay", "az-AZ", "ban",
  "bbc", "be-BY", "bem", "bew", "bg-BG", "bho", "bik", "bm", "bs-BA", "bts",
  "btx", "bua", "ca-ES", "ceb-PH", "cgg", "chm", "ckb-IQ", "cnh", "co",
  "crh", "crs", "cs-CZ", "cv", "cy-GB", "da-DK", "de-DE", "din", "doi",
  "dov", "dv", "dz", "ee", "el-GR", "en-AU", "en-GB", "en-IN", "en-NZ",
  "en-US", "eo", "es-AR", "es-BO", "es-CL", "es-CO", "es-CR", "es-DO",
  "es-EC", "es-ES", "es-GT", "es-HN", "es-MX", "es-NI", "es-PA", "es-PE",
  "es-PR", "es-PY", "es-SV", "es-US", "es-UY", "es-VE", "et-EE", "eu-ES",
  "fa-IR", "ff", "fi-FI", "fil-PH", "fj", "fr-CA", "fr-FR", "fy", "ga",
  "gaa", "gd", "gl-ES", "gn", "gom", "ha-NG", "haw", "he-IL", "hil", "hmn",
  "hr-HR", "hrx", "ht", "hu-HU", "hy-AM", "id-ID", "ig", "ilo", "is-IS",
  "it-IT", "ja-JP", "ja-Latn-JP", "jv-ID", "ka-GE", "kk-KZ", "ko-KR",
  "kri", "ktu", "ku", "ky-KG", "la", "lb-LU", "lg", "li", "lij", "lmo",
  "ln-CD", "lo-LA", "lt-LT", "ltg", "luo-KE", "lus", "lv-LV", "mai", "mak",
  "mg", "mi-NZ", "min", "mk-MK", "mn-MN", "mni-Mtei", "ms-Arab", "ms-MY",
  "mt-MT", "nb-NO", "new", "nl-NL", "nr", "nso-ZA", "nus", "ny-MW", "oc-FR",
  "om", "pag", "pam", "pap", "pl-PL", "ps-AF", "pt-BR", "pt-PT", "qu", "rn",
  "ro-RO", "rom", "ru-RU", "rw-RW", "scn", "sg", "shn", "sk-SK", "sl-SI",
  "sm", "sn-ZW", "so-SO", "sq-AL", "sr-Latn-RS", "sr-RS", "ss", "st",
  "su-ID", "sv-SE", "sw-KE", "sw-TZ", "szl", "tet", "tg-TJ", "th-TH", "ti",
  "tk", "tn", "tr-TR", "ts-ZA", "tt", "ug", "uk-UA", "ur-IN", "ur-PK",
  "uz-UZ", "vi-VN", "xh-ZA", "yi", "yo-NG", "yua", "yue-Hant-HK", "zh",
  "zh-HK", "zh-TW", "zu-ZA",
] as const;

export type VeedTranslationLanguage =
  (typeof VEED_TRANSLATION_LANGUAGES)[number];

export const veedSubtitlesRequestSchema = z
  .object({
    videoUrl: z.string().url(),
    preset: z.enum(VEED_SUBTITLE_PRESETS),
    /** SOURCE audio language (improves transcription). Omit to auto-detect. */
    language: z.enum(VEED_SUBTITLE_LANGUAGES).optional(),
    /** Translate subtitles into this language (+$0.20/min). Omit to keep source. */
    translationLanguage: z.enum(VEED_TRANSLATION_LANGUAGES).optional(),
    // DEFERRED (v1 leaves these out — future work): `srt_file_url` /
    // `srt_content` (import subtitles instead of transcribing), `vocabulary`
    // (brand-name / jargon spelling hints), `customization` (per-tier font /
    // weight / colour + position + shadow overrides). Add when a workflow
    // actually asks for them.
  })
  .strict();

export type VeedSubtitlesRequest = z.infer<typeof veedSubtitlesRequestSchema>;

export interface VeedSubtitlesSuccessResponse {
  videoUrl: string;
  mime?: string;
  model: string;
}

export interface VeedSubtitlesSubmitResponse {
  requestId: string;
  endpoint: string;
}

export const veedSubtitlesStatusRequestSchema = z
  .object({
    endpoint: z.string().min(1),
    requestId: z.string().min(1),
  })
  .strict();

export type VeedSubtitlesStatusRequest = z.infer<
  typeof veedSubtitlesStatusRequestSchema
>;

export type VeedSubtitlesStatusResponse =
  | { status: "pending" }
  | ({ status: "done" } & VeedSubtitlesSuccessResponse);
