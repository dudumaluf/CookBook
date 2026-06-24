import "server-only";

import type { UserContext } from "@/lib/byok/resolver";
import { MissingCredentialsError } from "@/lib/byok/resolver";

import { buildFalClient } from "./client-factory";
import {
  buildSeedanceInput,
  pickSeedanceEndpoint,
} from "./seedance-endpoint";
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
 * `bytedance/seedance-2.0/*` endpoint based on the model tier + which
 * references are present (see `pickSeedanceEndpoint` in `seedance-endpoint.ts`,
 * ADR-0078). Uses the Fal QUEUE (submit + poll, ADR-0057) rather than the
 * blocking `subscribe`, so a minutes-long render is never tied to one fragile
 * HTTP connection (a network blip / tab backgrounding would drop it mid-render).
 *
 * Model tier (`request.model`, ADR-0078): "standard" | "fast" | "mini".
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
  const endpoint = pickSeedanceEndpoint(req);
  const input = buildSeedanceInput(req);
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
