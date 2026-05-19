import { describe, it, expect } from "vitest";

import {
  extractInputByType,
  extractInputArrayByType,
} from "@/lib/engine/extract-input";
import type { StandardizedOutput } from "@/types/node";

describe("extractInputByType", () => {
  const textValue: StandardizedOutput = { type: "text", value: "hello" };
  const imageValue: StandardizedOutput = {
    type: "image",
    value: { url: "x.png" },
  };

  it("returns the value when the type matches", () => {
    expect(
      extractInputByType({ in: textValue }, "in", "text"),
    ).toBe("hello");
  });

  it("returns undefined when the type mismatches", () => {
    expect(
      extractInputByType({ in: imageValue }, "in", "text"),
    ).toBeUndefined();
  });

  it("returns undefined when the handle is missing", () => {
    expect(extractInputByType({}, "in", "text")).toBeUndefined();
  });

  it("unwraps the first item from an array input", () => {
    expect(
      extractInputByType({ in: [textValue, textValue] }, "in", "text"),
    ).toBe("hello");
  });

  it("accepts any type when expected is 'any'", () => {
    expect(
      extractInputByType({ in: imageValue }, "in", "any"),
    ).toEqual({ url: "x.png" });
  });
});

describe("extractInputArrayByType", () => {
  it("normalizes a single value into a 1-element array", () => {
    const v: StandardizedOutput = { type: "text", value: "a" };
    expect(extractInputArrayByType({ in: v }, "in", "text")).toEqual(["a"]);
  });

  it("filters items by type", () => {
    const items: StandardizedOutput[] = [
      { type: "text", value: "a" },
      { type: "image", value: { url: "x.png" } },
      { type: "text", value: "b" },
    ];
    expect(
      extractInputArrayByType({ in: items }, "in", "text"),
    ).toEqual(["a", "b"]);
  });

  it("returns [] when missing", () => {
    expect(extractInputArrayByType({}, "in", "text")).toEqual([]);
  });
});
