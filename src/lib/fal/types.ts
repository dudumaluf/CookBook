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
] as const;

export type FalImageModel = (typeof FAL_IMAGE_MODELS)[number];

export const FAL_IMAGE_MODEL_LABELS: Record<FalImageModel, string> = {
  "nano-banana-2": "Nano Banana 2 (Google)",
  "flux-2-pro": "Flux 2 [pro]",
  "seedream-v4.5": "Seedream 4.5 (ByteDance)",
};

export const falImageRequestSchema = z
  .object({
    model: z.enum(FAL_IMAGE_MODELS),
    prompt: z.string().min(1),
    /** When present, switches to the model's edit endpoint. */
    imageUrls: z.array(z.string().url()).max(8).optional(),
    numImages: z.number().int().min(1).max(4).optional(),
    seed: z.number().int().optional(),
  })
  .strict();

export type FalImageRequest = z.infer<typeof falImageRequestSchema>;

export interface FalImageSuccessResponse {
  imageUrls: string[];
  seed?: number;
  model: string;
}
