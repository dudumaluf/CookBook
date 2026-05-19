import { describe, it, expect } from "vitest";

describe("sample integration test (stub)", () => {
  it("placeholder \u2014 will be replaced by Repository/SQLite tests in M0a", () => {
    const fakeRepo = {
      list: async () => [],
      get: async (id: string) => ({ id, name: "stub" }),
    };
    expect(fakeRepo).toBeDefined();
  });
});
