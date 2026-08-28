import { describe, expect, it } from "vitest";

import { remuxTimestamp } from "@/lib/media/concat";

describe("remuxTimestamp", () => {
  it("clamps a slightly negative first-packet timestamp to 0", () => {
    expect(remuxTimestamp(-0.032, 0)).toBe(0);
  });

  it("keeps in-timeline packets after the running offset", () => {
    expect(remuxTimestamp(0.1, 5)).toBe(5.1);
  });

  it("does not go negative when a later clip also starts before 0", () => {
    expect(remuxTimestamp(-0.032, 5)).toBe(4.968);
  });
});
