import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "@/lib/engine/all-nodes";

/**
 * 2026-06-03 — Coverage backfill for the three run-control tools that
 * were registered in Slice 7.3 but never had dedicated unit tests
 * (audit found them only exercised indirectly via the reasoner). We
 * pin: kicks off the right execution-store entry, returns runId + ok,
 * and the guard rails (empty canvas, no node, run-already-in-flight,
 * idempotent cancel).
 *
 * The engine's `runWorkflow` is mocked to resolve immediately so the
 * tests don't touch network / Fal / OpenRouter and don't race the
 * real reactive runner.
 */

const runWorkflowMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/engine/run-workflow", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/engine/run-workflow")
  >("@/lib/engine/run-workflow");
  return {
    ...actual,
    runWorkflow: runWorkflowMock,
  };
});

const { getTool } = await import("@/lib/assistant/tools");
const { useExecutionStore } = await import("@/lib/stores/execution-store");
const { useWorkflowStore } = await import("@/lib/stores/workflow-store");

beforeEach(() => {
  runWorkflowMock.mockReset();
  // Default mock: a successful, no-op run. Per-test overrides for
  // race / abort scenarios.
  runWorkflowMock.mockImplementation(async () => undefined);
  useWorkflowStore.setState({
    nodes: [],
    edges: [],
    selectedNodeIds: [],
    selectedEdgeIds: [],
  });
  useExecutionStore.setState({
    runId: 0,
    isRunning: false,
    records: new Map(),
  });
});

afterEach(() => {
  useExecutionStore.getState().cancelRun();
});

describe("run_workflow tool", () => {
  it("rejects when canvas is empty (saves a wasted run round-trip)", async () => {
    const tool = getTool("run_workflow")!;
    const out = (await tool.execute({}, {})) as {
      ok: boolean;
      error?: string;
    };
    expect(out.ok).toBe(false);
    expect(out.error).toContain("empty");
    expect(useExecutionStore.getState().isRunning).toBe(false);
  });

  it("kicks off a run and returns the new runId", async () => {
    useWorkflowStore.getState().addNode("text", { x: 0, y: 0 });
    const tool = getTool("run_workflow")!;
    const before = useExecutionStore.getState().runId;
    const out = (await tool.execute({}, {})) as {
      ok: boolean;
      runId: number;
    };
    expect(out.ok).toBe(true);
    expect(out.runId).toBeGreaterThan(before);
    expect(runWorkflowMock).toHaveBeenCalledTimes(1);
  });

  it("rejects when a run is already in flight (prevents stacking)", async () => {
    useWorkflowStore.getState().addNode("text", { x: 0, y: 0 });
    useExecutionStore.setState({ isRunning: true });
    const tool = getTool("run_workflow")!;
    const out = (await tool.execute({}, {})) as {
      ok: boolean;
      error?: string;
    };
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/already in flight/i);
    // Ensure we did NOT trigger a duplicate engine run.
    expect(runWorkflowMock).not.toHaveBeenCalled();
  });

  it("rejects unknown args via strict Zod (typo-proof contract)", async () => {
    const tool = getTool("run_workflow")!;
    await expect(
      tool.execute({ unexpected: "field" }, {}),
    ).rejects.toThrow();
  });
});

describe("run_from tool", () => {
  it("rejects when nodeId doesn't exist", async () => {
    const tool = getTool("run_from")!;
    const out = (await tool.execute(
      { nodeId: "ghost" },
      {},
    )) as { ok: boolean; error?: string };
    expect(out.ok).toBe(false);
    expect(out.error).toContain("ghost");
  });

  it("kicks off a partial run targeting the given node", async () => {
    const id = useWorkflowStore.getState().addNode("text", { x: 0, y: 0 });
    const tool = getTool("run_from")!;
    const out = (await tool.execute({ nodeId: id }, {})) as {
      ok: boolean;
      runId: number;
    };
    expect(out.ok).toBe(true);
    expect(out.runId).toBeGreaterThan(0);
    expect(runWorkflowMock).toHaveBeenCalledTimes(1);
  });

  it("rejects when a run is already in flight", async () => {
    const id = useWorkflowStore.getState().addNode("text", { x: 0, y: 0 });
    useExecutionStore.setState({ isRunning: true });
    const tool = getTool("run_from")!;
    const out = (await tool.execute({ nodeId: id }, {})) as {
      ok: boolean;
      error?: string;
    };
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/already in flight/i);
  });

  it("rejects empty nodeId", async () => {
    const tool = getTool("run_from")!;
    await expect(tool.execute({ nodeId: "" }, {})).rejects.toThrow();
  });
});

describe("cancel_run tool", () => {
  it("idempotent — no-op when nothing is running", async () => {
    const tool = getTool("cancel_run")!;
    const out = (await tool.execute({}, {})) as {
      ok: boolean;
      wasRunning: boolean;
    };
    expect(out.ok).toBe(true);
    expect(out.wasRunning).toBe(false);
  });

  it("aborts an in-flight run and reports wasRunning: true", async () => {
    useExecutionStore.setState({ isRunning: true });
    const tool = getTool("cancel_run")!;
    const out = (await tool.execute({}, {})) as {
      ok: boolean;
      wasRunning: boolean;
    };
    expect(out.ok).toBe(true);
    expect(out.wasRunning).toBe(true);
    expect(useExecutionStore.getState().isRunning).toBe(false);
  });

  it("rejects unknown args via strict Zod", async () => {
    const tool = getTool("cancel_run")!;
    await expect(
      tool.execute({ unexpected: 1 }, {}),
    ).rejects.toThrow();
  });
});
