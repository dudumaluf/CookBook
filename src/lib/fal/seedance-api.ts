import "server-only";

import { fal } from "@fal-ai/client";

import {
  describeFalError,
  type SeedanceVideoRequest,
  type SeedanceVideoSuccessResponse,
} from "./types";

/**
 * Server-only Seedance video wrapper — Slice B (multimodal media arc).
 *
 * Keeps FAL_KEY out of the browser bundle. Dispatches to the right
 * `bytedance/seedance-2.0/*` endpoint based on which references are present,
 * and uses `@fal-ai/client`'s `subscribe` to handle queue submission +
 * polling natively (no hand-rolled poll loop — the difference from the
 * Higgsfield wrapper, which predates our use of the Fal client).
 *
 * Endpoint dispatch:
 *   - any reference video present  -> reference-to-video (most capable:
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

let configured = false;
function ensureConfigured(): void {
  const key = process.env.FAL_KEY?.trim();
  if (!key) {
    throw annotate(
      new Error(
        "FAL_KEY missing from server env. Set it in .env.local — see .env.example.",
      ),
      "missing_key",
    );
  }
  if (!configured) {
    fal.config({ credentials: key });
    configured = true;
  }
}

function pickEndpoint(req: SeedanceVideoRequest): string {
  const hasVideo = (req.videoUrls?.length ?? 0) > 0;
  const hasImage = (req.imageUrls?.length ?? 0) > 0;
  const base =
    hasVideo || hasImage
      ? "bytedance/seedance-2.0/reference-to-video"
      : "bytedance/seedance-2.0/text-to-video";
  return req.fast ? base.replace("seedance-2.0/", "seedance-2.0/fast/") : base;
}

/** Shape Fal's reference/text-to-video endpoints accept. */
function buildInput(req: SeedanceVideoRequest): Record<string, unknown> {
  const input: Record<string, unknown> = { prompt: req.prompt };
  if (req.imageUrls?.length) input.image_urls = req.imageUrls;
  if (req.videoUrls?.length) input.video_urls = req.videoUrls;
  if (req.audioUrls?.length) input.audio_urls = req.audioUrls;
  if (req.duration !== undefined) {
    input.duration =
      typeof req.duration === "number" ? String(req.duration) : req.duration;
  }
  if (req.aspectRatio !== undefined) input.aspect_ratio = req.aspectRatio;
  if (req.resolution !== undefined) {
    // The fast tier caps output at 720p (no 1080p) — clamp so a fast run
    // never 422s mid-pipeline on an unsupported resolution.
    input.resolution =
      req.fast && req.resolution === "1080p" ? "720p" : req.resolution;
  }
  if (req.generateAudio !== undefined) input.generate_audio = req.generateAudio;
  if (req.seed !== undefined) input.seed = req.seed;
  return input;
}

interface SeedanceRawOutput {
  video?: { url?: string; content_type?: string };
  seed?: number;
}

export async function generateSeedanceVideo(
  req: SeedanceVideoRequest,
  signal: AbortSignal,
): Promise<SeedanceVideoSuccessResponse> {
  ensureConfigured();
  if (signal.aborted) {
    throw annotate(new Error("Request cancelled"), "aborted");
  }

  const endpoint = pickEndpoint(req);
  const input = buildInput(req);

  let result: { data: SeedanceRawOutput };
  try {
    result = (await fal.subscribe(endpoint, {
      input,
      abortSignal: signal,
    })) as { data: SeedanceRawOutput };
  } catch (err) {
    if ((err as Error)?.name === "AbortError" || signal.aborted) {
      throw annotate(new Error("Request cancelled"), "aborted");
    }
    // Surface Fal's validation detail (which field is unprocessable).
    throw annotate(new Error(`Fal: ${describeFalError(err)}`), "upstream_error");
  }

  const url = result.data.video?.url;
  if (!url) {
    throw annotate(
      new Error("Seedance returned no video URL"),
      "upstream_error",
    );
  }

  return {
    videoUrl: url,
    mime: result.data.video?.content_type ?? "video/mp4",
    seed: result.data.seed,
    model: endpoint,
  };
}
