import "server-only";

import type { UserContext } from "@/lib/byok/resolver";
import { MissingCredentialsError } from "@/lib/byok/resolver";

import { buildFalClient } from "./client-factory";
import {
  buildGeminiOmniInput,
  pickGeminiOmniEndpoint,
} from "./gemini-omni-input";
import {
  describeFalError,
  type GeminiOmniRequest,
  type GeminiOmniStatusResponse,
  type GeminiOmniSubmitResponse,
} from "./types";

/**
 * Server-only Gemini Omni wrapper — Flash + 1.1 reference-to-video, plus
 * Flash edit. Same async-queue pattern as the other Fal video nodes
 * (submit returns a request id, the client polls until ready, ADR-0057).
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

interface GeminiOmniRawFile {
  url?: string;
  content_type?: string;
}

interface GeminiOmniRawOutput {
  video?: GeminiOmniRawFile;
}

function isAbort(err: unknown, signal: AbortSignal): boolean {
  return (err as Error)?.name === "AbortError" || signal.aborted;
}

export async function submitGeminiOmni(
  req: GeminiOmniRequest,
  signal: AbortSignal,
  user?: UserContext,
): Promise<GeminiOmniSubmitResponse> {
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
  const endpoint = pickGeminiOmniEndpoint(req);
  try {
    const res = await fal.queue.submit(endpoint, {
      input: buildGeminiOmniInput(req),
    });
    return { requestId: res.request_id, endpoint };
  } catch (err) {
    if (isAbort(err, signal)) {
      throw annotate(new Error("Request cancelled"), "aborted");
    }
    throw annotate(new Error(`Fal: ${describeFalError(err)}`), "upstream_error");
  }
}

export async function getGeminiOmniResult(
  endpoint: string,
  requestId: string,
  signal: AbortSignal,
  user?: UserContext,
): Promise<GeminiOmniStatusResponse> {
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
    })) as { data: GeminiOmniRawOutput };

    const url = result.data.video?.url;
    if (!url) {
      throw annotate(
        new Error("Gemini Omni returned no video URL"),
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
