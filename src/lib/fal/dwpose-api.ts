import "server-only";

import type { UserContext } from "@/lib/byok/resolver";
import { MissingCredentialsError } from "@/lib/byok/resolver";

import { buildFalClient } from "./client-factory";
import {
  describeFalError,
  DWPOSE_ENDPOINT,
  type DwposeRequest,
  type DwposeStatusResponse,
  type DwposeSubmitResponse,
} from "./types";

/**
 * Server-only DWPose wrapper. Same async-queue pattern as the other Fal
 * nodes — submit returns a request id, the client polls until the
 * pose-annotated video is ready. FAL_KEY stays server-side.
 *
 * DWPose runs the whole clip frame-by-frame, so it is seconds-to-minutes on
 * longer / higher-resolution videos; the submit-then-poll flow makes the
 * render survive tab backgrounding and transient network blips. Pricing:
 * $0.0006 per compute second.
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

function buildInput(req: DwposeRequest): Record<string, unknown> {
  const input: Record<string, unknown> = { video_url: req.videoUrl };
  if (req.drawMode) input.draw_mode = req.drawMode;
  return input;
}

interface DwposeRawFile {
  url?: string;
  content_type?: string;
}

interface DwposeRawOutput {
  video?: DwposeRawFile;
}

function isAbort(err: unknown, signal: AbortSignal): boolean {
  return (err as Error)?.name === "AbortError" || signal.aborted;
}

export async function submitDwpose(
  req: DwposeRequest,
  signal: AbortSignal,
  user?: UserContext,
): Promise<DwposeSubmitResponse> {
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
    const res = await fal.queue.submit(DWPOSE_ENDPOINT as string, {
      input: buildInput(req),
    });
    return { requestId: res.request_id, endpoint: DWPOSE_ENDPOINT };
  } catch (err) {
    if (isAbort(err, signal)) {
      throw annotate(new Error("Request cancelled"), "aborted");
    }
    throw annotate(new Error(`Fal: ${describeFalError(err)}`), "upstream_error");
  }
}

export async function getDwposeResult(
  endpoint: string,
  requestId: string,
  signal: AbortSignal,
  user?: UserContext,
): Promise<DwposeStatusResponse> {
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
    })) as { data: DwposeRawOutput };

    const url = result.data.video?.url;
    if (!url) {
      throw annotate(new Error("DWPose returned no video URL"), "upstream_error");
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
