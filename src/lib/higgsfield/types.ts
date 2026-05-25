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

/**
 * Soul variant of the wired character. Drives endpoint dispatch:
 *   v2     → /higgsfield-ai/soul/v2/standard (the official Soul 2 model)
 *   cinema → /higgsfield-ai/soul/cinema (no style catalogue)
 *   v1     → /higgsfield-ai/soul/character (legacy character mode)
 *   none   → /higgsfield-ai/soul/v2/standard (generic v2 render, no character)
 *
 * Per ADR-0029, mismatch (v2-trained char on /soul/cinema) silently degrades
 * to a generic person — so the node MUST coerce the endpoint to the wired
 * character's variant. The `variant` field on the request shape is what the
 * client sends; the server wrapper picks the URL from this discriminator.
 */
export const SOUL_VARIANTS = ["v2", "v1", "cinema", "none"] as const;
export type SoulVariant = (typeof SOUL_VARIANTS)[number];

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
     * Soul variant to dispatch to. Required because the same UUID can only
     * be honoured on one endpoint (v2-trained char → /soul/v2/standard,
     * cinema-trained → /soul/cinema, v1-trained → /soul/character).
     * Send "none" when no Soul ID is wired (the request renders generically
     * via /soul/v2/standard).
     */
    variant: z.enum(SOUL_VARIANTS),
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
    /**
     * Tell Higgsfield to internally expand the prompt for richer
     * conditioning. Empirically required for style presets to render
     * with the same intensity as the official UI does — without it,
     * "Retro BW" + a short prompt comes back colorful, defeating the
     * preset (Slice post-5.6.2 fix).
     *
     * Field is **undocumented** in the public REST docs but accepted
     * by the endpoint and used by the official Web UI. We default to
     * `true` server-side; pass `false` to keep the prompt verbatim
     * (rare — only useful when the caller has its own prompt
     * expansion / curation pipeline).
     */
    enhancePrompt: z.boolean().optional(),
    /**
     * Modulates how strongly the style preset (`styleId`) influences
     * the render, on a 0..1 scale. 1 = bold stylization, 0.5 = subtle.
     * Only meaningful when `mode === "style"`. We default to `1.0`.
     *
     * Undocumented but accepted by the endpoint (see ADR-0029
     * amendment). Mirrors the third-party Segmind doc which
     * documents the same semantics.
     */
    styleStrength: z.number().min(0).max(1).optional(),
    /**
     * Modulates how strongly the Soul ID (`soulId →
     * custom_reference_id`) preserves the trained likeness, on a
     * 0..1 scale. 1 = maximum likeness fidelity. Lower values let the
     * style/scene blend more naturally into the face — useful when
     * the chosen `styleId` is highly stylized (e.g. illustration,
     * heavy filter). We default to `1.0` (likeness wins).
     *
     * Undocumented but accepted by the endpoint.
     */
    customReferenceStrength: z.number().min(0).max(1).optional(),
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
   * Echo the actual endpoint that ran (`higgsfield-ai/soul/v2/standard`,
   * `higgsfield-ai/soul/cinema`, or `higgsfield-ai/soul/character`). The
   * Queue panel surfaces this so the user can spot variant-coercion at a
   * glance.
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

/* ------------------------------- Soul Style ------------------------------- */

/**
 * One Soul Style preset (Slice 5.3). The Higgsfield catalogue at
 * `/v1/text2image/soul-styles/v2` exposes 33 curated v2-photo presets
 * (e.g. "Flash editorial", "Digital camera", "Editorial street style").
 *
 * Used by the HiggsfieldImageGen settings popover's style picker —
 * replaces the raw-UUID input that shipped in Slice 4.3.
 *
 * Fields mirror the upstream snake_case payload normalised to our usual
 * camelCase. `description` is often empty in the wild but kept on the
 * shape so future captioning lands without a schema bump.
 */
export interface HiggsfieldSoulStyle {
  id: string;
  name: string;
  description: string;
  previewUrl: string;
}

export interface HiggsfieldSoulStylesResponse {
  items: HiggsfieldSoulStyle[];
}

/* ------------------------------- Errors ------------------------------- */

/**
 * Discriminator the client wrapper uses to decide whether to retry, surface
 * a config UI, or treat the failure as cancellation. Best-effort — not every
 * upstream failure mode gets a distinct code.
 *
 * `concurrent_limit` is empirically observable: Higgsfield caps concurrent
 * requests per keypair at 4, returning a 400 with
 * `{"detail":"Maximum number of concurrent requests (4) has been reached"}`.
 * The UI should hint "wait for an in-flight job to finish" rather than
 * dumping the raw upstream message into the alert pill.
 */
export type HiggsfieldErrorCode =
  | "invalid_request"
  | "missing_keys"
  | "upstream_error"
  | "upstream_failed"
  | "nsfw"
  | "aborted"
  | "timeout"
  | "concurrent_limit"
  | "unknown";

export interface HiggsfieldErrorResponse {
  /** Human-readable message. Surfaced verbatim in the inline alert pill. */
  error: string;
  code?: HiggsfieldErrorCode;
}
