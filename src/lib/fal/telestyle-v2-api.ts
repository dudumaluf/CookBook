import "server-only";

import type { UserContext } from "@/lib/byok/resolver";
import { MissingCredentialsError } from "@/lib/byok/resolver";

import { buildFalClient } from "./client-factory";
import {
  describeFalError,
  TELESTYLE_V2_ENDPOINT,
  type TelestyleV2Request,
  type TelestyleV2SuccessResponse,
} from "./types";

/**
 * Server-only TeleStyle V2 wrapper — style transfer (content image + style
 * reference → restyled image) on Qwen-Image-Edit-2509.
 *
 * Uses `fal.subscribe` (fast 4-step Lightning inference, same shape as SAM 3).
 * FAL_KEY stays server-side. The prompt is derived from the two images by a
 * VLM — there is no prompt input.
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

function buildInput(req: TelestyleV2Request): Record<string, unknown> {
  const input: Record<string, unknown> = {
    content_image_url: req.contentImageUrl,
    style_image_url: req.styleImageUrl,
  };
  if (req.loraScale !== undefined) input.lora_scale = req.loraScale;
  if (req.outputFormat) input.output_format = req.outputFormat;
  return input;
}

interface TelestyleV2RawImage {
  url?: string;
  content_type?: string;
}

interface TelestyleV2RawOutput {
  images?: TelestyleV2RawImage[];
  prompt?: string;
  seed?: number;
}

export async function restyleTelestyleV2(
  req: TelestyleV2Request,
  signal: AbortSignal,
  user?: UserContext,
): Promise<TelestyleV2SuccessResponse> {
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

  let result: { data: TelestyleV2RawOutput };
  try {
    result = (await fal.subscribe(TELESTYLE_V2_ENDPOINT as string, {
      input: buildInput(req),
      abortSignal: signal,
    })) as { data: TelestyleV2RawOutput };
  } catch (err) {
    if ((err as Error)?.name === "AbortError" || signal.aborted) {
      throw annotate(new Error("Request cancelled"), "aborted");
    }
    throw annotate(new Error(`Fal: ${describeFalError(err)}`), "upstream_error");
  }

  const first = result.data.images?.[0];
  const url =
    typeof first?.url === "string" && first.url.length > 0
      ? first.url
      : undefined;
  if (!url) {
    throw annotate(new Error("TeleStyle V2 returned no image"), "upstream_error");
  }

  return {
    imageUrl: url,
    mime: first?.content_type ?? "image/png",
    prompt: result.data.prompt,
    seed: result.data.seed,
    model: TELESTYLE_V2_ENDPOINT,
  };
}
