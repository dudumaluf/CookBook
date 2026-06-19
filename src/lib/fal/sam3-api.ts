import "server-only";

import type { UserContext } from "@/lib/byok/resolver";
import { MissingCredentialsError } from "@/lib/byok/resolver";

import { buildFalClient } from "./client-factory";
import {
  describeFalError,
  SAM3_ENDPOINT,
  type Sam3Request,
  type Sam3SuccessResponse,
} from "./types";

/**
 * Server-only Fal SAM 3 wrapper — promptable image segmentation.
 *
 * Uses `fal.subscribe` (fast inference, ~$0.005/request). FAL_KEY stays
 * server-side.
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

interface FalImagePayload {
  url?: string;
}

interface Sam3RawOutput {
  image?: FalImagePayload;
  masks?: FalImagePayload[];
  scores?: number[];
}

function buildInput(req: Sam3Request): Record<string, unknown> {
  const input: Record<string, unknown> = { image_url: req.imageUrl };
  if (req.prompt !== undefined && req.prompt.length > 0) {
    input.prompt = req.prompt;
  }
  if (req.applyMask !== undefined) input.apply_mask = req.applyMask;
  if (req.returnMultipleMasks !== undefined) {
    input.return_multiple_masks = req.returnMultipleMasks;
  }
  if (req.maxMasks !== undefined) input.max_masks = req.maxMasks;
  if (req.outputFormat) input.output_format = req.outputFormat;
  if (req.includeScores !== undefined) input.include_scores = req.includeScores;
  if (req.includeBoxes !== undefined) input.include_boxes = req.includeBoxes;
  return input;
}

export async function segmentSam3Image(
  req: Sam3Request,
  signal: AbortSignal,
  user?: UserContext,
): Promise<Sam3SuccessResponse> {
  let bound;
  try {
    bound = await buildFalClient(user);
  } catch (err) {
    if (err instanceof MissingCredentialsError) {
      throw annotate(new Error(err.message), "missing_key");
    }
    throw err;
  }
  const { client: fal } = bound;
  if (signal.aborted) throw annotate(new Error("Request cancelled"), "aborted");

  let result: { data: Sam3RawOutput };
  try {
    result = (await fal.subscribe(SAM3_ENDPOINT as string, {
      input: buildInput(req),
      abortSignal: signal,
    })) as { data: Sam3RawOutput };
  } catch (err) {
    if ((err as Error)?.name === "AbortError" || signal.aborted) {
      throw annotate(new Error("Request cancelled"), "aborted");
    }
    throw annotate(new Error(`Fal: ${describeFalError(err)}`), "upstream_error");
  }

  const primaryUrl =
    typeof result.data.image?.url === "string" && result.data.image.url.length > 0
      ? result.data.image.url
      : undefined;
  const maskUrls = (result.data.masks ?? [])
    .map((m) => m?.url)
    .filter((u): u is string => typeof u === "string" && u.length > 0);

  if (!primaryUrl && maskUrls.length === 0) {
    throw annotate(new Error("SAM 3 returned no images"), "upstream_error");
  }

  return {
    primaryUrl,
    maskUrls,
    scores: result.data.scores,
    model: SAM3_ENDPOINT,
  };
}
