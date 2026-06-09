import "server-only";

import type { UserContext } from "@/lib/byok/resolver";
import { MissingCredentialsError } from "@/lib/byok/resolver";

import { buildFalClient } from "./client-factory";
import {
  describeFalError,
  HEYGEN_LIPSYNC_ENDPOINT,
  type HeygenLipsyncRequest,
  type HeygenLipsyncStatusResponse,
  type HeygenLipsyncSubmitResponse,
} from "./types";

/**
 * Server-only HeyGen Lipsync Precision wrapper. Same async-queue pattern as
 * the other Fal nodes — submit returns a request id, the client polls until
 * the dubbed video is ready. FAL_KEY stays server-side.
 *
 * Lipsync is *expensive* and *slow*: $0.10/second of video, jobs measured
 * in minutes. The submit-then-poll flow makes the long render survive tab
 * backgrounding, transient network blips, and the per-node parallel runs
 * change.
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

function buildInput(req: HeygenLipsyncRequest): Record<string, unknown> {
  const input: Record<string, unknown> = {
    video_url: req.videoUrl,
    audio_url: req.audioUrl,
  };
  if (req.title) input.title = req.title;
  if (req.enableCaption !== undefined) input.enable_caption = req.enableCaption;
  if (req.enableDynamicDuration !== undefined)
    input.enable_dynamic_duration = req.enableDynamicDuration;
  if (req.disableMusicTrack !== undefined)
    input.disable_music_track = req.disableMusicTrack;
  if (req.enableSpeechEnhancement !== undefined)
    input.enable_speech_enhancement = req.enableSpeechEnhancement;
  if (req.startTime !== undefined) input.start_time = req.startTime;
  if (req.endTime !== undefined) input.end_time = req.endTime;
  return input;
}

interface HeygenRawFile {
  url?: string;
  content_type?: string;
}

interface HeygenRawOutput {
  video?: HeygenRawFile;
  caption_file?: HeygenRawFile;
}

function isAbort(err: unknown, signal: AbortSignal): boolean {
  return (err as Error)?.name === "AbortError" || signal.aborted;
}

export async function submitHeygenLipsync(
  req: HeygenLipsyncRequest,
  signal: AbortSignal,
  user?: UserContext,
): Promise<HeygenLipsyncSubmitResponse> {
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
    const res = await fal.queue.submit(HEYGEN_LIPSYNC_ENDPOINT as string, {
      input: buildInput(req),
    });
    return { requestId: res.request_id, endpoint: HEYGEN_LIPSYNC_ENDPOINT };
  } catch (err) {
    if (isAbort(err, signal)) {
      throw annotate(new Error("Request cancelled"), "aborted");
    }
    throw annotate(new Error(`Fal: ${describeFalError(err)}`), "upstream_error");
  }
}

export async function getHeygenLipsyncResult(
  endpoint: string,
  requestId: string,
  signal: AbortSignal,
  user?: UserContext,
): Promise<HeygenLipsyncStatusResponse> {
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
    })) as { data: HeygenRawOutput };

    const url = result.data.video?.url;
    if (!url) {
      throw annotate(
        new Error("HeyGen Lipsync returned no video URL"),
        "upstream_error",
      );
    }
    return {
      status: "done",
      videoUrl: url,
      ...(result.data.caption_file?.url
        ? { captionUrl: result.data.caption_file.url }
        : {}),
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
