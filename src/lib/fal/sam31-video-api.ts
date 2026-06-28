import "server-only";

import type { UserContext } from "@/lib/byok/resolver";
import { MissingCredentialsError } from "@/lib/byok/resolver";

import { buildFalClient } from "./client-factory";
import {
  describeFalError,
  SAM31_VIDEO_ENDPOINT,
  type Sam31VideoRequest,
  type Sam31VideoStatusResponse,
  type Sam31VideoSubmitResponse,
} from "./types";

/**
 * Server-only SAM 3.1 Video wrapper — promptable video segmentation that
 * tracks the prompted object across the clip and renders it as a mask video.
 * Targets `fal-ai/sam-3-1/video` (the RENDERED-video endpoint), NOT its
 * `/video-rle` sibling — see `SAM31_VIDEO_ENDPOINT` for why that one only
 * returns RLE arrays and 502'd our poll.
 *
 * Same async-queue pattern as DWPose: submit returns a request id, the client
 * polls until the mask video is ready. The per-frame segmentation is
 * seconds-to-minutes on longer clips, so the submit-then-poll flow survives
 * tab backgrounding and transient network blips. FAL_KEY stays server-side.
 * Pricing: $0.01 per 16 frames.
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

/**
 * Map our request to Fal's `fal-ai/sam-3-1/video` input shape.
 *
 * **Visual targeting is BOX-only.** We verified against the live endpoint
 * (15 probe calls, 2026-06) that `fal-ai/sam-3-1/video` reliably crashes
 * (`Fal (500): Internal Server Error`) on ANY `point_prompts` — both
 * endpoints (`/video` + `/video-rle`), every id field (`object_id`,
 * `obj_id`), even in-bounds coords — and explicitly rejects a box + points
 * on the same frame ("SAM3.1 does not support point prompts and box prompts
 * on the same frame"). Box prompts and text prompts (alone or together)
 * complete fine. So we forward ONLY `box_prompts` + `prompt`; point prompts
 * are dropped at this boundary so a stray caller can't re-trigger the crash.
 * See ADR-0090.
 *
 * **Box prompts carry an `object_id` (default 1)** — SAM's Object Multiplex
 * tracker groups boxes by object id; the `?? 1` lets a future multi-object UI
 * assign real ids. `frame_index` is NOT a `/video` field (it lives on the
 * `/video-rle` `PointPrompt`/`BoxPrompt`, not the `…Base` shapes `/video`
 * consumes), so we no longer send it.
 */
export function buildInput(req: Sam31VideoRequest): Record<string, unknown> {
  const input: Record<string, unknown> = { video_url: req.videoUrl };
  if (req.prompt !== undefined && req.prompt.length > 0) {
    input.prompt = req.prompt;
  }
  if (req.boxPrompts && req.boxPrompts.length > 0) {
    input.box_prompts = req.boxPrompts.map((b) => ({
      x_min: b.xMin,
      y_min: b.yMin,
      x_max: b.xMax,
      y_max: b.yMax,
      object_id: b.objectId ?? 1,
    }));
  }
  if (req.applyMask !== undefined) input.apply_mask = req.applyMask;
  if (req.detectionThreshold !== undefined) {
    input.detection_threshold = req.detectionThreshold;
  }
  if (req.maxNumObjects !== undefined) {
    input.max_num_objects = req.maxNumObjects;
  }
  return input;
}

/**
 * Pull the output video URL out of SAM 3.1's result. Fal documents the
 * `video` field inconsistently — the OpenAPI schema types it as a `File`
 * object (`{ url, content_type }`) but the docs' example response shows a
 * bare string URL. Handle both (plus a couple of cross-endpoint fallbacks)
 * so a real run doesn't bounce off a shape mismatch.
 */
function extractVideoUrl(data: Record<string, unknown> | undefined): {
  url?: string;
  contentType?: string;
} {
  if (!data) return {};
  const v = data.video;
  if (typeof v === "string") return { url: v };
  if (v && typeof v === "object") {
    const f = v as { url?: string; content_type?: string };
    if (typeof f.url === "string") {
      return { url: f.url, contentType: f.content_type };
    }
  }
  if (typeof data.video_url === "string") return { url: data.video_url };
  if (typeof data.url === "string") return { url: data.url };
  return {};
}

function isAbort(err: unknown, signal: AbortSignal): boolean {
  return (err as Error)?.name === "AbortError" || signal.aborted;
}

/**
 * Wrap a Fal failure with its HTTP status when present so a stuck job is
 * legible: `Fal (500)` = the model crashed (e.g. prompts out of frame
 * bounds), `Fal (422)` = a rejected payload (with field detail from
 * `describeFalError`). Both still map to a 502 at the route.
 */
function upstreamError(err: unknown): Error {
  const status = (err as { status?: number })?.status;
  const prefix = typeof status === "number" ? `Fal (${status})` : "Fal";
  return annotate(new Error(`${prefix}: ${describeFalError(err)}`), "upstream_error");
}

export async function submitSam31Video(
  req: Sam31VideoRequest,
  signal: AbortSignal,
  user?: UserContext,
): Promise<Sam31VideoSubmitResponse> {
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
    const res = await fal.queue.submit(SAM31_VIDEO_ENDPOINT as string, {
      input: buildInput(req),
    });
    return { requestId: res.request_id, endpoint: SAM31_VIDEO_ENDPOINT };
  } catch (err) {
    if (isAbort(err, signal)) {
      throw annotate(new Error("Request cancelled"), "aborted");
    }
    throw upstreamError(err);
  }
}

export async function getSam31VideoResult(
  endpoint: string,
  requestId: string,
  signal: AbortSignal,
  user?: UserContext,
): Promise<Sam31VideoStatusResponse> {
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
    const raw = (await fal.queue.result(endpoint, {
      requestId,
      abortSignal: signal,
    })) as { data?: Record<string, unknown> } & Record<string, unknown>;

    // The fal client normally wraps the payload in `.data`; fall back to the
    // top level in case a future client version returns it unwrapped.
    const data = (raw.data ?? raw) as Record<string, unknown>;
    const { url, contentType } = extractVideoUrl(data);
    if (!url) {
      const keys = data ? Object.keys(data).join(", ") : "none";
      throw annotate(
        new Error(`SAM 3.1 Video returned no video URL (output keys: ${keys})`),
        "upstream_error",
      );
    }
    return {
      status: "done",
      videoUrl: url,
      mime: contentType ?? "video/mp4",
      model: endpoint,
    };
  } catch (err) {
    if (isAbort(err, signal)) {
      throw annotate(new Error("Request cancelled"), "aborted");
    }
    if ((err as { code?: string }).code) throw err;
    throw upstreamError(err);
  }
}
