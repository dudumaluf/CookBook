import { describe, expect, it } from "vitest";

import {
  buildProjectBundle,
  collectMediaUrls,
  importProjectFile,
  readProjectBundle,
  rewriteUrls,
} from "@/lib/project/file";
import type { ProjectDocument } from "@/lib/project/document";

function sampleDoc(): ProjectDocument {
  return {
    version: 2,
    projectName: "Trip",
    workflow: {
      nodes: [
        {
          id: "img",
          kind: "image",
          position: { x: 0, y: 0 },
          config: { url: "https://cdn.example/in.png" },
        },
      ],
      edges: [],
    },
    assets: [{ id: "a1", url: "https://cdn.example/asset.png" }],
    layout: {
      libraryOpen: true,
      queueOpen: false,
      chatSheetOpen: false,
      approvalGateOn: false,
    },
    executionState: {
      g1: { output: { type: "image", value: { url: "https://cdn.example/out.png" } } },
    },
  };
}

describe("collectMediaUrls", () => {
  it("finds every http(s) URL across graph, assets, and results", () => {
    const urls = collectMediaUrls(sampleDoc());
    expect(urls.sort()).toEqual(
      [
        "https://cdn.example/asset.png",
        "https://cdn.example/in.png",
        "https://cdn.example/out.png",
      ].sort(),
    );
  });
});

describe("rewriteUrls", () => {
  it("replaces mapped URLs anywhere in the document", () => {
    const map = new Map([["https://cdn.example/out.png", "media/0000.png"]]);
    const out = rewriteUrls(sampleDoc(), map);
    expect(out.executionState!.g1).toMatchObject({
      output: { value: { url: "media/0000.png" } },
    });
    // Unmapped URLs are untouched.
    expect(out.assets[0]).toMatchObject({ url: "https://cdn.example/asset.png" });
  });
});

describe("bundle round-trip", () => {
  it("embeds media bytes, rewrites to relative paths, then restores on read", async () => {
    const doc = sampleDoc();
    const bytes = await buildProjectBundle(doc, async (url) => ({
      bytes: new TextEncoder().encode(`BYTES:${url}`),
      mime: "image/png",
    }));

    const uploaded: Record<string, Uint8Array> = {};
    const restored = await readProjectBundle(bytes, async (path, data) => {
      uploaded[path] = data;
      return `https://mybucket.supabase.co/${path}`;
    });

    // All three media files were bundled + re-uploaded.
    expect(Object.keys(uploaded)).toHaveLength(3);
    // Bytes survived the zip round-trip.
    const someBytes = Object.values(uploaded)[0]!;
    expect(new TextDecoder().decode(someBytes)).toContain("BYTES:");
    // Every URL in the restored doc now points at the new bucket.
    for (const url of collectMediaUrls(restored)) {
      expect(url.startsWith("https://mybucket.supabase.co/media/")).toBe(true);
    }
    // Graph structure preserved.
    expect(restored.workflow.nodes).toHaveLength(1);
    expect(restored.projectName).toBe("Trip");
  });

  it("leaves URLs as-is when their bytes can't be fetched", async () => {
    const bytes = await buildProjectBundle(sampleDoc(), async () => null);
    const restored = await readProjectBundle(bytes, async () => "unused");
    // Nothing bundled → URLs unchanged.
    expect(collectMediaUrls(restored)).toContain("https://cdn.example/out.png");
  });
});

describe("importProjectFile (JSON)", () => {
  it("parses + migrates a .cookbook JSON file", async () => {
    const doc = sampleDoc();
    const file = new File([JSON.stringify(doc)], "trip.cookbook", {
      type: "application/json",
    });
    const out = await importProjectFile(file);
    expect(out.projectName).toBe("Trip");
    expect(out.workflow.nodes).toHaveLength(1);
  });
});
