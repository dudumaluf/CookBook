import "server-only";

import { fal } from "@fal-ai/client";

import {
  AUDIO_ISOLATION_ENDPOINT,
  describeFalError,
  type AudioIsolationRequest,
  type AudioIsolationStatusResponse,
  type AudioIsolationSubmitResponse,
} from "./types";

/**
 * Server-only ElevenLabs audio isolation wrapper (via Fal).
 *
 * Uses Fal's queue (submit + poll) so long files aren't tied to one HTTP
 * connection. FAL_KEY stays server-side.
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

function buildInput(req: AudioIsolationRequest): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  if (req.audioUrl) input.audio_url = req.audioUrl;
  else if (req.videoUrl) input.video_url = req.videoUrl;
  return input;
}

interface AudioIsolationRawOutput {
  audio?: { url?: string; content_type?: string };
}

function isAbort(err: unknown, signal: AbortSignal): boolean {
  return (err as Error)?.name === "AbortError" || signal.aborted;
}

export async function submitAudioIsolation(
  req: AudioIsolationRequest,
  signal: AbortSignal,
): Promise<AudioIsolationSubmitResponse> {
  ensureConfigured();
  if (signal.aborted) {
    throw annotate(new Error("Request cancelled"), "aborted");
  }
  try {
    const res = await fal.queue.submit(AUDIO_ISOLATION_ENDPOINT, {
      input: buildInput(req),
    });
    return { requestId: res.request_id, endpoint: AUDIO_ISOLATION_ENDPOINT };
  } catch (err) {
    if (isAbort(err, signal)) {
      throw annotate(new Error("Request cancelled"), "aborted");
    }
    throw annotate(new Error(`Fal: ${describeFalError(err)}`), "upstream_error");
  }
}

export async function getAudioIsolationResult(
  endpoint: string,
  requestId: string,
  signal: AbortSignal,
): Promise<AudioIsolationStatusResponse> {
  ensureConfigured();
  if (signal.aborted) {
    throw annotate(new Error("Request cancelled"), "aborted");
  }
  try {
    const st = await fal.queue.status(endpoint, { requestId, abortSignal: signal });
    if (st.status !== "COMPLETED") return { status: "pending" };
    const result = (await fal.queue.result(endpoint, {
      requestId,
      abortSignal: signal,
    })) as { data: AudioIsolationRawOutput };
    const url = result.data.audio?.url;
    if (!url) {
      throw annotate(
        new Error("Audio isolation returned no audio URL"),
        "upstream_error",
      );
    }
    return {
      status: "done",
      audioUrl: url,
      mime: result.data.audio?.content_type ?? "audio/mpeg",
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
