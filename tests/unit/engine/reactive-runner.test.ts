import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import "@/lib/engine/all-nodes";

/**
 * 2026-06-03 — Tier 2 coverage for `reactive-runner.ts`.
 *
 * The reactive runner is the silent debounced background loop that
 * keeps reactive consumers (Array, List, Number, Iterators, Text,
 * Image) up to date as the user edits the canvas. Until now it had
 * zero direct tests — only indirect coverage via integration paths.
 *
 * What we pin here:
 *   - Subscriptions actually fire `runWorkflow` after a workflow-
 *     store mutation (debounced).
 *   - Multiple rapid mutations coalesce into ONE flush (debounce).
 *   - In-flight runs are aborted when a new mutation arrives mid-
 *     debounce window (no overlapping reactive runs).
 *   - Skip when `execution-store.isRunning` is true (user-initiated
 *     run wins).
 *   - Skip when recipe-edit mode is active (don't auto-run inside
 *     the recipe editor).
 *   - Falling edge `isRunning: true → false` triggers a flush
 *     (downstream reactive nodes re-derive after a full Run).
 *   - Empty-canvas guard.
 *
 * The engine's `runWorkflow` is mocked at the module boundary so we
 * verify call shape + signal handling without exercising the engine
 * itself.
 */

const runWorkflowMock = vi.hoisted(() =>
  vi.fn(async (..._args: unknown[]) => {
    void _args;
    // No-op default — resolves immediately so the post-flush bookkeeping
    // path (`finally` block) runs cleanly. Per-test overrides for race
    // / abort scenarios.
    return undefined;
  }),
);
vi.mock("@/lib/engine/run-workflow", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/engine/run-workflow")
  >("@/lib/engine/run-workflow");
  return {
    ...actual,
    runWorkflow: runWorkflowMock,
  };
});

const recipeEditActiveMock = vi.hoisted(() => vi.fn(() => false));
vi.mock("@/lib/stores/recipe-edit-store", () => ({
  isRecipeEditActive: recipeEditActiveMock,
  useRecipeEditStore: { getState: () => ({}) },
}));

const { startReactiveRunner } = await import(
  "@/lib/engine/reactive-runner"
);
const { useExecutionStore } = await import("@/lib/stores/execution-store");
const { useWorkflowStore } = await import("@/lib/stores/workflow-store");

// Tiny debounce so the tests don't sit on real timers.
const TEST_DEBOUNCE_MS = 5;
// Generous grace so flush + microtasks land before assertions.
const FLUSH_GRACE_MS = 30;

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

beforeEach(() => {
  runWorkflowMock.mockReset();
  runWorkflowMock.mockImplementation(async () => undefined);
  recipeEditActiveMock.mockReset();
  recipeEditActiveMock.mockReturnValue(false);
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
  vi.useRealTimers();
});

describe("reactive-runner", () => {
  it("debounces a single workflow mutation into one runWorkflow call", async () => {
    const stop = startReactiveRunner({ debounceMs: TEST_DEBOUNCE_MS });
    try {
      // Seed a node so the empty-canvas guard doesn't short-circuit.
      useWorkflowStore.getState().addNode("text", { x: 0, y: 0 });
      await sleep(FLUSH_GRACE_MS);
      expect(runWorkflowMock).toHaveBeenCalledTimes(1);
    } finally {
      stop();
    }
  });

  it("coalesces N rapid mutations within the debounce window into ONE run", async () => {
    const stop = startReactiveRunner({ debounceMs: TEST_DEBOUNCE_MS });
    try {
      const ws = useWorkflowStore.getState();
      ws.addNode("text", { x: 0, y: 0 });
      ws.addNode("text", { x: 100, y: 0 });
      ws.addNode("text", { x: 200, y: 0 });
      ws.addNode("text", { x: 300, y: 0 });
      ws.addNode("text", { x: 400, y: 0 });
      // Total wall-clock so far << debounce.
      await sleep(FLUSH_GRACE_MS);
      expect(runWorkflowMock).toHaveBeenCalledTimes(1);
    } finally {
      stop();
    }
  });

  it("skips the flush entirely when the user has a full run in flight", async () => {
    const stop = startReactiveRunner({ debounceMs: TEST_DEBOUNCE_MS });
    try {
      useExecutionStore.setState({ isRunning: true });
      useWorkflowStore.getState().addNode("text", { x: 0, y: 0 });
      await sleep(FLUSH_GRACE_MS);
      expect(runWorkflowMock).not.toHaveBeenCalled();
    } finally {
      stop();
    }
  });

  it("skips the flush when recipe-edit mode is active (don't auto-run inside the editor)", async () => {
    recipeEditActiveMock.mockReturnValue(true);
    const stop = startReactiveRunner({ debounceMs: TEST_DEBOUNCE_MS });
    try {
      useWorkflowStore.getState().addNode("text", { x: 0, y: 0 });
      await sleep(FLUSH_GRACE_MS);
      expect(runWorkflowMock).not.toHaveBeenCalled();
    } finally {
      stop();
    }
  });

  it("skips the flush when the canvas is empty (no nodes ⇒ nothing to react to)", async () => {
    const stop = startReactiveRunner({ debounceMs: TEST_DEBOUNCE_MS });
    try {
      // Direct setState without addNode so the workflow-store still emits
      // a change but the resulting state has zero nodes.
      useWorkflowStore.setState({ nodes: [] });
      await sleep(FLUSH_GRACE_MS);
      expect(runWorkflowMock).not.toHaveBeenCalled();
    } finally {
      stop();
    }
  });

  it("triggers a flush on the isRunning true→false falling edge (post-Run reactive refresh)", async () => {
    const stop = startReactiveRunner({ debounceMs: TEST_DEBOUNCE_MS });
    try {
      useWorkflowStore.getState().addNode("text", { x: 0, y: 0 });
      await sleep(FLUSH_GRACE_MS);
      runWorkflowMock.mockClear();
      // Simulate user-initiated run lifecycle.
      useExecutionStore.setState({ isRunning: true });
      await sleep(2);
      // Mutating workflow during a run is gated by the isRunning skip; clear
      // any residual debounce that might have queued.
      useExecutionStore.setState({ isRunning: false });
      await sleep(FLUSH_GRACE_MS);
      expect(runWorkflowMock).toHaveBeenCalledTimes(1);
    } finally {
      stop();
    }
  });

  it("aborts an in-flight reactive run when a new mutation arrives mid-flush", async () => {
    let abortedSignal: AbortSignal | null = null;
    runWorkflowMock.mockImplementationOnce((...args: unknown[]) => {
      // Capture the signal so the second mutation can abort us.
      abortedSignal = (args[0] as { signal?: AbortSignal }).signal ?? null;
      return new Promise<undefined>((resolve, reject) => {
        const onAbort = () => {
          abortedSignal?.removeEventListener("abort", onAbort);
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        };
        abortedSignal?.addEventListener("abort", onAbort);
        // Stay pending so the second flush has time to fire.
        setTimeout(() => resolve(undefined), 1000);
      });
    });
    const stop = startReactiveRunner({ debounceMs: TEST_DEBOUNCE_MS });
    try {
      useWorkflowStore.getState().addNode("text", { x: 0, y: 0 });
      await sleep(FLUSH_GRACE_MS); // first flush in flight
      // Mutate again — second flush should abort the first.
      useWorkflowStore.getState().addNode("text", { x: 100, y: 0 });
      await sleep(FLUSH_GRACE_MS);
      // TS narrows abortedSignal back to null inside the callback closure.
      // Cast through unknown for the post-await read.
      const captured = abortedSignal as unknown as AbortSignal | null;
      expect(captured?.aborted).toBe(true);
      expect(runWorkflowMock).toHaveBeenCalledTimes(2);
    } finally {
      stop();
    }
  });

  it("the unsubscribe cleanup stops further flushes after teardown", async () => {
    const stop = startReactiveRunner({ debounceMs: TEST_DEBOUNCE_MS });
    useWorkflowStore.getState().addNode("text", { x: 0, y: 0 });
    await sleep(FLUSH_GRACE_MS);
    expect(runWorkflowMock).toHaveBeenCalledTimes(1);
    stop();
    runWorkflowMock.mockClear();
    useWorkflowStore.getState().addNode("text", { x: 100, y: 0 });
    await sleep(FLUSH_GRACE_MS);
    expect(runWorkflowMock).not.toHaveBeenCalled();
  });

  it("seeds prevOutputs from execution-store records (bridges non-reactive results)", async () => {
    // Pretend an LLM (non-reactive) produced output during the last Run.
    useExecutionStore.setState({
      records: new Map([
        [
          "llm_n1",
          {
            status: "done" as const,
            output: { type: "text" as const, value: "from LLM" },
          },
        ],
        [
          "llm_n2",
          {
            status: "cached" as const,
            output: { type: "text" as const, value: "cached" },
          },
        ],
        // pending status — NOT bridged (no usable output yet).
        [
          "running_n3",
          {
            status: "running" as const,
          },
        ],
      ]),
    });
    const stop = startReactiveRunner({ debounceMs: TEST_DEBOUNCE_MS });
    try {
      useWorkflowStore.getState().addNode("text", { x: 0, y: 0 });
      await sleep(FLUSH_GRACE_MS);
      expect(runWorkflowMock).toHaveBeenCalledTimes(1);
      const args = runWorkflowMock.mock.calls[0]![0] as unknown as {
        prevOutputs: Map<string, unknown>;
        mode: string;
      };
      // Done + cached are bridged; running is skipped.
      expect(args.prevOutputs.has("llm_n1")).toBe(true);
      expect(args.prevOutputs.has("llm_n2")).toBe(true);
      expect(args.prevOutputs.has("running_n3")).toBe(false);
      expect(args.mode).toBe("reactive-only");
    } finally {
      stop();
    }
  });
});
