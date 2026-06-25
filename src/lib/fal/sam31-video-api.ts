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
 * Server-only SAM 3.1 Video RLE wrapper — promptable video segmentation that
 * tracks the prompted object across the clip and renders it as a mask video.
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

function buildInput(req: Sam31VideoRequest): Record<string, unknown> {
  const input: Record<string, unknown> = { video_url: req.videoUrl };
  if (req.prompt !== undefined && req.prompt.length > 0) {
    input.prompt = req.prompt;
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

interface Sam31VideoRawFile {
  url?: string;
  content_type?: string;
}

interface Sam31VideoRawOutput {
  video?: Sam31VideoRawFile;
}

function isAbort(err: unknown, signal: AbortSignal): boolean {
  return (err as Error)?.name === "AbortError" || signal.aborted;
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
    throw annotate(new Error(`Fal: ${describeFalError(err)}`), "upstream_error");
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
    const result = (await fal.queue.result(endpoint, {
      requestId,
      abortSignal: signal,
    })) as { data: Sam31VideoRawOutput };

    const url = result.data.video?.url;
    if (!url) {
      throw annotate(
        new Error("SAM 3.1 Video returned no video URL"),
        "upstream_error",
      );
    }
    return {
      status: "done",
      videoUrl: url,
      mime: result.data.video?.content_type ?? "video/mp4",
      model: endpoint,
    };
  } catch (err) {
    if (isAbort(err, signal)) {
      throw annotate(new Error("Request cancelled"), "aborted");
    }
    if ((err as { code?: string }).code) throw err;
    throw annotate(new Error(`Fal: ${describeFalError(err)}`), "upstream_error");
  }
}
