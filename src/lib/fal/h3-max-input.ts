import {
  H3_MAX_DURATION_DEFAULT,
  H3_MAX_PROMPT_EXPANSION_DEFAULT,
  H3_MAX_RESOLUTION_DEFAULT,
  type H3MaxRequest,
} from "./types";

/**
 * Map our camelCase request to Fal's `minimax/h3-max/image-to-video` input.
 * Pure — kept out of the server-only wrapper so unit tests can hit it.
 */
export function buildH3MaxInput(req: H3MaxRequest): Record<string, unknown> {
  const input: Record<string, unknown> = {
    prompt: req.prompt,
    image_url: req.imageUrl,
    duration: req.duration ?? H3_MAX_DURATION_DEFAULT,
    resolution: req.resolution ?? H3_MAX_RESOLUTION_DEFAULT,
    prompt_expansion_mode:
      req.promptExpansionMode ?? H3_MAX_PROMPT_EXPANSION_DEFAULT,
    enable_safety_checker: req.enableSafetyChecker ?? true,
  };
  if (req.endImageUrl) input.end_image_url = req.endImageUrl;
  if (req.seed !== undefined) input.seed = req.seed;
  return input;
}
