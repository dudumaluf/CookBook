import { describe, expect, it } from "vitest";

import {
  buildSeedanceInput,
  pickSeedanceEndpoint,
  resolveSeedanceTier,
} from "@/lib/fal/seedance-endpoint";
import type { SeedanceVideoRequest } from "@/lib/fal/types";

/**
 * Endpoint + input dispatch for the Seedance model tiers (ADR-0078). Pure
 * logic, so we exercise the full matrix directly (no server-only transport).
 */

function req(overrides: Partial<SeedanceVideoRequest> = {}): SeedanceVideoRequest {
  return { prompt: "x", ...overrides } as SeedanceVideoRequest;
}

describe("resolveSeedanceTier", () => {
  it("defaults to standard", () => {
    expect(resolveSeedanceTier(req())).toBe("standard");
  });

  it("reads the explicit model tier", () => {
    expect(resolveSeedanceTier(req({ model: "fast" }))).toBe("fast");
    expect(resolveSeedanceTier(req({ model: "mini" }))).toBe("mini");
  });

  it("falls back to the legacy `fast` boolean when no model is set", () => {
    expect(resolveSeedanceTier(req({ fast: true }))).toBe("fast");
  });

  it("prefers the explicit model over the legacy `fast` flag", () => {
    expect(resolveSeedanceTier(req({ model: "standard", fast: true }))).toBe(
      "standard",
    );
    expect(resolveSeedanceTier(req({ model: "mini", fast: true }))).toBe("mini");
  });
});

describe("pickSeedanceEndpoint — standard tier", () => {
  it("text-to-video when no refs are wired", () => {
    expect(pickSeedanceEndpoint(req())).toBe(
      "bytedance/seedance-2.0/text-to-video",
    );
  });

  it("reference-to-video with image refs", () => {
    expect(pickSeedanceEndpoint(req({ imageUrls: ["https://x/1.png"] }))).toBe(
      "bytedance/seedance-2.0/reference-to-video",
    );
  });

  it("reference-to-video with video refs", () => {
    expect(pickSeedanceEndpoint(req({ videoUrls: ["https://x/1.mp4"] }))).toBe(
      "bytedance/seedance-2.0/reference-to-video",
    );
  });

  it("image-to-video when a start frame is present", () => {
    expect(
      pickSeedanceEndpoint(req({ startImageUrl: "https://x/start.png" })),
    ).toBe("bytedance/seedance-2.0/image-to-video");
  });
});

describe("pickSeedanceEndpoint — fast tier", () => {
  it("prefixes every base with /fast/", () => {
    expect(pickSeedanceEndpoint(req({ model: "fast" }))).toBe(
      "bytedance/seedance-2.0/fast/text-to-video",
    );
    expect(
      pickSeedanceEndpoint(req({ model: "fast", imageUrls: ["https://x/1.png"] })),
    ).toBe("bytedance/seedance-2.0/fast/reference-to-video");
    expect(
      pickSeedanceEndpoint(
        req({ model: "fast", startImageUrl: "https://x/start.png" }),
      ),
    ).toBe("bytedance/seedance-2.0/fast/image-to-video");
  });

  it("works via the legacy `fast` boolean too", () => {
    expect(
      pickSeedanceEndpoint(req({ fast: true, imageUrls: ["https://x/1.png"] })),
    ).toBe("bytedance/seedance-2.0/fast/reference-to-video");
  });
});

describe("pickSeedanceEndpoint — mini tier", () => {
  it("always routes to mini/reference-to-video (image refs)", () => {
    expect(
      pickSeedanceEndpoint(req({ model: "mini", imageUrls: ["https://x/1.png"] })),
    ).toBe("bytedance/seedance-2.0/mini/reference-to-video");
  });

  it("routes prompt-only (no refs) through reference-to-video too", () => {
    // The reference endpoint serves prompt-only jobs (every ref array is
    // optional), so a mini text job never hits a non-existent mini/text route.
    expect(pickSeedanceEndpoint(req({ model: "mini" }))).toBe(
      "bytedance/seedance-2.0/mini/reference-to-video",
    );
  });

  it("routes video refs through reference-to-video", () => {
    expect(
      pickSeedanceEndpoint(req({ model: "mini", videoUrls: ["https://x/1.mp4"] })),
    ).toBe("bytedance/seedance-2.0/mini/reference-to-video");
  });

  it("model:mini overrides a legacy fast flag", () => {
    expect(pickSeedanceEndpoint(req({ model: "mini", fast: true }))).toBe(
      "bytedance/seedance-2.0/mini/reference-to-video",
    );
  });
});

describe("buildSeedanceInput", () => {
  it("reference mode sends the ref arrays, never image_url", () => {
    const input = buildSeedanceInput(
      req({
        imageUrls: ["https://x/1.png"],
        videoUrls: ["https://x/1.mp4"],
        audioUrls: ["https://x/1.mp3"],
      }),
    );
    expect(input.image_urls).toEqual(["https://x/1.png"]);
    expect(input.video_urls).toEqual(["https://x/1.mp4"]);
    expect(input.audio_urls).toEqual(["https://x/1.mp3"]);
    expect(input.image_url).toBeUndefined();
  });

  it("image-to-video sends image_url (+ end_image_url), never the arrays", () => {
    const input = buildSeedanceInput(
      req({
        startImageUrl: "https://x/start.png",
        endImageUrl: "https://x/end.png",
        imageUrls: ["https://x/ignored.png"],
      }),
    );
    expect(input.image_url).toBe("https://x/start.png");
    expect(input.end_image_url).toBe("https://x/end.png");
    expect(input.image_urls).toBeUndefined();
  });

  it("stringifies a numeric duration", () => {
    expect(buildSeedanceInput(req({ duration: 8 })).duration).toBe("8");
    expect(buildSeedanceInput(req({ duration: "auto" })).duration).toBe("auto");
  });

  it("clamps 1080p to 720p on the fast tier", () => {
    expect(
      buildSeedanceInput(req({ model: "fast", resolution: "1080p" })).resolution,
    ).toBe("720p");
  });

  it("clamps 1080p to 720p on the mini tier", () => {
    expect(
      buildSeedanceInput(req({ model: "mini", resolution: "1080p" })).resolution,
    ).toBe("720p");
  });

  it("clamps 1080p to 720p for image-to-video (any tier)", () => {
    expect(
      buildSeedanceInput(
        req({ startImageUrl: "https://x/s.png", resolution: "1080p" }),
      ).resolution,
    ).toBe("720p");
  });

  it("keeps 1080p on the standard reference/text tier", () => {
    expect(
      buildSeedanceInput(req({ resolution: "1080p" })).resolution,
    ).toBe("1080p");
  });

  it("passes generate_audio + seed through", () => {
    const input = buildSeedanceInput(req({ generateAudio: false, seed: 42 }));
    expect(input.generate_audio).toBe(false);
    expect(input.seed).toBe(42);
  });
});
