import { describe, expect, it } from "vitest";

import { remuxTimestamp } from "@/lib/media/concat";

describe("remuxTimestamp", () => {
  it("maps a clip that starts before 0 onto t=0", () => {
    expect(remuxTimestamp(-0.032, 0, -0.032)).toBe(0);
  });

  it("keeps relative timing after the running offset", () => {
    expect(remuxTimestamp(0.1, 5, 0)).toBe(5.1);
  });

  it("starts the next clip at the previous end, even if it also begins before 0", () => {
    expect(remuxTimestamp(-0.032, 4.48, -0.032)).toBe(4.48);
  });

  it("does not require clips to have the same duration", () => {
    expect(remuxTimestamp(0, 3.1, 0)).toBe(3.1);
    expect(remuxTimestamp(12.4, 3.1, 0)).toBe(15.5);
  });
});
