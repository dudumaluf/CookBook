import { beforeEach, describe, expect, it, vi } from "vitest";

import { extractImageDimensions } from "@/lib/library/extract-image-dimensions";

/**
 * happy-dom doesn't load images for real, so we stub the global
 * `Image` constructor to fire `onload` (or `onerror`) on the next
 * microtask with the dimensions we want.
 *
 * URL.createObjectURL / revokeObjectURL are also missing — we mock
 * those to verify the cleanup path.
 */

interface ImageStub {
  onload: (() => void) | null;
  onerror: (() => void) | null;
  src: string;
  naturalWidth: number;
  naturalHeight: number;
}

let createdUrls: string[] = [];
let revokedUrls: string[] = [];
let nextLoadResult: "load" | "error" = "load";
let nextDimensions: { width: number; height: number } = { width: 1920, height: 1080 };

beforeEach(() => {
  createdUrls = [];
  revokedUrls = [];
  nextLoadResult = "load";
  nextDimensions = { width: 1920, height: 1080 };

  // Stub URL.createObjectURL / revokeObjectURL.
  globalThis.URL.createObjectURL = vi.fn((file: Blob) => {
    const url = `blob:mock/${createdUrls.length}-${(file as File).name ?? "file"}`;
    createdUrls.push(url);
    return url;
  });
  globalThis.URL.revokeObjectURL = vi.fn((url: string) => {
    revokedUrls.push(url);
  });

  // Stub the global Image constructor.
  // Avoid `this`-aliasing by building the instance through a factory
  // that closes over `stub` and returns it from the constructor.
  globalThis.Image = function ImageMock() {
    const stub: ImageStub & { _src?: string } = {
      onload: null,
      onerror: null,
      src: "",
      naturalWidth: 0,
      naturalHeight: 0,
    };
    Object.defineProperty(stub, "src", {
      get: () => stub._src ?? "",
      set: (value: string) => {
        stub._src = value;
        queueMicrotask(() => {
          if (nextLoadResult === "load") {
            stub.naturalWidth = nextDimensions.width;
            stub.naturalHeight = nextDimensions.height;
            stub.onload?.();
          } else {
            stub.onerror?.();
          }
        });
      },
    });
    return stub as unknown as HTMLImageElement;
  } as unknown as typeof Image;
});

function makeImageFile(name = "cat.png", type = "image/png") {
  return new File([new Uint8Array(10)], name, { type });
}

describe("extractImageDimensions", () => {
  it("resolves with the natural dimensions on load", async () => {
    nextDimensions = { width: 1920, height: 1080 };
    const dims = await extractImageDimensions(makeImageFile());
    expect(dims).toEqual({ width: 1920, height: 1080 });
  });

  it("resolves to null when the image fails to load (`onerror`)", async () => {
    nextLoadResult = "error";
    const dims = await extractImageDimensions(makeImageFile());
    expect(dims).toBeNull();
  });

  it("revokes the ObjectURL on both load and error paths", async () => {
    await extractImageDimensions(makeImageFile("ok.png"));
    expect(revokedUrls.length).toBe(1);
    expect(revokedUrls[0]).toBe(createdUrls[0]);

    nextLoadResult = "error";
    await extractImageDimensions(makeImageFile("bad.png"));
    expect(revokedUrls.length).toBe(2);
  });

  it("rejects (resolves null) for non-image MIMEs without spinning up an Image element", async () => {
    const txt = new File(["hi"], "notes.txt", { type: "text/plain" });
    const dims = await extractImageDimensions(txt);
    expect(dims).toBeNull();
    // No object URL created (early bail).
    expect(createdUrls.length).toBe(0);
  });

  it("resolves null when the image loads with 0×0 dimensions (defensive)", async () => {
    nextDimensions = { width: 0, height: 0 };
    const dims = await extractImageDimensions(makeImageFile());
    expect(dims).toBeNull();
  });
});
