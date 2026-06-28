import { describe, expect, it, vi } from "vitest";

/**
 * `buildInput` maps our SAM 3.1 Video request to Fal's `/video` wire shape.
 *
 * Two load-bearing facts, both verified live against the endpoint (ADR-0090):
 *   - **`object_id`** on every box: SAM's Object Multiplex tracker groups
 *     boxes by object id, and the `?? 1` default keeps a single-object track
 *     coherent.
 *   - **Point prompts are dropped.** Fal's SAM 3.1 video 500s on any point
 *     prompt, so the mapper never forwards `point_prompts` — box + text only.
 *     `frame_index` is likewise omitted (not a `/video` field).
 *
 * We mock the credential/client deps so only the pure mapping runs.
 */
vi.mock("@/lib/fal/client-factory", () => ({ buildFalClient: vi.fn() }));
vi.mock("@/lib/byok/resolver", () => ({
  resolveFalCredentials: vi.fn(),
  MissingCredentialsError: class extends Error {},
}));

import { buildInput } from "@/lib/fal/sam31-video-api";
import type { Sam31VideoRequest } from "@/lib/fal/types";

const base: Sam31VideoRequest = { videoUrl: "https://x/v.mp4" };

describe("buildInput — SAM 3.1 Video payload", () => {
  it("tags box prompts with object_id (default 1) + snake_cases the fields (no frame_index)", () => {
    const input = buildInput({
      ...base,
      boxPrompts: [{ xMin: 10, yMin: 20, xMax: 200, yMax: 180 }],
    });
    expect(input.box_prompts).toEqual([
      { x_min: 10, y_min: 20, x_max: 200, y_max: 180, object_id: 1 },
    ]);
  });

  it("never forwards point prompts (Fal SAM 3.1 video 500s on them)", () => {
    const input = buildInput({
      ...base,
      pointPrompts: [{ x: 5, y: 5, label: 1 }],
      boxPrompts: [{ xMin: 0, yMin: 0, xMax: 10, yMax: 10 }],
    });
    expect(input.point_prompts).toBeUndefined();
    expect((input.box_prompts as { object_id: number }[])[0]!.object_id).toBe(1);
  });

  it("honours an explicit box objectId when set (future multi-object)", () => {
    const input = buildInput({
      ...base,
      boxPrompts: [{ xMin: 1, yMin: 2, xMax: 9, yMax: 9, objectId: 7 }],
    });
    expect((input.box_prompts as { object_id: number }[])[0]!.object_id).toBe(7);
  });

  it("omits prompt arrays entirely when there are no marks", () => {
    const input = buildInput({ ...base, prompt: "person" });
    expect(input).toEqual({ video_url: "https://x/v.mp4", prompt: "person" });
    expect(input.point_prompts).toBeUndefined();
    expect(input.box_prompts).toBeUndefined();
  });
});
