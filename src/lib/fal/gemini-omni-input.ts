import {
  GEMINI_OMNI_EDIT_ENDPOINT,
  GEMINI_OMNI_REFERENCE_ENDPOINT,
  GEMINI_OMNI_V11_REFERENCE_ENDPOINT,
  GEMINI_OMNI_VERSION_DEFAULT,
  type GeminiOmniEditRequest,
  type GeminiOmniRequest,
  type GeminiOmniVersion,
} from "./types";

/**
 * Map our camelCase Gemini Omni request to a Fal endpoint + input.
 * Pure — kept out of the server-only wrapper so unit tests can hit it.
 */

export function resolveGeminiOmniVersion(
  req: { version?: GeminiOmniVersion },
): GeminiOmniVersion {
  return req.version ?? GEMINI_OMNI_VERSION_DEFAULT;
}

function isEditRequest(req: GeminiOmniRequest): req is GeminiOmniEditRequest {
  return req.mode === "edit";
}

export function pickGeminiOmniEndpoint(req: GeminiOmniRequest): string {
  if (isEditRequest(req)) return GEMINI_OMNI_EDIT_ENDPOINT;
  return resolveGeminiOmniVersion(req) === "1.1"
    ? GEMINI_OMNI_V11_REFERENCE_ENDPOINT
    : GEMINI_OMNI_REFERENCE_ENDPOINT;
}

export function buildGeminiOmniInput(
  req: GeminiOmniRequest,
): Record<string, unknown> {
  if (isEditRequest(req)) {
    return {
      prompt: req.prompt,
      video_url: req.videoUrl,
    };
  }

  const input: Record<string, unknown> = {
    prompt: req.prompt,
  };
  if (req.imageUrls && req.imageUrls.length > 0) {
    input.image_urls = req.imageUrls;
  }
  if (req.aspectRatio) input.aspect_ratio = req.aspectRatio;
  if (req.duration !== undefined) input.duration = req.duration;

  if (resolveGeminiOmniVersion(req) === "1.1") {
    if (req.videoUrls && req.videoUrls.length > 0) {
      input.reference_video_urls = req.videoUrls;
    }
    if (req.resolution) input.resolution = req.resolution;
  }
  return input;
}
