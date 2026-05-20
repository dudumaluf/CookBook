import { describe, it, expect } from "vitest";

import { hashString, stableStringify } from "@/lib/engine/hash";

describe("hashString", () => {
  it("is deterministic for the same input", () => {
    expect(hashString("hello world")).toBe(hashString("hello world"));
  });

  it("produces different hashes for different inputs", () => {
    expect(hashString("a")).not.toBe(hashString("b"));
  });

  it("returns a 16-char hex string", () => {
    const h = hashString("anything");
    expect(h).toHaveLength(16);
    expect(/^[0-9a-f]{16}$/.test(h)).toBe(true);
  });
});

describe("stableStringify", () => {
  it("produces identical strings for objects with reordered keys", () => {
    const a = { x: 1, y: 2, z: 3 };
    const b = { z: 3, y: 2, x: 1 };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it("sorts nested object keys recursively", () => {
    const a = { outer: { x: 1, y: 2 } };
    const b = { outer: { y: 2, x: 1 } };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it("preserves array order (semantically significant)", () => {
    expect(stableStringify([1, 2, 3])).not.toBe(stableStringify([3, 2, 1]));
  });

  it("handles null, primitives, and nested arrays", () => {
    expect(stableStringify(null)).toBe("null");
    expect(stableStringify(42)).toBe("42");
    expect(stableStringify("foo")).toBe('"foo"');
    expect(stableStringify([{ a: 1, b: 2 }])).toBe(
      stableStringify([{ b: 2, a: 1 }]),
    );
  });
});
