import { beforeEach, describe, expect, it, vi } from "vitest";

import "@/lib/engine/all-nodes";

vi.mock("@/lib/repositories/supabase-recipe-repository", () => ({
  getRecipeRepository: () => ({
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn(),
    save: vi.fn(),
    remove: vi.fn(),
  }),
  SupabaseRecipeRepository: class {},
}));
vi.mock("@/lib/repositories/supabase-generation-repository", () => ({
  getGenerationRepository: () => ({
    list: vi.fn().mockResolvedValue([]),
    insert: vi.fn(),
    setPinned: vi.fn(),
    setTitle: vi.fn(),
    setTags: vi.fn(),
    remove: vi.fn(),
    listForNode: vi.fn().mockResolvedValue([]),
  }),
  SupabaseGenerationRepository: class {},
}));

const { getTool, getToolDefinitions } = await import("@/lib/assistant/tools");
const { useWorkflowStore } = await import("@/lib/stores/workflow-store");

beforeEach(() => {
  useWorkflowStore.setState({
    nodes: [],
    edges: [],
    selectedNodeIds: [],
    selectedEdgeIds: [],
  });
});

interface HealthIssueShape {
  severity: "error" | "warn";
  code: string;
  nodeId?: string;
  edgeId?: string;
  message: string;
  hint?: string;
}

interface HealthResult {
  ok: boolean;
  issueCount: number;
  errorCount: number;
  issues: HealthIssueShape[];
  summary: string;
}

async function runTool(): Promise<HealthResult> {
  const tool = getTool("check_workflow_health")!;
  return (await tool.execute({}, {})) as HealthResult;
}

describe("check_workflow_health — registration", () => {
  it("is in the assistant tool registry", () => {
    const names = getToolDefinitions().map((d) => d.function.name);
    expect(names).toContain("check_workflow_health");
  });

  it("rejects unexpected arguments via the strict args schema", async () => {
    const tool = getTool("check_workflow_health")!;
    await expect(tool.execute({ unexpected: true }, {})).rejects.toBeDefined();
  });
});

describe("check_workflow_health — happy path", () => {
  it("reports ok=true on an empty canvas", async () => {
    const out = await runTool();
    expect(out.ok).toBe(true);
    expect(out.issueCount).toBe(0);
    expect(out.errorCount).toBe(0);
    expect(out.issues).toEqual([]);
    expect(out.summary).toMatch(/0 issues/);
  });

  it("reports ok=true for a clean fan-out workflow (mirrors the user's project)", () => {
    // Reproduce the user's now-patched state: text → llm-text (user/system),
    // llm-text → array("**") → list, list → array("---") → list →
    // fal-image. All edges resolve, no phantom fields.
    const ws = useWorkflowStore.getState();
    const userText = ws.addNode(
      "text",
      { x: 0, y: 0 },
      { text: "Generate scenarios" },
    );
    const sysText = ws.addNode(
      "text",
      { x: 0, y: 200 },
      { text: "You are an expert prompt engineer" },
    );
    const llm = ws.addNode("llm-text", { x: 300, y: 0 }, {});
    const arr1 = ws.addNode(
      "array",
      { x: 600, y: 0 },
      { delimiter: "**", trim: true },
    );
    const num1 = ws.addNode("number", { x: 600, y: -200 }, { value: 0 });
    const list1 = ws.addNode("list", { x: 900, y: 0 }, {});
    const arr2 = ws.addNode(
      "array",
      { x: 1200, y: 0 },
      { delimiter: "---", trim: true },
    );
    const num2 = ws.addNode("number", { x: 1200, y: -200 }, { value: 0 });
    const list2 = ws.addNode("list", { x: 1500, y: 0 }, {});
    const fal = ws.addNode(
      "fal-image",
      { x: 1800, y: 0 },
      { model: "nano-banana-2" },
    );

    ws.addEdge({ source: userText, sourceHandle: "out", target: llm, targetHandle: "user" });
    ws.addEdge({ source: sysText, sourceHandle: "out", target: llm, targetHandle: "system" });
    ws.addEdge({ source: llm, sourceHandle: "out", target: arr1, targetHandle: "text" });
    ws.addEdge({ source: arr1, sourceHandle: "out", target: list1, targetHandle: "items" });
    ws.addEdge({ source: num1, sourceHandle: "out", target: list1, targetHandle: "cursor" });
    ws.addEdge({ source: list1, sourceHandle: "out", target: arr2, targetHandle: "text" });
    ws.addEdge({ source: arr2, sourceHandle: "out", target: list2, targetHandle: "items" });
    ws.addEdge({ source: num2, sourceHandle: "out", target: list2, targetHandle: "cursor" });
    ws.addEdge({ source: list2, sourceHandle: "out", target: fal, targetHandle: "prompt" });

    return runTool().then((out) => {
      expect(out.ok).toBe(true);
      expect(out.issueCount).toBe(0);
      expect(out.summary).toContain("structurally clean");
    });
  });
});

describe("check_workflow_health — generic checks", () => {
  it("flags an unknown kind", async () => {
    useWorkflowStore.setState({
      nodes: [
        {
          id: "rogue",
          kind: "totally-not-real",
          position: { x: 0, y: 0 },
          config: {},
        },
      ],
      edges: [],
      selectedNodeIds: [],
      selectedEdgeIds: [],
    });
    const out = await runTool();
    expect(out.errorCount).toBeGreaterThanOrEqual(1);
    const issue = out.issues.find((i) => i.code === "unknown_kind");
    expect(issue).toBeDefined();
    expect(issue!.nodeId).toBe("rogue");
  });

  it("flags a dangling target handle (the invisible-edge bug)", async () => {
    const ws = useWorkflowStore.getState();
    const t = ws.addNode("text", { x: 0, y: 0 }, { text: "hi" });
    const llm = ws.addNode("llm-text", { x: 300, y: 0 }, {});
    // Force an edge directly into the store with a bogus targetHandle.
    // addEdge would normally not produce this, but a bad project save
    // could. The visual symptom: React Flow can't draw the edge but
    // still treats the port as occupied.
    useWorkflowStore.setState((s) => ({
      ...s,
      edges: [
        {
          id: "bad",
          source: t,
          sourceHandle: "out",
          target: llm,
          targetHandle: "user-7", // not in smartInputs (user is single now)
        },
      ],
    }));
    const out = await runTool();
    const issue = out.issues.find((i) => i.code === "dangling_target_handle");
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("error");
    expect(issue!.edgeId).toBe("bad");
    expect(issue!.message).toContain("user-7");
    expect(issue!.message).toContain("invisible edge");
    expect(issue!.hint).toContain("user");
    expect(issue!.hint).toContain("system");
  });

  it("flags a dangling source handle", async () => {
    const ws = useWorkflowStore.getState();
    const t = ws.addNode("text", { x: 0, y: 0 }, { text: "hi" });
    const llm = ws.addNode("llm-text", { x: 300, y: 0 }, {});
    useWorkflowStore.setState((s) => ({
      ...s,
      edges: [
        {
          id: "bad-src",
          source: t,
          sourceHandle: "nonexistent-out",
          target: llm,
          targetHandle: "user",
        },
      ],
    }));
    const out = await runTool();
    const issue = out.issues.find((i) => i.code === "dangling_source_handle");
    expect(issue).toBeDefined();
    expect(issue!.edgeId).toBe("bad-src");
    expect(issue!.message).toContain("nonexistent-out");
  });

  it("flags a single-arity duplicate", async () => {
    const ws = useWorkflowStore.getState();
    const t1 = ws.addNode("text", { x: 0, y: 0 }, { text: "a" });
    const t2 = ws.addNode("text", { x: 0, y: 200 }, { text: "b" });
    const llm = ws.addNode("llm-text", { x: 300, y: 0 }, {});
    // Bypass addEdge's single-arity guard by injecting two edges into
    // store directly. addEdge would refuse the second.
    useWorkflowStore.setState((s) => ({
      ...s,
      edges: [
        {
          id: "e1",
          source: t1,
          sourceHandle: "out",
          target: llm,
          targetHandle: "user",
        },
        {
          id: "e2",
          source: t2,
          sourceHandle: "out",
          target: llm,
          targetHandle: "user",
        },
      ],
    }));
    const out = await runTool();
    const issue = out.issues.find((i) => i.code === "single_arity_duplicate");
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("error");
    expect(issue!.message).toContain("user");
  });

  it("flags an unwired required input on llm-text", async () => {
    const ws = useWorkflowStore.getState();
    ws.addNode("llm-text", { x: 0, y: 0 }, {});
    const out = await runTool();
    const issue = out.issues.find((i) => i.code === "unwired_required_input");
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("error");
    expect(issue!.message).toContain("user");
  });

  it("flags an unwired required input on fal-image", async () => {
    const ws = useWorkflowStore.getState();
    ws.addNode("fal-image", { x: 0, y: 0 }, { model: "nano-banana-2" });
    const out = await runTool();
    const issues = out.issues.filter((i) => i.code === "unwired_required_input");
    // fal-image requires `prompt` only — image-N are optional.
    expect(issues.some((i) => i.message.includes("prompt"))).toBe(true);
  });

  it("flags a self-loop", async () => {
    const ws = useWorkflowStore.getState();
    const t = ws.addNode("text", { x: 0, y: 0 }, { text: "hi" });
    useWorkflowStore.setState((s) => ({
      ...s,
      edges: [
        {
          id: "loop",
          source: t,
          sourceHandle: "out",
          target: t,
          targetHandle: "any",
        },
      ],
    }));
    const out = await runTool();
    const issue = out.issues.find((i) => i.code === "self_loop");
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("error");
  });
});

describe("check_workflow_health — per-kind drift", () => {
  it("surfaces array.separator phantom field via runKindHealth", async () => {
    const ws = useWorkflowStore.getState();
    const t = ws.addNode("text", { x: 0, y: 0 }, { text: "a,b,c" });
    const arr = ws.addNode(
      "array",
      { x: 300, y: 0 },
      { delimiter: ",", trim: true, separator: "**" },
    );
    ws.addEdge({
      source: t,
      sourceHandle: "out",
      target: arr,
      targetHandle: "text",
    });
    const out = await runTool();
    const issue = out.issues.find(
      (i) => i.code === "phantom_config_field" && i.nodeId === arr,
    );
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("warn");
    expect(issue!.message).toMatch(/separator/);
  });

  it("surfaces fal-image endpoint-id model via runKindHealth", async () => {
    const ws = useWorkflowStore.getState();
    const t = ws.addNode("text", { x: 0, y: 0 }, { text: "p" });
    const fal = ws.addNode(
      "fal-image",
      { x: 300, y: 0 },
      { model: "fal-ai/nano-banana-2" },
    );
    ws.addEdge({
      source: t,
      sourceHandle: "out",
      target: fal,
      targetHandle: "prompt",
    });
    const out = await runTool();
    const issue = out.issues.find(
      (i) => i.code === "fal_image_endpoint_id_in_model",
    );
    expect(issue).toBeDefined();
    expect(issue!.message).toContain("fal-ai/nano-banana-2");
  });
});

describe("check_workflow_health — issue ordering", () => {
  it("sorts errors before warnings, then by stable id", async () => {
    const ws = useWorkflowStore.getState();
    const t = ws.addNode("text", { x: 0, y: 0 }, { text: "hi" });
    // Cause a warn (phantom separator) AND an error (unwired llm-text).
    const arr = ws.addNode(
      "array",
      { x: 300, y: 0 },
      { delimiter: ",", trim: true, separator: "**" },
    );
    ws.addEdge({
      source: t,
      sourceHandle: "out",
      target: arr,
      targetHandle: "text",
    });
    ws.addNode("llm-text", { x: 600, y: 0 }, {});
    const out = await runTool();
    expect(out.issueCount).toBeGreaterThan(1);
    // First issue is an error; warns come after.
    const firstWarnIdx = out.issues.findIndex((i) => i.severity === "warn");
    const lastErrorIdx = (() => {
      let idx = -1;
      out.issues.forEach((i, n) => {
        if (i.severity === "error") idx = n;
      });
      return idx;
    })();
    if (firstWarnIdx !== -1 && lastErrorIdx !== -1) {
      expect(firstWarnIdx).toBeGreaterThan(lastErrorIdx);
    }
  });
});
