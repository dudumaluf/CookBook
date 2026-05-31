import { afterEach, describe, expect, it, vi } from "vitest";

import {
  __resetSpawnPositionGetterForTests,
  getSpawnPosition,
  setSpawnPositionGetter,
} from "@/lib/canvas/spawn-position";

describe("spawn-position registry", () => {
  afterEach(() => {
    __resetSpawnPositionGetterForTests();
  });

  it("falls back to a sensible default when no canvas is mounted", () => {
    const pos = getSpawnPosition();
    expect(pos).toEqual({ x: 200, y: 160 });
  });

  it("returns the registered getter's value", () => {
    setSpawnPositionGetter(() => ({ x: 42, y: -7 }));
    expect(getSpawnPosition()).toEqual({ x: 42, y: -7 });
  });

  it("clears the registered getter when set to null", () => {
    setSpawnPositionGetter(() => ({ x: 99, y: 99 }));
    setSpawnPositionGetter(null);
    expect(getSpawnPosition()).toEqual({ x: 200, y: 160 });
  });

  it("falls back when the getter throws (e.g. mid-unmount RF crash)", () => {
    setSpawnPositionGetter(() => {
      throw new Error("boom");
    });
    const pos = getSpawnPosition();
    expect(pos).toEqual({ x: 200, y: 160 });
  });

  it("falls back when the getter returns NaN coords", () => {
    setSpawnPositionGetter(() => ({ x: Number.NaN, y: 0 }));
    expect(getSpawnPosition()).toEqual({ x: 200, y: 160 });
  });

  it("falls back when the getter returns Infinity coords", () => {
    setSpawnPositionGetter(() => ({ x: 0, y: Number.POSITIVE_INFINITY }));
    expect(getSpawnPosition()).toEqual({ x: 200, y: 160 });
  });

  it("re-registering replaces the previous getter (no chain)", () => {
    const first = vi.fn(() => ({ x: 10, y: 10 }));
    const second = vi.fn(() => ({ x: 20, y: 20 }));
    setSpawnPositionGetter(first);
    setSpawnPositionGetter(second);
    expect(getSpawnPosition()).toEqual({ x: 20, y: 20 });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
