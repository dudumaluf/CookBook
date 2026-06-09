import "server-only";

import type { UserContext } from "@/lib/byok/resolver";
import { MissingCredentialsError } from "@/lib/byok/resolver";

import { buildFalClient } from "./client-factory";
import {
  describeFalError,
  type SeedanceStatusResponse,
  type SeedanceSubmitResponse,
  type SeedanceVideoRequest,
} from "./types";

/**
 * Server-only Seedance video wrapper — Slice B (multimodal media arc).
 *
 * Keeps FAL_KEY out of the browser bundle. Dispatches to the right
 * `bytedance/seedance-2.0/*` endpoint based on which references are present.
 * Uses the Fal QUEUE (submit + poll, ADR-0057) rather than the blocking
 * `subscribe`, so a minutes-long render is never tied to one fragile HTTP
 * connection (a network blip / tab backgrounding would drop it mid-render).
 *
 * Endpoint dispatch:
 *   - startImageUrl present        -> image-to-video (literal first frame +
 *     optional end frame; a DISTINCT model — no video/audio refs, caps 720p)
 *   - else any reference video     -> reference-to-video (most capable:
 *     up to 9 images + 3 videos + 3 audios; powers continuity + lipsync)
 *   - else any reference image     -> reference-to-video (image refs +
 *     optional audio; the agency reference-gen path)
 *   - else                         -> text-to-video
 *   The `/fast/` tier is selected per-call via `request.fast`.
 *
 * Errors are annotated with a stable `code` the route maps to an HTTP
 * status, mirroring the Higgsfield wrapper.
 */

type FalErrorCode =
  | "missing_key"
  | "aborted"
  | "upstream_error"
  | "timeout"
  | "unknown";

function annotate(err: Error, code: FalErrorCode): Error {
  (err as Error & { code?: FalErrorCode }).code = code;
  return err;
}

function pickEndpoint(req: SeedanceVideoRequest): string {
  const hasStartImage = Boolean(req.startImageUrl);
  const hasVideo = (req.videoUrls?.length ?? 0) > 0;
  const hasImage = (req.imageUrls?.length ?? 0) > 0;
  const base = hasStartImage
    ? "bytedance/seedance-2.0/image-to-video"
    : hasVideo || hasImage
      ? "bytedance/seedance-2.0/reference-to-video"
      : "bytedance/seedance-2.0/text-to-video";
  return req.fast ? base.replace("seedance-2.0/", "seedance-2.0/fast/") : base;
}

/** Shape Fal's image/reference/text-to-video endpoints accept. */
function buildInput(req: SeedanceVideoRequest): Record<string, unknown> {
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
    // The fast tier AND image-to-video both cap output at 720p (no 1080p) —
    // clamp so a run never 422s mid-pipeline on an unsupported resolution.
    const capsAt720 = req.fast || isImageToVideo;
    input.resolution =
      capsAt720 && req.resolution === "1080p" ? "720p" : req.resolution;
  }
  if (req.generateAudio !== undefined) input.generate_audio = req.generateAudio;
  if (req.seed !== undefined) input.seed = req.seed;
  return input;
}

interface SeedanceRawOutput {
  video?: { url?: string; content_type?: string };
  seed?: number;
}

function isAbort(err: unknown, signal: AbortSignal): boolean {
  return (err as Error)?.name === "AbortError" || signal.aborted;
}

/**
 * Submit a Seedance job to Fal's QUEUE and return its request id + endpoint.
 * Fast (no render wait) — the client then polls `getSeedanceResult`. This is
 * what makes long renders robust: no minutes-long held connection to drop.
 */
export async function submitSeedanceVideo(
  req: SeedanceVideoRequest,
  signal: AbortSignal,
  user?: UserContext,
): Promise<SeedanceSubmitResponse> {
  let __bound;
  try {
    __bound = await buildFalClient(user);
  } catch (err) {
    if (err instanceof MissingCredentialsError) {
      throw annotate(new Error(err.message), "missing_key");
    }
    throw err;
  }
  const { client: fal } = __bound;
  if (signal.aborted) {
    throw annotate(new Error("Request cancelled"), "aborted");
  }
  const endpoint = pickEndpoint(req);
  const input = buildInput(req);
  try {
    const res = await fal.queue.submit(endpoint, { input });
    return { requestId: res.request_id, endpoint };
  } catch (err) {
    if (isAbort(err, signal)) {
      throw annotate(new Error("Request cancelled"), "aborted");
    }
    throw annotate(new Error(`Fal: ${describeFalError(err)}`), "upstream_error");
  }
}

/**
 * Poll a queued job. Returns `{ status: "pending" }` while it's queued /
 * rendering, or the finished video once `COMPLETED`. Throws (annotated) if
 * the job failed upstream.
 */
export async function getSeedanceResult(
  endpoint: string,
  requestId: string,
  signal: AbortSignal,
  user?: UserContext,
): Promise<SeedanceStatusResponse> {
  let __bound;
  try {
    __bound = await buildFalClient(user);
  } catch (err) {
    if (err instanceof MissingCredentialsError) {
      throw annotate(new Error(err.message), "missing_key");
    }
    throw err;
  }
  const { client: fal } = __bound;
  if (signal.aborted) {
    throw annotate(new Error("Request cancelled"), "aborted");
  }
  try {
    const st = await fal.queue.status(endpoint, { requestId, abortSignal: signal });
    if (st.status !== "COMPLETED") return { status: "pending" };
    const result = (await fal.queue.result(endpoint, {
      requestId,
      abortSignal: signal,
    })) as { data: SeedanceRawOutput };
    const url = result.data.video?.url;
    if (!url) {
      throw annotate(
        new Error("Seedance returned no video URL"),
        "upstream_error",
      );
    }
    return {
      status: "done",
      videoUrl: url,
      mime: result.data.video?.content_type ?? "video/mp4",
      seed: result.data.seed,
      model: endpoint,
    };
  } catch (err) {
    if (isAbort(err, signal)) {
      throw annotate(new Error("Request cancelled"), "aborted");
    }
    // Already-annotated errors (e.g. "no video URL") pass through.
    if ((err as { code?: string }).code) throw err;
    throw annotate(new Error(`Fal: ${describeFalError(err)}`), "upstream_error");
  }
}
