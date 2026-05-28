import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const repoMocks = {
  insert: vi.fn(),
  list: vi.fn(),
  listForNode: vi.fn(),
  setPinned: vi.fn(),
  setTags: vi.fn(),
  remove: vi.fn(),
};

vi.mock("@/lib/repositories/supabase-generation-repository", () => ({
  getGenerationRepository: () => repoMocks,
  SupabaseGenerationRepository: class {},
}));

const uploadMock = vi.fn();
const uploadVideoMock = vi.fn();
const uploadAudioMock = vi.fn();
vi.mock("@/lib/library/upload-asset", () => ({
  uploadImageFromUrl: uploadMock,
  uploadVideoFromUrl: uploadVideoMock,
  uploadAudioFromUrl: uploadAudioMock,
  uploadImageAsset: vi.fn(),
  uploadMediaAsset: vi.fn(),
  uploadMediaFromUrl: vi.fn(),
  buildObjectKey: vi.fn(),
  buildMediaObjectKey: vi.fn(),
  deleteAssetObject: vi.fn(),
}));

// Slice 6.5 — generation-sync now consults nodeRegistry to filter by
// category. The registry is empty unless `all-nodes.ts` is imported,
// which we don't want to pull in here. Stub it with the kinds these
// tests reference so the whitelist passes.
vi.mock("@/lib/engine/registry", () => {
  const SCHEMAS: Record<string, { category: string }> = {
    "higgsfield-image-gen": { category: "ai-image" },
    "llm-text": { category: "ai-text" },
    "text": { category: "input" },
    "soul-id": { category: "input" },
  };
  return {
    nodeRegistry: {
      get: (kind: string) => SCHEMAS[kind],
    },
  };
});

const { _internals, startAutoPersistGenerations } = await import(
  "@/lib/sync/generation-sync"
);
const { useExecutionStore } = await import("@/lib/stores/execution-store");
const { useProjectStore } = await import("@/lib/stores/project-store");
const { useWorkflowStore } = await import("@/lib/stores/workflow-store");

beforeEach(() => {
  Object.values(repoMocks).forEach((m) => m.mockReset());
  uploadMock.mockReset();
  uploadVideoMock.mockReset();
  uploadAudioMock.mockReset();
  uploadMock.mockResolvedValue({
    bucket: "cookbook-assets",
    key: "users/user-1/images/abc/cat.png",
    url: "https://supabase.test/cookbook-assets/users/user-1/images/abc/cat.png",
    mime: "image/png",
    sizeBytes: 100,
  });
  uploadVideoMock.mockResolvedValue({
    bucket: "cookbook-assets",
    key: "users/user-1/videos/abc/clip.mp4",
    url: "https://supabase.test/cookbook-assets/users/user-1/videos/abc/clip.mp4",
    mime: "video/mp4",
    sizeBytes: 5000,
  });
  uploadAudioMock.mockResolvedValue({
    bucket: "cookbook-assets",
    key: "users/user-1/audio/abc/song.mp3",
    url: "https://supabase.test/cookbook-assets/users/user-1/audio/abc/song.mp3",
    mime: "audio/mpeg",
    sizeBytes: 2000,
  });
  useExecutionStore.setState({
    runId: 1,
    isRunning: false,
    records: new Map(),
  });
  useProjectStore.setState({ id: "p1", name: "Test Project" });
  useWorkflowStore.setState({
    nodes: [
      {
        id: "n1",
        kind: "higgsfield-image-gen",
        position: { x: 0, y: 0 },
        config: {},
      },
    ],
    edges: [],
    selectedNodeIds: [],
    selectedEdgeIds: [],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("isExternalUrl", () => {
  it("returns true for non-Supabase URLs", () => {
    expect(
      _internals.isExternalUrl("https://d3.cloudfront.net/x.png"),
    ).toBe(true);
    expect(
      _internals.isExternalUrl("https://cdn.fal.media/foo.png"),
    ).toBe(true);
  });

  it("returns false for Supabase URLs", () => {
    expect(
      _internals.isExternalUrl(
        "https://abc.supabase.co/storage/v1/object/public/cookbook-assets/x.png",
      ),
    ).toBe(false);
  });

  it("treats empty / undefined as not-external", () => {
    expect(_internals.isExternalUrl("")).toBe(false);
  });
});

describe("rehostExternalMediaIfNeeded", () => {
  it("rehosts external image URLs and reports rehosted=true", async () => {
    const result = await _internals.rehostExternalMediaIfNeeded(
      { type: "image", value: { url: "https://cdn.cloudfront.net/old.png" } },
      "higgsfield-image-gen",
    );
    expect(result.rehosted).toBe(true);
    if (Array.isArray(result.output)) {
      throw new Error("expected single output");
    }
    expect(result.output.type).toBe("image");
    if (result.output.type === "image") {
      expect(result.output.value.url).toContain("supabase.test");
    }
    expect(uploadMock).toHaveBeenCalledTimes(1);
  });

  it("rehosts external video URLs via uploadVideoFromUrl", async () => {
    const result = await _internals.rehostExternalMediaIfNeeded(
      { type: "video", value: { url: "https://cdn.fal.media/clip.mp4" } },
      "fal-seedance",
    );
    expect(result.rehosted).toBe(true);
    expect(uploadVideoMock).toHaveBeenCalledTimes(1);
    if (!Array.isArray(result.output) && result.output.type === "video") {
      expect(result.output.value.url).toContain("videos");
    }
  });

  it("rehosts external audio URLs via uploadAudioFromUrl", async () => {
    const result = await _internals.rehostExternalMediaIfNeeded(
      { type: "audio", value: { url: "https://cdn.fal.media/song.mp3" } },
      "audio",
    );
    expect(result.rehosted).toBe(true);
    expect(uploadAudioMock).toHaveBeenCalledTimes(1);
  });

  it("leaves Supabase URLs untouched", async () => {
    const result = await _internals.rehostExternalMediaIfNeeded(
      {
        type: "image",
        value: {
          url: "https://abc.supabase.co/storage/v1/object/public/cookbook-assets/x.png",
        },
      },
      "higgsfield-image-gen",
    );
    expect(result.rehosted).toBe(false);
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("rehosts each item in an array of images independently", async () => {
    const result = await _internals.rehostExternalMediaIfNeeded(
      [
        { type: "image", value: { url: "https://cdn.fal.media/a.png" } },
        { type: "image", value: { url: "https://cdn.fal.media/b.png" } },
      ],
      "higgsfield-image-gen",
    );
    expect(result.rehosted).toBe(true);
    expect(uploadMock).toHaveBeenCalledTimes(2);
  });

  it("ignores non-media outputs", async () => {
    const result = await _internals.rehostExternalMediaIfNeeded(
      { type: "text", value: "hello" },
      "llm-text",
    );
    expect(result.rehosted).toBe(false);
    expect(uploadMock).not.toHaveBeenCalled();
  });
});

describe("startAutoPersistGenerations", () => {
  it("inserts a row when a record transitions to done", async () => {
    repoMocks.insert.mockResolvedValue({ id: "gen-1" });
    const unsub = startAutoPersistGenerations({ ownerId: "user-1" });
    // Simulate engine emitting a `done` record.
    useExecutionStore.setState({
      records: new Map([
        [
          "n1",
          {
            status: "done",
            output: {
              type: "image",
              value: {
                url: "https://abc.supabase.co/storage/v1/object/public/cookbook-assets/x.png",
              },
            },
          } as never,
        ],
      ]),
    });
    // generation-sync persistRecord is async — wait a microtask.
    await vi.waitFor(() => {
      expect(repoMocks.insert).toHaveBeenCalledTimes(1);
    });
    unsub();
  });

  it("does NOT insert for cached records (replays aren't new generations)", async () => {
    const unsub = startAutoPersistGenerations({ ownerId: "user-1" });
    useExecutionStore.setState({
      records: new Map([
        [
          "n1",
          {
            status: "cached",
            output: {
              type: "image",
              value: { url: "https://supabase.test/x.png" },
            },
          } as never,
        ],
      ]),
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(repoMocks.insert).not.toHaveBeenCalled();
    unsub();
  });

  it("dedupes: same nodeId+runId only inserts once across multiple emits", async () => {
    repoMocks.insert.mockResolvedValue({ id: "gen-1" });
    const unsub = startAutoPersistGenerations({ ownerId: "user-1" });
    const doneRecord = {
      status: "done",
      output: {
        type: "image",
        value: {
          url: "https://abc.supabase.co/storage/v1/object/public/cookbook-assets/x.png",
        },
      },
    } as never;
    useExecutionStore.setState({
      records: new Map([["n1", doneRecord]]),
    });
    // Re-emit (e.g. UI patched the record output) — same runId.
    useExecutionStore.setState({
      records: new Map([["n1", doneRecord]]),
    });
    await vi.waitFor(() => expect(repoMocks.insert).toHaveBeenCalled());
    expect(repoMocks.insert).toHaveBeenCalledTimes(1);
    unsub();
  });

  /* Slice 6.5 — Gallery whitelist by category. Only ai-* categories
     persist; inputs / transforms / outputs are skipped. */
  it("does NOT insert when the node's category is outside the gallery whitelist (Slice 6.5)", async () => {
    repoMocks.insert.mockResolvedValue({ id: "gen-x" });
    useWorkflowStore.setState({
      nodes: [
        {
          id: "n1",
          kind: "text", // category 'input' — must be skipped.
          position: { x: 0, y: 0 },
          config: { text: "ignored" },
        },
      ],
      edges: [],
      selectedNodeIds: [],
      selectedEdgeIds: [],
    });
    const unsub = startAutoPersistGenerations({ ownerId: "user-1" });
    useExecutionStore.setState({
      records: new Map([
        [
          "n1",
          {
            status: "done",
            output: { type: "text", value: "should not persist" },
          } as never,
        ],
      ]),
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(repoMocks.insert).not.toHaveBeenCalled();
    unsub();
  });

  it("DOES insert for ai-image (higgsfield-image-gen) AND ai-text (llm-text) (Slice 6.5)", async () => {
    repoMocks.insert.mockResolvedValue({ id: "gen-y" });
    useWorkflowStore.setState({
      nodes: [
        {
          id: "img",
          kind: "higgsfield-image-gen",
          position: { x: 0, y: 0 },
          config: {},
        },
        {
          id: "txt",
          kind: "llm-text",
          position: { x: 0, y: 0 },
          config: {},
        },
      ],
      edges: [],
      selectedNodeIds: [],
      selectedEdgeIds: [],
    });
    const unsub = startAutoPersistGenerations({ ownerId: "user-1" });
    useExecutionStore.setState({
      records: new Map([
        [
          "img",
          {
            status: "done",
            output: {
              type: "image",
              value: { url: "https://supabase.test/x.png" },
            },
          } as never,
        ],
        [
          "txt",
          {
            status: "done",
            output: { type: "text", value: "an LLM response" },
          } as never,
        ],
      ]),
    });
    await vi.waitFor(() =>
      expect(repoMocks.insert).toHaveBeenCalledTimes(2),
    );
    unsub();
  });

  it("rehosts external URLs before insert", async () => {
    repoMocks.insert.mockResolvedValue({ id: "gen-1" });
    const unsub = startAutoPersistGenerations({ ownerId: "user-1" });
    useExecutionStore.setState({
      records: new Map([
        [
          "n1",
          {
            status: "done",
            output: {
              type: "image",
              value: { url: "https://cdn.fal.media/external.png" },
            },
          } as never,
        ],
      ]),
    });
    await vi.waitFor(() => expect(repoMocks.insert).toHaveBeenCalled());
    expect(uploadMock).toHaveBeenCalled();
    const insertArg = repoMocks.insert.mock.calls[0]?.[0] as {
      output: { type: string; value: { url: string } };
    };
    // The persisted output URL is the rehosted (Supabase) one.
    expect(insertArg.output.value.url).toContain("supabase.test");
    unsub();
  });
});
