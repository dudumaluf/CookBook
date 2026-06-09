import "server-only";

import type { UserContext } from "@/lib/byok/resolver";
import { MissingCredentialsError } from "@/lib/byok/resolver";

import { buildFalClient } from "./client-factory";
import {
  describeFalError,
  HUNYUAN3D_ENDPOINT,
  type Hunyuan3dRequest,
  type Hunyuan3dStatusResponse,
  type Hunyuan3dSubmitResponse,
} from "./types";

/**
 * Server-only Hunyuan 3D Pro image-to-3D wrapper (via Fal).
 *
 * Same async-queue pattern as Seedance / Audio Isolation: SUBMIT returns a
 * request id and the client polls until the GLB is ready. FAL_KEY stays
 * server-side. The model can take a few minutes (face count + PBR + multi-
 * view all push render time up) — the queue+poll flow makes that survive
 * tab backgrounding / network blips.
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

function buildInput(req: Hunyuan3dRequest): Record<string, unknown> {
  const input: Record<string, unknown> = {
    input_image_url: req.inputImageUrl,
  };
  if (req.backImageUrl) input.back_image_url = req.backImageUrl;
  if (req.leftImageUrl) input.left_image_url = req.leftImageUrl;
  if (req.rightImageUrl) input.right_image_url = req.rightImageUrl;
  if (req.topImageUrl) input.top_image_url = req.topImageUrl;
  if (req.bottomImageUrl) input.bottom_image_url = req.bottomImageUrl;
  if (req.leftFrontImageUrl) input.left_front_image_url = req.leftFrontImageUrl;
  if (req.rightFrontImageUrl) input.right_front_image_url = req.rightFrontImageUrl;
  if (req.generateType) input.generate_type = req.generateType;
  if (req.enablePbr !== undefined) input.enable_pbr = req.enablePbr;
  if (req.faceCount !== undefined) input.face_count = req.faceCount;
  return input;
}

interface Hunyuan3dRawFile {
  url?: string;
  content_type?: string;
  file_size?: number;
}

interface Hunyuan3dRawOutput {
  model_glb?: Hunyuan3dRawFile;
  thumbnail?: Hunyuan3dRawFile;
  model_urls?: { glb?: Hunyuan3dRawFile; obj?: Hunyuan3dRawFile };
  seed?: number;
}

function isAbort(err: unknown, signal: AbortSignal): boolean {
  return (err as Error)?.name === "AbortError" || signal.aborted;
}

export async function submitHunyuan3d(
  req: Hunyuan3dRequest,
  signal: AbortSignal,
  user?: UserContext,
): Promise<Hunyuan3dSubmitResponse> {
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
    const res = await fal.queue.submit(HUNYUAN3D_ENDPOINT as string, {
      input: buildInput(req),
    });
    return { requestId: res.request_id, endpoint: HUNYUAN3D_ENDPOINT };
  } catch (err) {
    if (isAbort(err, signal)) {
      throw annotate(new Error("Request cancelled"), "aborted");
    }
    throw annotate(new Error(`Fal: ${describeFalError(err)}`), "upstream_error");
  }
}

export async function getHunyuan3dResult(
  endpoint: string,
  requestId: string,
  signal: AbortSignal,
  user?: UserContext,
): Promise<Hunyuan3dStatusResponse> {
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
    })) as { data: Hunyuan3dRawOutput };

    const glb = result.data.model_glb ?? result.data.model_urls?.glb;
    const url = glb?.url;
    if (!url) {
      throw annotate(
        new Error("Hunyuan 3D returned no GLB URL"),
        "upstream_error",
      );
    }
    const obj = result.data.model_urls?.obj;
    return {
      status: "done",
      glbUrl: url,
      ...(obj?.url ? { objUrl: obj.url } : {}),
      ...(result.data.thumbnail?.url
        ? { thumbnailUrl: result.data.thumbnail.url }
        : {}),
      ...(typeof glb?.file_size === "number"
        ? { sizeBytes: glb.file_size }
        : {}),
      ...(result.data.seed !== undefined ? { seed: result.data.seed } : {}),
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
