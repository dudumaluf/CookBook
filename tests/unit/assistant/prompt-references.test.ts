import { describe, expect, it } from "vitest";

import {
  buildReferencesNote,
  type PromptReference,
} from "@/lib/assistant/prompt-references";

const imageRef: PromptReference = {
  id: "r1",
  kind: "asset",
  refId: "asset_a",
  label: "Character Sheet",
  mediaType: "image",
  url: "https://x/a.png",
};
const genRef: PromptReference = {
  id: "r2",
  kind: "generation",
  refId: "gen_b",
  label: "Take 3",
  mediaType: "video",
};

describe("buildReferencesNote", () => {
  it("returns empty string for no references", () => {
    expect(buildReferencesNote([])).toBe("");
  });

  it("lists each reference with label, type, id and url", () => {
    const note = buildReferencesNote([imageRef, genRef]);
    expect(note).toContain("Referenced items");
    expect(note).toContain('"Character Sheet"');
    expect(note).toContain("image asset");
    expect(note).toContain("id=asset_a");
    expect(note).toContain("url=https://x/a.png");
    // generation without url omits the url segment.
    expect(note).toContain('"Take 3"');
    expect(note).toContain("video generation");
    expect(note).toContain("id=gen_b");
    expect(note).not.toContain("url=undefined");
  });
});
