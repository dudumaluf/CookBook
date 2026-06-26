import type { SeedanceModelTier, SeedanceVideoRequest } from "./types";

/**
 * Pure Seedance endpoint + input helpers (ADR-0078).
 *
 * Split out of the server-only `seedance-api.ts` so the dispatch matrix
 * (which `bytedance/seedance-2.0/*` endpoint a request resolves to, and the
 * exact body Fal expects) is unit-testable without the `server-only`
 * `@fal-ai/client` transport. No side effects, no secrets — safe on either
 * side of the wire.
 */

/**
 * Effective model tier for a request: explicit `model` wins; otherwise fall
 * back to the legacy `fast` boolean (older persisted nodes / in-flight
 * payloads). Defaults to "standard".
 */
export function resolveSeedanceTier(req: SeedanceVideoRequest): SeedanceModelTier {
  return req.model ?? (req.fast ? "fast" : "standard");
}

/**
 * Choose the Fal endpoint by tier + which references are present:
 *   - startImage present    -> image-to-video (literal first/(last) frame;
 *     a DISTINCT model — no video/audio refs, caps 720p)
 *   - else any video/image  -> reference-to-video (up to 9 img + 3 vid + 3 aud)
 *   - else                  -> text-to-video
 * Tier prefixes the family: standard = none, fast = `/fast/`, mini = `/mini/`.
 * All three tiers expose image-to-video AND reference-to-video.
 *
 * Mini has NO text-to-video endpoint, but its reference-to-video serves
 * prompt-only jobs too (every ref array is optional), so a prompt-only mini
 * job is routed through reference-to-video rather than a non-existent
 * `mini/text-to-video`. (fast/standard keep their dedicated text-to-video.)
 */
export function pickSeedanceEndpoint(req: SeedanceVideoRequest): string {
  const tier = resolveSeedanceTier(req);
  const hasStartImage = Boolean(req.startImageUrl);
  const hasVideo = (req.videoUrls?.length ?? 0) > 0;
  const hasImage = (req.imageUrls?.length ?? 0) > 0;
  const mode = hasStartImage
    ? "image-to-video"
    : hasVideo || hasImage
      ? "reference-to-video"
      : tier === "mini"
        ? "reference-to-video"
        : "text-to-video";
  return tier === "standard"
    ? `bytedance/seedance-2.0/${mode}`
    : `bytedance/seedance-2.0/${tier}/${mode}`;
}

/** Shape Fal's image/reference/text-to-video endpoints accept. */
export function buildSeedanceInput(
  req: SeedanceVideoRequest,
): Record<string, unknown> {
  const tier = resolveSeedanceTier(req);
  const input: Record<string, unknown> = { prompt: req.prompt };
  const isImageToVideo = Boolean(req.startImageUrl);
  if (isImageToVideo) {
    // image-to-video: literal start (+ optional end) frame. It does NOT
    // accept reference arrays — keep them out so a stray value can't 422.
    input.image_url = req.startImageUrl;
    if (req.endImageUrl) input.end_image_url = req.endImageUrl;
  } else {
    if (req.imageUrls?.length) input.image_urls = req.imageUrls;
    if (req.videoUrls?.length) input.video_urls = req.videoUrls;
    if (req.audioUrls?.length) input.audio_urls = req.audioUrls;
  }
  if (req.duration !== undefined) {
    input.duration =
      typeof req.duration === "number" ? String(req.duration) : req.duration;
  }
  if (req.aspectRatio !== undefined) input.aspect_ratio = req.aspectRatio;
  if (req.resolution !== undefined) {
    // Only the standard tier renders above 720p, and it does so in EVERY mode
    // (text / reference / image-to-video all take 1080p + 4k). The fast + mini
    // tiers cap at 720p — clamp the high resolutions down so a run never 422s
    // mid-pipeline on an unsupported value.
    const capsAt720 = tier !== "standard";
    input.resolution =
      capsAt720 && (req.resolution === "1080p" || req.resolution === "4k")
        ? "720p"
        : req.resolution;
  }
  if (req.generateAudio !== undefined) input.generate_audio = req.generateAudio;
  if (req.seed !== undefined) input.seed = req.seed;
  return input;
}
