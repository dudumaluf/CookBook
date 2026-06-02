import { describe, expect, it } from "vitest";

import {
  extractImagesFromClipboard,
  isEditablePasteTarget,
} from "@/lib/canvas/handle-canvas-paste";

function makeFile(name: string, type: string): File {
  return new File([new Uint8Array([1])], name, { type });
}

/**
 * Build a fake DataTransfer-shaped object. The real DataTransfer API is
 * not constructible in tests; we only need the shape extractImagesFromClipboard
 * actually walks (`files` + `items.kind` + `items.type` + `items.getAsFile`).
 */
function fakeDataTransfer({
  files = [] as File[],
  items = [] as { kind: string; type: string; file?: File }[],
}): DataTransfer {
  const itemList = items.map((i) => ({
    kind: i.kind,
    type: i.type,
    getAsFile: () => i.file ?? null,
  }));
  return {
    files: files as unknown as FileList,
    items: itemList as unknown as DataTransferItemList,
  } as unknown as DataTransfer;
}

describe("extractImagesFromClipboard", () => {
  it("returns [] for null clipboardData", () => {
    expect(extractImagesFromClipboard(null)).toEqual([]);
  });

  it("returns [] when clipboard has no image content", () => {
    const dt = fakeDataTransfer({
      files: [],
      items: [{ kind: "string", type: "text/plain" }],
    });
    expect(extractImagesFromClipboard(dt)).toEqual([]);
  });

  it("extracts image files from `files` (modern browsers)", () => {
    const png = makeFile("img.png", "image/png");
    const dt = fakeDataTransfer({ files: [png] });
    const result = extractImagesFromClipboard(dt);
    expect(result).toHaveLength(1);
    expect(result[0]?.type).toBe("image/png");
  });

  it("ignores non-image files from `files`", () => {
    const txt = makeFile("notes.txt", "text/plain");
    const dt = fakeDataTransfer({ files: [txt] });
    expect(extractImagesFromClipboard(dt)).toEqual([]);
  });

  it("falls back to `items` for Safari-style image-only clipboards", () => {
    const png = makeFile("img.png", "image/png");
    const dt = fakeDataTransfer({
      files: [],
      items: [{ kind: "file", type: "image/png", file: png }],
    });
    const result = extractImagesFromClipboard(dt);
    expect(result).toHaveLength(1);
    expect(result[0]?.type).toBe("image/png");
  });

  it("ignores non-file items in the items fallback", () => {
    const dt = fakeDataTransfer({
      files: [],
      items: [
        { kind: "string", type: "text/html" },
        { kind: "string", type: "image/png" },
      ],
    });
    expect(extractImagesFromClipboard(dt)).toEqual([]);
  });

  it("ignores non-image file items in the items fallback", () => {
    const pdf = makeFile("doc.pdf", "application/pdf");
    const dt = fakeDataTransfer({
      files: [],
      items: [{ kind: "file", type: "application/pdf", file: pdf }],
    });
    expect(extractImagesFromClipboard(dt)).toEqual([]);
  });

  it("prefers `files` and skips `items` walk when `files` already produced images", () => {
    const png = makeFile("img.png", "image/png");
    const fallbackPng = makeFile("fallback.png", "image/png");
    const dt = fakeDataTransfer({
      files: [png],
      items: [{ kind: "file", type: "image/png", file: fallbackPng }],
    });
    const result = extractImagesFromClipboard(dt);
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("img.png");
  });
});

describe("isEditablePasteTarget", () => {
  it("matches input / textarea / select", () => {
    const input = document.createElement("input");
    const textarea = document.createElement("textarea");
    const select = document.createElement("select");
    expect(isEditablePasteTarget(input)).toBe(true);
    expect(isEditablePasteTarget(textarea)).toBe(true);
    expect(isEditablePasteTarget(select)).toBe(true);
  });

  it("matches contentEditable elements", () => {
    const div = document.createElement("div");
    Object.defineProperty(div, "isContentEditable", {
      value: true,
      configurable: true,
    });
    expect(isEditablePasteTarget(div)).toBe(true);
  });

  it("returns false for plain elements", () => {
    const div = document.createElement("div");
    expect(isEditablePasteTarget(div)).toBe(false);
  });

  it("returns false for null", () => {
    expect(isEditablePasteTarget(null)).toBe(false);
  });
});
