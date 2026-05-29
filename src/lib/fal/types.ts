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
  "16:9",
  "9:16",
  "1:1",
  "21:9",
] as const;

export const SEEDANCE_RESOLUTIONS = ["480p", "720p", "1080p"] as const;

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
    /** 4-15s, or "auto" to let the model decide. */
    duration: z
      .union([z.literal("auto"), z.number().int().min(4).max(15)])
      .optional(),
    aspectRatio: z.enum(SEEDANCE_ASPECT_RATIOS).optional(),
    resolution: z.enum(SEEDANCE_RESOLUTIONS).optional(),
    /** Native synchronized audio (default true on Fal; same cost on/off). */
    generateAudio: z.boolean().optional(),
    seed: z.number().int().optional(),
    /** Use the fast tier (lower latency + cost). */
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
    /** flux / seedream. */
    imageSize: z.string().optional(),
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
