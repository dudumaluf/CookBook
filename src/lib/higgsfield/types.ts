import { z } from "zod";

/**
 * Shared request / response types for the Higgsfield Cloud API routes.
 *
 * Mirrors the ADR-0024 shape used by the Fal OpenRouter route — same
 * Zod-schema-as-source-of-truth pattern so server validation and client
 * typing can't drift.
 *
 * Endpoints surfaced here:
 *   - POST /api/higgsfield/image   (Soul 2.0 standard text-to-image)
 *   - GET  /api/higgsfield/soul-ids (list trained Soul ID characters)
 *
 * Both are server-only proxies — the user's HIGGSFIELD_API_KEY +
 * HIGGSFIELD_API_SECRET never reach the browser bundle. See ADR-0029.
 */

/* ------------------------------- Image gen ------------------------------- */

/**
 * Aspect ratios accepted by `higgsfield-ai/soul/v2/standard`. The API
 * snaps unknown values; we mirror its allowlist client-side so the UI
 * never lets the user pick something the server rejects.
 */
export const SOUL_ASPECT_RATIOS = [
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
] as const;
export type SoulAspectRatio = (typeof SOUL_ASPECT_RATIOS)[number];

export const SOUL_RESOLUTIONS = ["720p", "1080p"] as const;
export type SoulResolution = (typeof SOUL_RESOLUTIONS)[number];

export const SOUL_BATCH_SIZES = [1, 4] as const;
export type SoulBatchSize = (typeof SOUL_BATCH_SIZES)[number];

/**
 * Soul mode picked from the node UI based on which inputs are wired:
 *   - `reference` → `image_url` is set (the user wired an image into the
 *     reference handle); style is dropped if present.
 *   - `style`     → `style_id` is set; image is dropped if present.
 *   - `none`      → neither; pure prompt + soul_id.
 *
 * Reference and style are mutually exclusive on Soul 2 standard — passing
 * both confuses the model and (per Prism's empirical notes) the cinema
 * variant 400s on any styleId. The node enforces the switch in the UI;
 * this enum is the contract the server validates.
 */
export const SOUL_MODES = ["reference", "style", "none"] as const;
export type SoulMode = (typeof SOUL_MODES)[number];

export const higgsfieldImageRequestSchema = z
  .object({
    /** Required text prompt. */
    prompt: z.string().min(1, "prompt is required"),
    /**
     * Trained Soul ID character UUID (Higgsfield's `custom_reference_id`).
     * Optional — without it the model renders generically.
     */
    soulId: z.string().uuid().optional(),
    /**
     * Mode + the (mutually-exclusive) reference / style payloads.
     * The route validates that the right field is set for each mode.
     */
    mode: z.enum(SOUL_MODES),
    /** Public URL of a reference image. Required when mode === "reference". */
    referenceUrl: z.string().url().optional(),
    /** Soul Style preset UUID. Required when mode === "style". */
    styleId: z.string().uuid().optional(),
    /** Aspect ratio. Defaults to 1:1 if omitted (server-side). */
    aspectRatio: z.enum(SOUL_ASPECT_RATIOS).optional(),
    /** Output resolution. Defaults to 720p server-side (lower cost). */
    resolution: z.enum(SOUL_RESOLUTIONS).optional(),
    /**
     * Number of images per request. Soul 2 supports 1 or 4 only.
     * Defaults to 1 server-side.
     */
    batchSize: z
      .union([z.literal(1), z.literal(4)])
      .optional(),
    /** Deterministic seed (1..1_000_000). */
    seed: z
      .number()
      .int()
      .min(1)
      .max(1_000_000)
      .optional(),
    /** Optional negative prompt. */
    negativePrompt: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.mode === "reference" && !value.referenceUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["referenceUrl"],
        message: "referenceUrl is required when mode is 'reference'",
      });
    }
    if (value.mode === "style" && !value.styleId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["styleId"],
        message: "styleId is required when mode is 'style'",
      });
    }
    // Cross-field hygiene: don't accept stale fields silently.
    if (value.mode !== "reference" && value.referenceUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["referenceUrl"],
        message: "referenceUrl is only allowed when mode is 'reference'",
      });
    }
    if (value.mode !== "style" && value.styleId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["styleId"],
        message: "styleId is only allowed when mode is 'style'",
      });
    }
  });

export type HiggsfieldImageRequest = z.infer<
  typeof higgsfieldImageRequestSchema
>;

export interface HiggsfieldImageSuccessResponse {
  /** URLs of the generated images, in batch order. */
  imageUrls: string[];
  /** Higgsfield's request id (useful for support / debugging). */
  requestId: string;
  /**
   * Echo the model that ran. Always `higgsfield-ai/soul/v2/standard` for
   * Slice 4; future variants (cinema, character) get their own values.
   */
  model: string;
}

/* ------------------------------- Soul ID list ------------------------------- */

/**
 * The Soul ID characters trained under the API key's account. Mirrored from
 * Higgsfield's `/v1/custom-references/list` response, normalised to camelCase
 * + a stable subset of fields the UI needs.
 */
export interface HiggsfieldSoulIdSummary {
  id: string;
  name: string;
  /** Soul variant — drives which endpoint can use this character. */
  modelVersion: "v1" | "v2" | "cinema";
  /**
   * `not_ready` / `queued` / `in_progress` characters are still training;
   * only `completed` ones can be used in generations.
   */
  status:
    | "not_ready"
    | "queued"
    | "in_progress"
    | "completed"
    | "failed";
  /** Cover thumbnail (first training image, usually). */
  thumbnailUrl: string | null;
  /** ISO timestamp. */
  createdAt: string;
}

export interface HiggsfieldSoulIdListResponse {
  items: HiggsfieldSoulIdSummary[];
}

/* ------------------------------- Errors ------------------------------- */

/**
 * Discriminator the client wrapper uses to decide whether to retry, surface
 * a config UI, or treat the failure as cancellation. Best-effort — not every
 * upstream failure mode gets a distinct code.
 */
export type HiggsfieldErrorCode =
  | "invalid_request"
  | "missing_keys"
  | "upstream_error"
  | "upstream_failed"
  | "nsfw"
  | "aborted"
  | "timeout"
  | "unknown";

export interface HiggsfieldErrorResponse {
  /** Human-readable message. Surfaced verbatim in the inline alert pill. */
  error: string;
  code?: HiggsfieldErrorCode;
}
