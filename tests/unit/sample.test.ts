import { describe, it, expect } from "vitest";

describe("sample unit test", () => {
  it("verifies vitest is wired", () => {
    expect(1 + 1).toBe(2);
  });

  it("verifies path alias works at runtime via dynamic import", async () => {
    const mod = await import("@/lib/utils");
    expect(typeof mod.cn).toBe("function");
    expect(mod.cn("a", false && "b", "c")).toBe("a c");
  });
});
