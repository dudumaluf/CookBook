import "server-only";

import { fal } from "@fal-ai/client";

import {
  describeFalError,
  FAL_IMAGE_MODEL_CAPS,
  type FalImageModel,
  type FalImageRequest,
  type FalImageSuccessResponse,
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

const ENDPOINTS: Record<FalImageModel, { gen: string; edit?: string }> = {
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
  // Krea has no edit endpoint — wired images steer style, not edits.
  "krea-v2-medium": { gen: "krea/v2/medium/text-to-image" },
  "krea-v2-large": { gen: "krea/v2/large/text-to-image" },
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

  const caps = FAL_IMAGE_MODEL_CAPS[req.model];
  const editEndpoint = ENDPOINTS[req.model].edit;
  const isEdit = !!editEndpoint && (req.imageUrls?.length ?? 0) > 0;
  const endpoint = isEdit ? editEndpoint! : ENDPOINTS[req.model].gen;

  // Map the generic request to each model's actual fields, guarded by caps
  // so a stale value (e.g. a nano aspect ratio left over after switching to
  // flux) is simply dropped rather than rejected by Fal.
  const input: Record<string, unknown> = { prompt: req.prompt };
  if (isEdit && req.imageUrls?.length) input.image_urls = req.imageUrls;
  if (req.numImages !== undefined && caps.numImages) {
    input.num_images = req.numImages;
  }
  if (req.seed !== undefined) input.seed = req.seed;
  if (req.aspectRatio && caps.aspectRatios?.includes(req.aspectRatio)) {
    input.aspect_ratio = req.aspectRatio;
  }
  if (req.imageSize !== undefined && caps.imageSizes) {
    if (typeof req.imageSize === "string") {
      if (caps.imageSizes.includes(req.imageSize)) {
        input.image_size = req.imageSize;
      }
    } else if (
      typeof req.imageSize === "object" &&
      Number.isInteger(req.imageSize.width) &&
      Number.isInteger(req.imageSize.height) &&
      req.imageSize.width > 0 &&
      req.imageSize.height > 0
    ) {
      input.image_size = {
        width: req.imageSize.width,
        height: req.imageSize.height,
      };
    }
  }
  if (req.resolution && caps.resolutions?.includes(req.resolution)) {
    input.resolution = req.resolution;
  }
  if (req.creativity && caps.creativity?.includes(req.creativity)) {
    input.creativity = req.creativity;
  }
  if (caps.styleReferences && req.styleReferences?.length) {
    input.image_style_references = req.styleReferences
      .slice(0, caps.styleReferences.max)
      .map((r) => ({
        image_url: r.imageUrl,
        ...(r.strength !== undefined ? { strength: r.strength } : {}),
      }));
  }

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
    throw annotate(new Error(`Fal: ${describeFalError(err)}`), "upstream_error");
  }

  const urls = (result.data.images ?? [])
    .map((i) => i.url)
    .filter((u): u is string => typeof u === "string" && u.length > 0);
  if (urls.length === 0) {
    throw annotate(new Error("Fal returned no images"), "upstream_error");
  }

  return { imageUrls: urls, seed: result.data.seed, model: endpoint };
}
