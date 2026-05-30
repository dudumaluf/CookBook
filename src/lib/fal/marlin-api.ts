import "server-only";

import { fal } from "@fal-ai/client";

import {
  describeFalError,
  MARLIN_ENDPOINT,
  type MarlinEventSegment,
  type MarlinRequest,
  type MarlinStatusResponse,
  type MarlinSubmitResponse,
} from "./types";

/**
 * Server-only Marlin (video VLM) wrapper. Same async-queue pattern as the
 * other Fal nodes — submit returns a request id, the client polls until
 * the caption is ready. FAL_KEY stays server-side.
 *
 * Marlin's response is `{ scene, events, text }`; we pass that through
 * after a defensive shape coercion so missing/empty fields don't crash
 * the downstream node.
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

function buildInput(req: MarlinRequest): Record<string, unknown> {
  const input: Record<string, unknown> = {
    video_url: req.videoUrl,
    prompt: req.prompt,
  };
  if (req.maxTokens !== undefined) input.max_tokens = req.maxTokens;
  if (req.doSample !== undefined) input.do_sample = req.doSample;
  if (req.temperature !== undefined) input.temperature = req.temperature;
  if (req.topP !== undefined) input.top_p = req.topP;
  return input;
}

interface MarlinRawEvent {
  start?: unknown;
  end?: unknown;
  text?: unknown;
}

interface MarlinRawOutput {
  scene?: unknown;
  events?: unknown;
  text?: unknown;
}

function coerceEvents(raw: unknown): MarlinEventSegment[] {
  if (!Array.isArray(raw)) return [];
  const out: MarlinEventSegment[] = [];
  for (const item of raw as MarlinRawEvent[]) {
    const start = Number(item?.start);
    const end = Number(item?.end);
    const text = typeof item?.text === "string" ? item.text : "";
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    out.push({ start, end, text });
  }
  return out;
}

function isAbort(err: unknown, signal: AbortSignal): boolean {
  return (err as Error)?.name === "AbortError" || signal.aborted;
}

export async function submitMarlin(
  req: MarlinRequest,
  signal: AbortSignal,
): Promise<MarlinSubmitResponse> {
  ensureConfigured();
  if (signal.aborted) {
    throw annotate(new Error("Request cancelled"), "aborted");
  }
  try {
    const res = await fal.queue.submit(MARLIN_ENDPOINT as string, {
      input: buildInput(req),
    });
    return { requestId: res.request_id, endpoint: MARLIN_ENDPOINT };
  } catch (err) {
    if (isAbort(err, signal)) {
      throw annotate(new Error("Request cancelled"), "aborted");
    }
    throw annotate(new Error(`Fal: ${describeFalError(err)}`), "upstream_error");
  }
}

export async function getMarlinResult(
  endpoint: string,
  requestId: string,
  signal: AbortSignal,
): Promise<MarlinStatusResponse> {
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
    })) as { data: MarlinRawOutput };

    const data = result.data;
    const text = typeof data.text === "string" ? data.text : "";
    const scene = typeof data.scene === "string" ? data.scene : "";
    const events = coerceEvents(data.events);

    if (!text && !scene && events.length === 0) {
      throw annotate(
        new Error("Marlin returned an empty caption"),
        "upstream_error",
      );
    }

    return {
      status: "done",
      scene,
      events,
      text,
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
