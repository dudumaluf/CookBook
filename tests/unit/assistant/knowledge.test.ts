import { beforeEach, describe, expect, it, vi } from "vitest";

import "@/lib/engine/all-nodes";

const recipeRepoMocks = {
  list: vi.fn(),
  get: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
};
vi.mock("@/lib/repositories/supabase-recipe-repository", () => ({
  getRecipeRepository: () => recipeRepoMocks,
  SupabaseRecipeRepository: class {},
}));

const generationRepoMocks = {
  list: vi.fn().mockResolvedValue([]),
  insert: vi.fn(),
  setPinned: vi.fn(),
  setTitle: vi.fn(),
  setTags: vi.fn(),
  remove: vi.fn(),
  listForNode: vi.fn().mockResolvedValue([]),
};
vi.mock("@/lib/repositories/supabase-generation-repository", () => ({
  getGenerationRepository: () => generationRepoMocks,
  SupabaseGenerationRepository: class {},
}));

const { buildKnowledgeBundle } = await import(
  "@/lib/assistant/knowledge"
);
const { buildIdentityKnowledge } = await import(
  "@/lib/assistant/knowledge/identity"
);
const { buildVocabularyKnowledge } = await import(
  "@/lib/assistant/knowledge/vocabulary"
);
const { buildNodeCatalogKnowledge } = await import(
  "@/lib/assistant/knowledge/node-catalog"
);
const { buildCanvasKnowledge } = await import(
  "@/lib/assistant/knowledge/canvas"
);
const { buildLibraryKnowledge } = await import(
  "@/lib/assistant/knowledge/library"
);
const { buildConversationMessages } = await import(
  "@/lib/assistant/knowledge/conversation"
);
const { useAssetStore } = await import("@/lib/stores/asset-store");
const { useAssistantStore } = await import(
  "@/lib/stores/assistant-store"
);
const { useExecutionStore } = await import("@/lib/stores/execution-store");
const { useWorkflowStore } = await import("@/lib/stores/workflow-store");

beforeEach(() => {
  useWorkflowStore.setState({
    nodes: [],
    edges: [],
    selectedNodeIds: [],
    selectedEdgeIds: [],
  });
  useAssetStore.setState({
    assets: [],
    selectedAssetIds: [],
    selectionAnchorId: null,
  });
  useExecutionStore.setState({
    runId: 0,
    isRunning: false,
    records: new Map(),
  });
  useAssistantStore.setState({
    messages: [],
    isThinking: false,
    abortController: null,
  });
  recipeRepoMocks.list.mockResolvedValue([]);
  generationRepoMocks.list.mockResolvedValue([]);
});

describe("buildIdentityKnowledge", () => {
  it("includes the COOKBOOK and ASSISTANT framing", () => {
    const md = buildIdentityKnowledge();
    expect(md).toContain("COOKBOOK");
    expect(md).toContain("ASSISTANT");
    expect(md).toContain("orchestrate");
  });
});

describe("buildVocabularyKnowledge", () => {
  it("includes the canonical project terms", () => {
    const md = buildVocabularyKnowledge();
    expect(md).toContain("Reactive node");
    expect(md).toContain("Composite node");
    expect(md).toContain("Fan-out");
    expect(md).toContain("Soul ID");
  });
});

describe("buildNodeCatalogKnowledge", () => {
  it("lists registered node kinds with category + I/O", () => {
    const md = buildNodeCatalogKnowledge();
    expect(md).toContain("`text`");
    expect(md).toContain("`llm-text`");
    expect(md).toContain("`higgsfield-image-gen`");
    // Reactive flag surfaces.
    expect(md).toContain("reactive");
    // Hidden kinds (composite, passthrough) are excluded.
    expect(md).not.toContain("`passthrough`");
  });
});

describe("buildCanvasKnowledge", () => {
  it("renders empty state when no nodes", () => {
    const md = buildCanvasKnowledge();
    expect(md).toMatch(/empty/i);
  });

  it("renders nodes with id + position + config + edges", () => {
    useWorkflowStore.setState({
      nodes: [
        {
          id: "n1",
          kind: "text",
          position: { x: 40, y: 40 },
          config: { text: "hello world" },
        },
        {
          id: "n2",
          kind: "llm-text",
          position: { x: 480, y: 120 },
          config: { model: "anthropic/claude-sonnet-4.5" },
        },
      ],
      edges: [
        {
          id: "e1",
          source: "n1",
          sourceHandle: "out",
          target: "n2",
          targetHandle: "user",
        },
      ],
      selectedNodeIds: ["n2"],
      selectedEdgeIds: [],
    });
    const md = buildCanvasKnowledge();
    expect(md).toContain("n1");
    expect(md).toContain("n2");
    expect(md).toContain("hello world");
    expect(md).toContain("n1.out");
    expect(md).toContain("n2.user");
    expect(md).toContain("Selected: n2");
  });
});

describe("buildLibraryKnowledge", () => {
  it("renders empty state when no assets", () => {
    const md = buildLibraryKnowledge();
    expect(md).toMatch(/empty/i);
  });

  it("groups assets by kind", () => {
    useAssetStore.setState({
      assets: [
        {
          id: "img-1",
          kind: "image",
          name: "Photo.jpg",
          tags: [],
          scope: "project",
          createdAt: 0,
          updatedAt: 0,
          source: { type: "url", url: "https://x.test/p.png" },
        } as never,
        {
          id: "soul-1",
          kind: "soul-id",
          name: "Dudu",
          tags: [],
          scope: "global",
          createdAt: 0,
          updatedAt: 0,
          customReferenceId: "ref-uuid",
          variant: "v2",
        } as never,
      ],
      selectedAssetIds: [],
      selectionAnchorId: null,
    });
    const md = buildLibraryKnowledge();
    expect(md).toContain("Soul IDs");
    expect(md).toContain("Dudu");
    expect(md).toContain("Images");
    expect(md).toContain("Photo.jpg");
  });
});

describe("buildConversationMessages", () => {
  it("returns last N messages converted to ChatMessage shape", () => {
    useAssistantStore.setState({
      messages: [
        { role: "user", content: "hi", timestamp: 1 },
        { role: "assistant", content: "hello", timestamp: 2 },
        {
          role: "assistant",
          content: "",
          plan: {
            reasoning: "doing X",
            steps: [{ kind: "run" }],
            estimatedCostUsd: 0,
          },
          timestamp: 3,
        },
      ],
      isThinking: false,
      abortController: null,
    });
    const out = buildConversationMessages();
    expect(out).toHaveLength(3);
    expect(out[0]?.role).toBe("user");
    expect(out[1]?.role).toBe("assistant");
    // Plan is flattened into the content as a synthetic [plan emitted: ...]
    // marker — Slice 7.3 will preserve tool_calls properly.
    expect(out[2]?.role).toBe("assistant");
    expect(JSON.stringify(out[2])).toContain("plan emitted");
  });
});

describe("buildKnowledgeBundle", () => {
  it("returns system markdown + messages array", async () => {
    const bundle = await buildKnowledgeBundle({
      ownerId: "user-1",
      projectId: "p1",
    });
    expect(bundle.system).toContain("COOKBOOK");
    expect(bundle.system).toContain("VOCABULARY");
    expect(bundle.system).toContain("NODE CATALOG");
    expect(bundle.system).toContain("RECIPES");
    expect(bundle.system).toContain("CANVAS");
    expect(bundle.system).toContain("LIBRARY");
    expect(bundle.system).toContain("GALLERY");
    expect(bundle.system).toContain("TOOLS YOU CAN CALL");
    expect(bundle.messages).toEqual([]); // no chat history yet
  });

  it("threads conversation history into messages[]", async () => {
    useAssistantStore.setState({
      messages: [
        { role: "user", content: "what's possible?", timestamp: 1 },
        { role: "assistant", content: "lots", timestamp: 2 },
      ],
      isThinking: false,
      abortController: null,
    });
    const bundle = await buildKnowledgeBundle({
      ownerId: "user-1",
      projectId: "p1",
    });
    expect(bundle.messages).toHaveLength(2);
    expect(bundle.messages[0]).toEqual({
      role: "user",
      content: "what's possible?",
    });
  });

  it("honors skip flags", async () => {
    const bundle = await buildKnowledgeBundle({
      ownerId: "user-1",
      projectId: "p1",
      skip: { nodeCatalog: true, library: true, gallery: true, recipes: true },
    });
    expect(bundle.system).not.toContain("NODE CATALOG");
    expect(bundle.system).not.toContain("LIBRARY");
    expect(bundle.system).not.toContain("GALLERY");
    expect(bundle.system).not.toContain("RECIPES");
    // Identity + vocabulary still present.
    expect(bundle.system).toContain("COOKBOOK");
    expect(bundle.system).toContain("VOCABULARY");
  });
});
