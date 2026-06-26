import { describe, expect, it, vi } from "vitest";

/**
 * `buildInput` maps our SAM 3.1 Video request to Fal's `video-rle` wire shape.
 * The load-bearing assertion here is the **`object_id`** on every interactive
 * prompt: SAM's Object Multiplex tracker groups point/box prompts by object,
 * and omitting it crashed the model mid-run (`Fal (500): Internal Server
 * Error`). We mock the credential/client deps so only the pure mapping runs.
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
  it("tags point prompts with object_id (default 1) + snake_cases the fields", () => {
    const input = buildInput({
      ...base,
      pointPrompts: [
        { x: 100, y: 50, label: 1, frameIndex: 0 },
        { x: 10, y: 20, label: 0, frameIndex: 0 },
      ],
    });
    expect(input.point_prompts).toEqual([
      { x: 100, y: 50, label: 1, object_id: 1, frame_index: 0 },
      { x: 10, y: 20, label: 0, object_id: 1, frame_index: 0 },
    ]);
  });

  it("tags box prompts with object_id (default 1) + snake_cases the fields", () => {
    const input = buildInput({
      ...base,
      boxPrompts: [{ xMin: 10, yMin: 20, xMax: 200, yMax: 180, frameIndex: 0 }],
    });
    expect(input.box_prompts).toEqual([
      { x_min: 10, y_min: 20, x_max: 200, y_max: 180, object_id: 1, frame_index: 0 },
    ]);
  });

  it("groups a box + points onto the SAME object so they refine one mask", () => {
    const input = buildInput({
      ...base,
      pointPrompts: [{ x: 5, y: 5, label: 1 }],
      boxPrompts: [{ xMin: 0, yMin: 0, xMax: 10, yMax: 10 }],
    });
    const pointId = (input.point_prompts as { object_id: number }[])[0]!.object_id;
    const boxId = (input.box_prompts as { object_id: number }[])[0]!.object_id;
    expect(pointId).toBe(1);
    expect(boxId).toBe(1);
  });

  it("honours an explicit objectId when set (future multi-object)", () => {
    const input = buildInput({
      ...base,
      pointPrompts: [{ x: 1, y: 2, objectId: 7 }],
    });
    expect((input.point_prompts as { object_id: number }[])[0]!.object_id).toBe(7);
  });

  it("omits prompt arrays entirely when there are no marks", () => {
    const input = buildInput({ ...base, prompt: "person" });
    expect(input).toEqual({ video_url: "https://x/v.mp4", prompt: "person" });
    expect(input.point_prompts).toBeUndefined();
    expect(input.box_prompts).toBeUndefined();
  });
});
