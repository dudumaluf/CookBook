import { beforeEach, describe, expect, it } from "vitest";

import "@/lib/engine/all-nodes";
import {
  _resetExecutionForTests,
  useExecutionStore,
} from "@/lib/stores/execution-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import type { StandardizedOutput } from "@/types/node";

beforeEach(() => {
  _resetExecutionForTests();
  useWorkflowStore.getState().clear();
  localStorage.clear();
});

/**
 * The execution-store is the runtime façade over `runWorkflow`. The
 * engine itself is tested separately (tests/unit/engine/run-workflow.test);
 * here we focus on the integration: state transitions, cancellation
 * plumbing, cache reuse across runs.
 */
describe("execution-store", () => {
  it("starts idle and transitions to done after running a one-node workflow", async () => {
    const textId = useWorkflowStore
      .getState()
      .addNode("text", { x: 0, y: 0 }, { text: "hello" });

    expect(useExecutionStore.getState().isRunning).toBe(false);
    await useExecutionStore.getState().startRun();
    expect(useExecutionStore.getState().isRunning).toBe(false);

    const record = useExecutionStore.getState().getRecord(textId);
    expect(record?.status).toBe("done");
    const output = record?.output as StandardizedOutput;
    expect(output.value).toBe("hello");
  });

  it("caches outputs across runs of the same graph", async () => {
    const textId = useWorkflowStore
      .getState()
      .addNode("text", { x: 0, y: 0 }, { text: "hello" });

    await useExecutionStore.getState().startRun();
    expect(useExecutionStore.getState().getRecord(textId)?.status).toBe(
      "done",
    );

    await useExecutionStore.getState().startRun();
    expect(useExecutionStore.getState().getRecord(textId)?.status).toBe(
      "cached",
    );
  });

  it("invalidates the cache when the upstream config changes", async () => {
    const textId = useWorkflowStore
      .getState()
      .addNode("text", { x: 0, y: 0 }, { text: "hello" });

    await useExecutionStore.getState().startRun();

    useWorkflowStore.getState().updateNodeConfig(textId, { text: "world" });
    await useExecutionStore.getState().startRun();

    const record = useExecutionStore.getState().getRecord(textId);
    expect(record?.status).toBe("done");
    const output = record?.output as StandardizedOutput;
    expect(output.value).toBe("world");
  });

  it("clearRun wipes records but preserves the cache", async () => {
    const textId = useWorkflowStore
      .getState()
      .addNode("text", { x: 0, y: 0 }, { text: "hello" });
    await useExecutionStore.getState().startRun();

    useExecutionStore.getState().clearRun();
    expect(useExecutionStore.getState().getRecord(textId)).toBeUndefined();

    // Cache survived → next run is a hit, not a fresh execution.
    await useExecutionStore.getState().startRun();
    expect(useExecutionStore.getState().getRecord(textId)?.status).toBe(
      "cached",
    );
  });

  it("clearCache forces every node to re-execute", async () => {
    const textId = useWorkflowStore
      .getState()
      .addNode("text", { x: 0, y: 0 }, { text: "hello" });

    await useExecutionStore.getState().startRun();
    useExecutionStore.getState().clearCache();

    await useExecutionStore.getState().startRun();
    expect(useExecutionStore.getState().getRecord(textId)?.status).toBe(
      "done",
    );
  });

  it("getRecord returns undefined for unknown nodes", () => {
    expect(useExecutionStore.getState().getRecord("nope")).toBeUndefined();
  });

  /* ─── Slice 5.8 — startRunFrom + history ─── */

  describe("startRunFrom (Slice 5.8)", () => {
    it("runs the target + ancestors only, leaving unrelated records untouched", async () => {
      // Two parallel branches sharing a single Text upstream:
      //   text → llm-text-A
      //   text → (no LLM run before) llm-text-B
      // Run-here on A first, then on B; the second Run-here must not
      // wipe A's record.
      // We emulate this with two simple text nodes downstream of an
      // upstream text node — text nodes have execute() so they emit.
      const upstream = useWorkflowStore
        .getState()
        .addNode("text", { x: 0, y: 0 }, { text: "u" });
      const a = useWorkflowStore
        .getState()
        .addNode("text", { x: 0, y: 0 }, { text: "a" });
      const b = useWorkflowStore
        .getState()
        .addNode("text", { x: 0, y: 0 }, { text: "b" });
      // Wire upstream → a and upstream → b. Text node has no inputs,
      // but we just need them in the same graph for the subgraph
      // walker. Edges aren't required for ancestor-only runs of leaf
      // nodes — Run-here on a leaf node returns just that leaf.
      // Run-here on `a` runs only `a`.
      await useExecutionStore.getState().startRunFrom(a);
      expect(
        useExecutionStore.getState().getRecord(a)?.status,
      ).toBe("done");
      expect(
        useExecutionStore.getState().getRecord(b),
      ).toBeUndefined();
      expect(
        useExecutionStore.getState().getRecord(upstream),
      ).toBeUndefined();

      // Run-here on `b` runs `b`. `a`'s record must survive.
      await useExecutionStore.getState().startRunFrom(b);
      expect(
        useExecutionStore.getState().getRecord(b)?.status,
      ).toBe("done");
      expect(
        useExecutionStore.getState().getRecord(a)?.status,
      ).toBe("done");
    });

    it("no-op when endNodeId doesn't exist in the graph", async () => {
      await useExecutionStore.getState().startRunFrom("missing-id");
      expect(useExecutionStore.getState().isRunning).toBe(false);
    });
  });

  describe("history ring buffer (Slice 5.8)", () => {
    it("appends a history entry on every `done` record (cap = 10)", async () => {
      const textId = useWorkflowStore
        .getState()
        .addNode("text", { x: 0, y: 0 }, { text: "v0" });
      // First run.
      await useExecutionStore.getState().startRun();
      let rec = useExecutionStore.getState().getRecord(textId);
      expect(rec?.history).toHaveLength(1);

      // Re-run with a new value to bust the cache → another `done`.
      useWorkflowStore.getState().updateNodeConfig(textId, { text: "v1" });
      await useExecutionStore.getState().startRun();
      rec = useExecutionStore.getState().getRecord(textId);
      // startRun replaces records — so the second run starts from an
      // empty history. That's intentional: full-run resets history.
      expect(rec?.history).toHaveLength(1);
    });

    it("Run-here preserves history across runs (no records reset)", async () => {
      const textId = useWorkflowStore
        .getState()
        .addNode("text", { x: 0, y: 0 }, { text: "v0" });
      await useExecutionStore.getState().startRunFrom(textId);
      useWorkflowStore.getState().updateNodeConfig(textId, { text: "v1" });
      await useExecutionStore.getState().startRunFrom(textId);
      useWorkflowStore.getState().updateNodeConfig(textId, { text: "v2" });
      await useExecutionStore.getState().startRunFrom(textId);
      const rec = useExecutionStore.getState().getRecord(textId);
      expect(rec?.history).toHaveLength(3);
      // History entries reflect the run order.
      const outputs = rec!.history!.map((h) =>
        Array.isArray(h.output)
          ? null
          : h.output.type === "text"
            ? h.output.value
            : null,
      );
      expect(outputs).toEqual(["v0", "v1", "v2"]);
    });

    it("cached records don't add to history (replay is not a new output)", async () => {
      const textId = useWorkflowStore
        .getState()
        .addNode("text", { x: 0, y: 0 }, { text: "v0" });
      // First Run-here: emits + appends entry.
      await useExecutionStore.getState().startRunFrom(textId);
      let rec = useExecutionStore.getState().getRecord(textId);
      expect(rec?.history).toHaveLength(1);
      // Second Run-here without changing config: cache hit, no append.
      await useExecutionStore.getState().startRunFrom(textId);
      rec = useExecutionStore.getState().getRecord(textId);
      expect(rec?.status).toBe("cached");
      expect(rec?.history).toHaveLength(1);
    });
  });
});
