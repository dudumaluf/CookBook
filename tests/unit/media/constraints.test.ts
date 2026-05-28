import { describe, expect, it } from "vitest";

import {
  clampSeedanceDuration,
  SEEDANCE,
  validateSeedanceRequest,
} from "@/lib/media/constraints";

describe("validateSeedanceRequest", () => {
  it("passes a valid single-image generation", () => {
    expect(
      validateSeedanceRequest({ durationSec: 15, imageCount: 1 }),
    ).toEqual([]);
  });

  it("flags out-of-range duration", () => {
    const v = validateSeedanceRequest({ durationSec: 20 });
    expect(v).toHaveLength(1);
    expect(v[0]?.field).toBe("duration");
  });

  it("flags too-short duration", () => {
    const v = validateSeedanceRequest({ durationSec: 2 });
    expect(v[0]?.field).toBe("duration");
  });

  it("flags too many images", () => {
    const v = validateSeedanceRequest({ imageCount: SEEDANCE.maxImages + 1 });
    expect(v.some((x) => x.field === "images")).toBe(true);
  });

  it("flags too many total references across modalities", () => {
    const v = validateSeedanceRequest({
      imageCount: 9,
      videoCount: 3,
      audioCount: 1,
    });
    expect(v.some((x) => x.field === "total")).toBe(true);
  });

  it("requires a visual reference when audio is provided", () => {
    const v = validateSeedanceRequest({ audioCount: 1 });
    expect(v.some((x) => x.field === "audios")).toBe(true);
  });

  it("allows audio when an image or video accompanies it", () => {
    expect(
      validateSeedanceRequest({ audioCount: 1, imageCount: 1 }),
    ).toEqual([]);
  });
});

describe("clampSeedanceDuration", () => {
  it("clamps above max", () => {
    expect(clampSeedanceDuration(30)).toBe(SEEDANCE.maxDurationSec);
  });
  it("clamps below min", () => {
    expect(clampSeedanceDuration(1)).toBe(SEEDANCE.minDurationSec);
  });
  it("rounds within range", () => {
    expect(clampSeedanceDuration(9.4)).toBe(9);
  });
});
