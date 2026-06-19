import "server-only";

import type { UserContext } from "@/lib/byok/resolver";
import { MissingCredentialsError } from "@/lib/byok/resolver";

import { buildFalClient } from "./client-factory";
import {
  describeFalError,
  VEED_SUBTITLES_ENDPOINT,
  type VeedSubtitlesRequest,
  type VeedSubtitlesStatusResponse,
  type VeedSubtitlesSubmitResponse,
} from "./types";

/**
 * Server-only VEED Subtitles wrapper. Same async-queue pattern as the other
 * Fal nodes — submit returns a request id, the client polls until the
 * subtitled video is ready. FAL_KEY stays server-side.
 *
 * Subtitling is multi-minute on long clips (transcription + styled render),
 * so the submit-then-poll flow makes the render survive tab backgrounding,
 * transient network blips, and the per-node parallel runs change. Pricing:
 * $0.10/min base, 2x for resolutions >1080p, 2x for dynamic presets,
 * +$0.20/min when a translation language is set, min charge 1 min.
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

function buildInput(req: VeedSubtitlesRequest): Record<string, unknown> {
  const input: Record<string, unknown> = {
    video_url: req.videoUrl,
    preset: req.preset,
  };
  if (req.language) input.language = req.language;
  if (req.translationLanguage)
    input.translation_language = req.translationLanguage;
  return input;
}

interface VeedRawFile {
  url?: string;
  content_type?: string;
}

interface VeedRawOutput {
  video?: VeedRawFile;
}

function isAbort(err: unknown, signal: AbortSignal): boolean {
  return (err as Error)?.name === "AbortError" || signal.aborted;
}

export async function submitVeedSubtitles(
  req: VeedSubtitlesRequest,
  signal: AbortSignal,
  user?: UserContext,
): Promise<VeedSubtitlesSubmitResponse> {
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
    const res = await fal.queue.submit(VEED_SUBTITLES_ENDPOINT as string, {
      input: buildInput(req),
    });
    return { requestId: res.request_id, endpoint: VEED_SUBTITLES_ENDPOINT };
  } catch (err) {
    if (isAbort(err, signal)) {
      throw annotate(new Error("Request cancelled"), "aborted");
    }
    throw annotate(new Error(`Fal: ${describeFalError(err)}`), "upstream_error");
  }
}

export async function getVeedSubtitlesResult(
  endpoint: string,
  requestId: string,
  signal: AbortSignal,
  user?: UserContext,
): Promise<VeedSubtitlesStatusResponse> {
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
    })) as { data: VeedRawOutput };

    const url = result.data.video?.url;
    if (!url) {
      throw annotate(
        new Error("VEED Subtitles returned no video URL"),
        "upstream_error",
      );
    }
    return {
      status: "done",
      videoUrl: url,
      ...(result.data.video?.content_type
        ? { mime: result.data.video.content_type }
        : { mime: "video/mp4" }),
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
