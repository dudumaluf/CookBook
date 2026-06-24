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
 *
 * Mini ships reference-to-video ONLY for now (image-to-video / first-last comes
 * later). Since that endpoint also serves prompt-only + image/video/audio
 * jobs (every ref array is optional), every NON image-to-video mini job is
 * routed through it. Mini + image-to-video is rejected upstream (the node
 * guards it with a clear message) so we never send an `image_url` body to the
 * reference endpoint.
 */
export function pickSeedanceEndpoint(req: SeedanceVideoRequest): string {
  const tier = resolveSeedanceTier(req);
  if (tier === "mini") {
    return "bytedance/seedance-2.0/mini/reference-to-video";
  }
  const hasStartImage = Boolean(req.startImageUrl);
  const hasVideo = (req.videoUrls?.length ?? 0) > 0;
  const hasImage = (req.imageUrls?.length ?? 0) > 0;
  const base = hasStartImage
    ? "bytedance/seedance-2.0/image-to-video"
    : hasVideo || hasImage
      ? "bytedance/seedance-2.0/reference-to-video"
      : "bytedance/seedance-2.0/text-to-video";
  return tier === "fast"
    ? base.replace("seedance-2.0/", "seedance-2.0/fast/")
    : base;
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
    // The fast + mini tiers AND image-to-video all cap output at 720p (no
    // 1080p) — clamp so a run never 422s mid-pipeline on an unsupported
    // resolution. Only the standard tier's reference/text endpoints take 1080p.
    const capsAt720 = tier !== "standard" || isImageToVideo;
    input.resolution =
      capsAt720 && req.resolution === "1080p" ? "720p" : req.resolution;
  }
  if (req.generateAudio !== undefined) input.generate_audio = req.generateAudio;
  if (req.seed !== undefined) input.seed = req.seed;
  return input;
}
