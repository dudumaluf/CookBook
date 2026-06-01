import "server-only";

import { fal } from "@fal-ai/client";

import {
  describeFalError,
  SCRIBE_V2_ENDPOINT,
  type ScribeV2Request,
  type ScribeV2StatusResponse,
  type ScribeV2SubmitResponse,
  type ScribeV2WordSegment,
} from "./types";

/**
 * Server-only ElevenLabs Scribe V2 (speech-to-text) wrapper.
 *
 * Uses Fal's queue (submit + poll) so longer audio files aren't tied to a
 * single HTTP connection. FAL_KEY stays server-side; the browser wrapper
 * only sees opaque `requestId` / `endpoint` round-trips.
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

function buildInput(req: ScribeV2Request): Record<string, unknown> {
  const input: Record<string, unknown> = {
    audio_url: req.audioUrl,
  };
  if (req.languageCode) input.language_code = req.languageCode;
  if (req.tagAudioEvents !== undefined) input.tag_audio_events = req.tagAudioEvents;
  if (req.diarize !== undefined) input.diarize = req.diarize;
  if (req.keyterms && req.keyterms.length > 0) input.keyterms = req.keyterms;
  return input;
}

interface ScribeV2RawWord {
  start?: unknown;
  end?: unknown;
  text?: unknown;
  type?: unknown;
  speaker_id?: unknown;
}

interface ScribeV2RawOutput {
  text?: unknown;
  language_code?: unknown;
  language_probability?: unknown;
  words?: unknown;
}

function coerceWords(raw: unknown): ScribeV2WordSegment[] {
  if (!Array.isArray(raw)) return [];
  const out: ScribeV2WordSegment[] = [];
  for (const item of raw as ScribeV2RawWord[]) {
    const start = Number(item?.start);
    const end = Number(item?.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const text = typeof item?.text === "string" ? item.text : "";
    const rawType = item?.type;
    const type: ScribeV2WordSegment["type"] =
      rawType === "spacing" ? "spacing" : "word";
    const segment: ScribeV2WordSegment = { start, end, text, type };
    if (typeof item?.speaker_id === "string" && item.speaker_id.length > 0) {
      segment.speakerId = item.speaker_id;
    }
    out.push(segment);
  }
  return out;
}

/**
 * Reconstruct the transcript from Fal's `words[]` if the top-level `text`
 * field is missing or empty (defensive — Fal usually returns both).
 */
function reconstructText(words: ScribeV2WordSegment[]): string {
  return words.map((w) => w.text).join("");
}

function isAbort(err: unknown, signal: AbortSignal): boolean {
  return (err as Error)?.name === "AbortError" || signal.aborted;
}

export async function submitScribeV2(
  req: ScribeV2Request,
  signal: AbortSignal,
): Promise<ScribeV2SubmitResponse> {
  ensureConfigured();
  if (signal.aborted) {
    throw annotate(new Error("Request cancelled"), "aborted");
  }
  try {
    const res = await fal.queue.submit(SCRIBE_V2_ENDPOINT as string, {
      input: buildInput(req),
    });
    return { requestId: res.request_id, endpoint: SCRIBE_V2_ENDPOINT };
  } catch (err) {
    if (isAbort(err, signal)) {
      throw annotate(new Error("Request cancelled"), "aborted");
    }
    throw annotate(new Error(`Fal: ${describeFalError(err)}`), "upstream_error");
  }
}

export async function getScribeV2Result(
  endpoint: string,
  requestId: string,
  signal: AbortSignal,
): Promise<ScribeV2StatusResponse> {
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
    })) as { data: ScribeV2RawOutput };

    const data = result.data;
    const words = coerceWords(data.words);
    const text =
      typeof data.text === "string" && data.text.length > 0
        ? data.text
        : reconstructText(words);
    const languageCode =
      typeof data.language_code === "string" ? data.language_code : "";
    const languageProbability = Number.isFinite(Number(data.language_probability))
      ? Number(data.language_probability)
      : 0;

    if (!text && words.length === 0) {
      throw annotate(
        new Error("Scribe V2 returned an empty transcript"),
        "upstream_error",
      );
    }

    return {
      status: "done",
      text,
      languageCode,
      languageProbability,
      words,
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
