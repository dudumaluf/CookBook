import { describe, expect, it } from "vitest";

import {
  buildGeminiOmniInput,
  pickGeminiOmniEndpoint,
  resolveGeminiOmniVersion,
} from "@/lib/fal/gemini-omni-input";
import {
  GEMINI_OMNI_EDIT_ENDPOINT,
  GEMINI_OMNI_REFERENCE_ENDPOINT,
  GEMINI_OMNI_V11_REFERENCE_ENDPOINT,
  geminiOmniRequestSchema,
} from "@/lib/fal/types";

describe("resolveGeminiOmniVersion", () => {
  it("defaults to 1.1", () => {
    expect(resolveGeminiOmniVersion({})).toBe("1.1");
  });

  it("honours an explicit Flash pick", () => {
    expect(resolveGeminiOmniVersion({ version: "flash" })).toBe("flash");
  });
});

describe("pickGeminiOmniEndpoint", () => {
  it("routes 1.1 reference to the v1.1 endpoint", () => {
    expect(
      pickGeminiOmniEndpoint({
        prompt: "x",
        imageUrls: ["https://x/a.png"],
        version: "1.1",
      }),
    ).toBe(GEMINI_OMNI_V11_REFERENCE_ENDPOINT);
  });

  it("routes omitted version to the v1.1 endpoint", () => {
    expect(
      pickGeminiOmniEndpoint({
        prompt: "x",
        imageUrls: ["https://x/a.png"],
      }),
    ).toBe(GEMINI_OMNI_V11_REFERENCE_ENDPOINT);
  });

  it("routes Flash reference to the unversioned endpoint", () => {
    expect(
      pickGeminiOmniEndpoint({
        prompt: "x",
        imageUrls: ["https://x/a.png"],
        version: "flash",
      }),
    ).toBe(GEMINI_OMNI_REFERENCE_ENDPOINT);
  });

  it("routes edit to the Flash edit endpoint regardless of version", () => {
    expect(
      pickGeminiOmniEndpoint({
        mode: "edit",
        prompt: "make it anime",
        videoUrl: "https://x/src.mp4",
      }),
    ).toBe(GEMINI_OMNI_EDIT_ENDPOINT);
  });
});

describe("buildGeminiOmniInput", () => {
  it("maps Flash reference to prompt + image_urls (no resolution / video refs)", () => {
    expect(
      buildGeminiOmniInput({
        prompt: "a cat",
        imageUrls: ["https://x/a.png"],
        version: "flash",
        aspectRatio: "9:16",
        duration: 5,
        resolution: "4k",
        videoUrls: ["https://x/clip.mp4"],
      }),
    ).toEqual({
      prompt: "a cat",
      image_urls: ["https://x/a.png"],
      aspect_ratio: "9:16",
      duration: 5,
    });
  });

  it("maps 1.1 reference including resolution + reference_video_urls", () => {
    expect(
      buildGeminiOmniInput({
        prompt: "walk",
        imageUrls: ["https://x/a.png"],
        videoUrls: ["https://x/set.mp4"],
        version: "1.1",
        aspectRatio: "16:9",
        duration: 8,
        resolution: "1080p",
      }),
    ).toEqual({
      prompt: "walk",
      image_urls: ["https://x/a.png"],
      reference_video_urls: ["https://x/set.mp4"],
      aspect_ratio: "16:9",
      duration: 8,
      resolution: "1080p",
    });
  });

  it("omits empty 1.1 image_urls so a video-only job is valid", () => {
    const input = buildGeminiOmniInput({
      prompt: "continue",
      version: "1.1",
      videoUrls: ["https://x/clip.mp4"],
      resolution: "720p",
    });
    expect(input.image_urls).toBeUndefined();
    expect(input.reference_video_urls).toEqual(["https://x/clip.mp4"]);
  });

  it("maps edit to prompt + video_url", () => {
    expect(
      buildGeminiOmniInput({
        mode: "edit",
        prompt: "make it anime",
        videoUrl: "https://x/src.mp4",
      }),
    ).toEqual({
      prompt: "make it anime",
      video_url: "https://x/src.mp4",
    });
  });
});

describe("geminiOmniRequestSchema", () => {
  it("accepts a 1.1 video-only reference payload", () => {
    const parsed = geminiOmniRequestSchema.safeParse({
      version: "1.1",
      prompt: "continue",
      videoUrls: ["https://x/clip.mp4"],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects Flash without images", () => {
    const parsed = geminiOmniRequestSchema.safeParse({
      version: "flash",
      prompt: "x",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects 1.1 with neither images nor videos", () => {
    const parsed = geminiOmniRequestSchema.safeParse({
      version: "1.1",
      prompt: "x",
    });
    expect(parsed.success).toBe(false);
  });
});
