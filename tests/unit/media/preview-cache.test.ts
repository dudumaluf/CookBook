import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetPreviewRenderCache,
  commitDurableRender,
  isBlobUrl,
  renderPreview,
} from "@/lib/media/preview-cache";

/* Stub the object-URL API so renderPreview takes its blob branch (and we can
 * assert on revocation) regardless of the test environment. */
let counter = 0;
const createObjectURL = vi.fn(() => `blob:mock-${++counter}`);
const revokeObjectURL = vi.fn();
const urlAny = URL as unknown as Record<string, unknown>;
const origCreate = urlAny.createObjectURL;
const origRevoke = urlAny.revokeObjectURL;

beforeEach(() => {
  counter = 0;
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  urlAny.createObjectURL = createObjectURL;
  urlAny.revokeObjectURL = revokeObjectURL;
  _resetPreviewRenderCache();
});

afterAll(() => {
  urlAny.createObjectURL = origCreate;
  urlAny.revokeObjectURL = origRevoke;
});

const blob = () => new Blob(["x"], { type: "image/png" });

describe("isBlobUrl", () => {
  it("matches only blob: URLs", () => {
    expect(isBlobUrl("blob:xyz")).toBe(true);
    expect(isBlobUrl("https://cdn/x.png")).toBe(false);
    expect(isBlobUrl(undefined)).toBe(false);
    expect(isBlobUrl(null)).toBe(false);
  });
});

describe("renderPreview memo", () => {
  it("encodes once per key and reuses the same URL on an unchanged key", async () => {
    const make = vi.fn(async () => blob());

    const a1 = await renderPreview("n1", "k1", make);
    const a2 = await renderPreview("n1", "k1", make);

    expect(a1).toBe(a2);
    expect(make).toHaveBeenCalledTimes(1); // memo hit — no re-encode
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it("re-encodes + mints a new URL when the key changes", async () => {
    const make = vi.fn(async () => blob());

    const a = await renderPreview("n1", "k1", make);
    const b = await renderPreview("n1", "k2", make);

    expect(a).not.toBe(b);
    expect(make).toHaveBeenCalledTimes(2);
  });

  it("revokes the previous blob (deferred) when a node's key changes", async () => {
    vi.useFakeTimers();
    try {
      const make = vi.fn(async () => blob());
      const a = await renderPreview("n1", "k1", make);
      await renderPreview("n1", "k2", make);

      expect(revokeObjectURL).not.toHaveBeenCalled(); // deferred
      vi.advanceTimersByTime(5000);
      expect(revokeObjectURL).toHaveBeenCalledWith(a);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps separate entries per node id", async () => {
    const make = vi.fn(async () => blob());
    const a = await renderPreview("n1", "k1", make);
    const b = await renderPreview("n2", "k1", make);
    expect(a).not.toBe(b);
    expect(make).toHaveBeenCalledTimes(2);
  });
});

describe("commitDurableRender", () => {
  it("lets a later preview tick reuse the durable URL (no blob re-encode)", async () => {
    const make = vi.fn(async () => blob());

    commitDurableRender("n1", "k1", "https://cdn/durable.png");
    const url = await renderPreview("n1", "k1", make);

    expect(url).toBe("https://cdn/durable.png");
    expect(make).not.toHaveBeenCalled(); // durable reuse — never encodes a blob
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("revokes a prior preview blob when a durable render is committed", async () => {
    vi.useFakeTimers();
    try {
      const make = vi.fn(async () => blob());
      const preview = await renderPreview("n1", "k1", make);
      commitDurableRender("n1", "k1", "https://cdn/durable.png");

      vi.advanceTimersByTime(5000);
      expect(revokeObjectURL).toHaveBeenCalledWith(preview);
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-encodes a fresh blob once the state moves past a durable render", async () => {
    const make = vi.fn(async () => blob());
    commitDurableRender("n1", "k1", "https://cdn/durable.png");
    const next = await renderPreview("n1", "k2", make);

    expect(next).toMatch(/^blob:/);
    expect(make).toHaveBeenCalledTimes(1);
  });
});
