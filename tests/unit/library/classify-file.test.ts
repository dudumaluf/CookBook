import { describe, expect, it } from "vitest";

import { classifyDroppedFile } from "@/lib/library/classify-file";

function makeFile(name: string, type: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

describe("classifyDroppedFile", () => {
  it("classifies image MIME prefixes", () => {
    expect(classifyDroppedFile(makeFile("a.png", "image/png"))).toBe("image");
    expect(classifyDroppedFile(makeFile("a.jpg", "image/jpeg"))).toBe("image");
    expect(classifyDroppedFile(makeFile("a.webp", "image/webp"))).toBe("image");
  });

  it("classifies video MIME prefixes", () => {
    expect(classifyDroppedFile(makeFile("clip.mp4", "video/mp4"))).toBe("video");
    expect(classifyDroppedFile(makeFile("clip.webm", "video/webm"))).toBe(
      "video",
    );
    expect(classifyDroppedFile(makeFile("clip.mov", "video/quicktime"))).toBe(
      "video",
    );
  });

  it("classifies audio MIME prefixes", () => {
    expect(classifyDroppedFile(makeFile("song.mp3", "audio/mpeg"))).toBe(
      "audio",
    );
    expect(classifyDroppedFile(makeFile("song.wav", "audio/wav"))).toBe(
      "audio",
    );
    expect(classifyDroppedFile(makeFile("voice.m4a", "audio/mp4"))).toBe(
      "audio",
    );
  });

  it("falls back to extension when MIME is empty (Safari clipboard images, etc.)", () => {
    expect(classifyDroppedFile(makeFile("a.png", ""))).toBe("image");
    expect(classifyDroppedFile(makeFile("a.HEIC", ""))).toBe("image");
    expect(classifyDroppedFile(makeFile("clip.mp4", ""))).toBe("video");
    expect(classifyDroppedFile(makeFile("song.flac", ""))).toBe("audio");
  });

  it("returns 'unsupported' for unknown MIME and unknown extension", () => {
    expect(classifyDroppedFile(makeFile("doc.pdf", "application/pdf"))).toBe(
      "unsupported",
    );
    expect(classifyDroppedFile(makeFile("data.bin", ""))).toBe("unsupported");
    expect(classifyDroppedFile(makeFile("noext", ""))).toBe("unsupported");
  });

  it("MIME wins over extension when both are present", () => {
    expect(classifyDroppedFile(makeFile("clip.png", "video/mp4"))).toBe(
      "video",
    );
  });
});
