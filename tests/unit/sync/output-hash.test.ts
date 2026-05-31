import { describe, expect, it } from "vitest";

import { hashOutput } from "@/lib/sync/output-hash";
import type { StandardizedOutput } from "@/types/node";

describe("hashOutput — gallery dedup primitive", () => {
  it("hashes text by trimmed content (leading/trailing whitespace ignored)", () => {
    const a: StandardizedOutput = { type: "text", value: "hello world" };
    const b: StandardizedOutput = { type: "text", value: "  hello world\n" };
    expect(hashOutput(a)).toBe(hashOutput(b));
    expect(hashOutput(a)).toBeTypeOf("string");
  });

  it("hashes different text content to different values", () => {
    const a = hashOutput({ type: "text", value: "hello" });
    const b = hashOutput({ type: "text", value: "world" });
    expect(a).not.toBe(b);
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
  });

  it("returns null for empty/whitespace-only text (nothing meaningful to dedup)", () => {
    expect(hashOutput({ type: "text", value: "" })).toBeNull();
    expect(hashOutput({ type: "text", value: "   " })).toBeNull();
    expect(hashOutput({ type: "text", value: "\n\t" })).toBeNull();
  });

  it("hashes media outputs by URL, with type prefix to keep namespaces distinct", () => {
    // Same URL across types must NOT collide — image / video / audio are
    // semantically different content, so hashes are namespaced by type.
    const url = "https://x.test/abc.bin";
    const image = hashOutput({ type: "image", value: { url } });
    const video = hashOutput({ type: "video", value: { url } });
    const audio = hashOutput({ type: "audio", value: { url } });
    expect(image).not.toBe(video);
    expect(video).not.toBe(audio);
    expect(image).not.toBe(audio);
  });

  it("returns the same hash for the same media URL across calls (stable)", () => {
    const url = "https://x.test/abc.png";
    const a = hashOutput({ type: "image", value: { url } });
    const b = hashOutput({ type: "image", value: { url } });
    expect(a).toBe(b);
  });

  it("returns null for media outputs without a URL", () => {
    expect(
      hashOutput({ type: "image", value: { url: "" } as never }),
    ).toBeNull();
    // Defensive: the type system says url is required, but persistence
    // can hand us legacy / partially-populated payloads; null keeps the
    // dedup path conservative instead of crashing.
    expect(
      hashOutput({ type: "video", value: { url: undefined } as never }),
    ).toBeNull();
  });

  it("hashes mesh outputs by URL", () => {
    const url = "https://x.test/model.glb";
    const a = hashOutput({ type: "mesh", value: { url } as never });
    const b = hashOutput({ type: "mesh", value: { url } as never });
    expect(a).toBe(b);
    expect(a).toBeTruthy();
  });

  it("hashes number outputs by stringified value (finite numbers only)", () => {
    expect(hashOutput({ type: "number", value: 42 })).toBe(
      hashOutput({ type: "number", value: 42 }),
    );
    expect(hashOutput({ type: "number", value: 42 })).not.toBe(
      hashOutput({ type: "number", value: 43 }),
    );
    // NaN / Infinity collapse to null — comparing them with === is
    // ill-defined and the gallery doesn't surface number outputs anyway.
    expect(
      hashOutput({ type: "number", value: Number.NaN }),
    ).toBeNull();
    expect(
      hashOutput({ type: "number", value: Number.POSITIVE_INFINITY }),
    ).toBeNull();
  });

  it("hashes soul-id outputs by id string (stable across calls)", () => {
    const a = hashOutput({
      type: "soul-id",
      value: { id: "soul-x" } as never,
    });
    const b = hashOutput({
      type: "soul-id",
      value: { id: "soul-x" } as never,
    });
    expect(a).toBe(b);
    expect(
      hashOutput({ type: "soul-id", value: { id: "soul-y" } as never }),
    ).not.toBe(a);
  });
});
