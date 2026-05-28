import "server-only";

import { fal } from "@fal-ai/client";

import type {
  FalImageModel,
  FalImageRequest,
  FalImageSuccessResponse,
} from "./types";

/**
 * Server-only Fal image wrapper — Slice F (multimodal media arc).
 *
 * One entry point for all the image models we expose; dispatches to the
 * right Fal endpoint by model + whether reference images are present (edit
 * vs text-to-image). Uses `@fal-ai/client` `subscribe` like the Seedance
 * wrapper. FAL_KEY stays server-side.
 *
 * Endpoint ids are best-effort from the Fal catalog (docs/FAL-CATALOG.md);
 * verified during the test phase — easy to correct in one map.
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

const ENDPOINTS: Record<FalImageModel, { gen: string; edit: string }> = {
  "nano-banana-2": {
    gen: "fal-ai/nano-banana-2",
    edit: "fal-ai/nano-banana-2/edit",
  },
  "flux-2-pro": {
    gen: "fal-ai/flux-2-pro",
    edit: "fal-ai/flux-2-pro/edit",
  },
  "seedream-v4.5": {
    gen: "fal-ai/bytedance/seedream/v4.5/text-to-image",
    edit: "fal-ai/bytedance/seedream/v4.5/edit",
  },
};

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

interface FalImageRawOutput {
  images?: Array<{ url?: string }>;
  seed?: number;
}

export async function generateFalImage(
  req: FalImageRequest,
  signal: AbortSignal,
): Promise<FalImageSuccessResponse> {
  ensureConfigured();
  if (signal.aborted) throw annotate(new Error("Request cancelled"), "aborted");

  const isEdit = (req.imageUrls?.length ?? 0) > 0;
  const endpoint = isEdit
    ? ENDPOINTS[req.model].edit
    : ENDPOINTS[req.model].gen;

  const input: Record<string, unknown> = { prompt: req.prompt };
  if (req.imageUrls?.length) input.image_urls = req.imageUrls;
  if (req.numImages !== undefined) input.num_images = req.numImages;
  if (req.seed !== undefined) input.seed = req.seed;

  let result: { data: FalImageRawOutput };
  try {
    result = (await fal.subscribe(endpoint, {
      input,
      abortSignal: signal,
    })) as { data: FalImageRawOutput };
  } catch (err) {
    if ((err as Error)?.name === "AbortError" || signal.aborted) {
      throw annotate(new Error("Request cancelled"), "aborted");
    }
    const message =
      err instanceof Error ? err.message : "Fal image generation failed";
    throw annotate(new Error(`Fal: ${message}`), "upstream_error");
  }

  const urls = (result.data.images ?? [])
    .map((i) => i.url)
    .filter((u): u is string => typeof u === "string" && u.length > 0);
  if (urls.length === 0) {
    throw annotate(new Error("Fal returned no images"), "upstream_error");
  }

  return { imageUrls: urls, seed: result.data.seed, model: endpoint };
}
