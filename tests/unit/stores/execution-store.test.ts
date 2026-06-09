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

  /* ─── Phase 1 — startRunNode (surgical "run only this node") ─── */

  describe("startRunNode", () => {
    it("reuses upstream's recorded output and does NOT re-run it", async () => {
      // text(A) → list(B). After a full run, A.output = "hi". Mutate A's
      // config; running ONLY B must reuse A's recorded "hi" (A not
      // re-executed) so B still sees "hi", not the mutated value.
      const a = useWorkflowStore
        .getState()
        .addNode("text", { x: 0, y: 0 }, { text: "hi" });
      const b = useWorkflowStore.getState().addNode("list", { x: 0, y: 0 });
      useWorkflowStore.getState().addEdge({
        source: a,
        sourceHandle: "out",
        target: b,
        targetHandle: "items",
      });

      await useExecutionStore.getState().startRun();
      expect(useExecutionStore.getState().getRecord(a)?.status).toBe("done");

      // Mutate the upstream — if A re-ran, B would see "changed".
      useWorkflowStore.getState().updateNodeConfig(a, { text: "changed" });

      await useExecutionStore.getState().startRunNode(b);

      const recA = useExecutionStore.getState().getRecord(a);
      const recB = useExecutionStore.getState().getRecord(b);
      // A reused verbatim (cached), still "hi" — never re-executed.
      expect(recA?.status).toBe("cached");
      expect((recA?.output as StandardizedOutput).value).toBe("hi");
      // B re-ran and consumed the reused upstream output.
      expect(recB?.status).toBe("done");
      expect((recB?.output as StandardizedOutput).value).toBe("hi");
    });

    it("runs an empty upstream on demand (dependency the target needs)", async () => {
      // text(A) → list(B) but NOTHING has run yet, so A has no recorded
      // output. startRunNode(B) must run A on demand so B has its input.
      const a = useWorkflowStore
        .getState()
        .addNode("text", { x: 0, y: 0 }, { text: "fresh" });
      const b = useWorkflowStore.getState().addNode("list", { x: 0, y: 0 });
      useWorkflowStore.getState().addEdge({
        source: a,
        sourceHandle: "out",
        target: b,
        targetHandle: "items",
      });

      await useExecutionStore.getState().startRunNode(b);

      expect(useExecutionStore.getState().getRecord(a)?.status).toBe("done");
      expect(
        (useExecutionStore.getState().getRecord(b)?.output as StandardizedOutput)
          .value,
      ).toBe("fresh");
    });
  });

  describe("history ring buffer (Slice 5.8)", () => {
    it("appends a history entry on every `done` record (no cap — Slice 6.6)", async () => {
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
      // A full Run now ACCUMULATES history (never wipes results) — so the
      // second run appends rather than resetting.
      expect(rec?.history).toHaveLength(2);
      const vals = rec!.history!.map((h) =>
        !Array.isArray(h.output) && h.output.type === "text"
          ? h.output.value
          : null,
      );
      expect(vals).toEqual(["v0", "v1"]);
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

    it("history grows past the legacy cap of 10 (Slice 6.6 — unlimited)", async () => {
      // Old behavior: HISTORY_CAP = 10, history.slice(-10) trimmed older
      // entries. New behavior: HISTORY_CAP = Infinity, so 15 distinct runs
      // accumulate 15 entries with the oldest still present at index 0.
      const textId = useWorkflowStore
        .getState()
        .addNode("text", { x: 0, y: 0 }, { text: "v0" });
      for (let i = 0; i < 15; i++) {
        useWorkflowStore
          .getState()
          .updateNodeConfig(textId, { text: `v${i}` });
        await useExecutionStore.getState().startRun();
      }
      const rec = useExecutionStore.getState().getRecord(textId);
      expect(rec?.history).toHaveLength(15);
      const first = rec!.history![0]!.output;
      const last = rec!.history![14]!.output;
      expect(
        !Array.isArray(first) && first.type === "text" ? first.value : null,
      ).toBe("v0");
      expect(
        !Array.isArray(last) && last.type === "text" ? last.value : null,
      ).toBe("v14");
      // Cursor auto-tracks the freshest run.
      expect(rec?.cursorIndex).toBe(14);
    });
  });

  /* ─── History cursor (canonical state, picks per-entry as output) ─── */

  describe("setHistoryCursor", () => {
    it("mirrors the selected history entry into record.output and bumps cursorIndex", async () => {
      const textId = useWorkflowStore
        .getState()
        .addNode("text", { x: 0, y: 0 }, { text: "v0" });

      await useExecutionStore.getState().startRun();
      useWorkflowStore.getState().updateNodeConfig(textId, { text: "v1" });
      await useExecutionStore.getState().startRun();
      useWorkflowStore.getState().updateNodeConfig(textId, { text: "v2" });
      await useExecutionStore.getState().startRun();

      const rec0 = useExecutionStore.getState().getRecord(textId);
      expect(rec0?.history).toHaveLength(3);
      // Auto-bumps cursor to latest after each run.
      expect(rec0?.cursorIndex).toBe(2);
      expect((rec0!.output as StandardizedOutput).value).toBe("v2");

      // Pick history entry 0 — record.output mirrors it.
      useExecutionStore.getState().setHistoryCursor(textId, 0);
      const rec1 = useExecutionStore.getState().getRecord(textId);
      expect(rec1?.cursorIndex).toBe(0);
      expect((rec1!.output as StandardizedOutput).value).toBe("v0");
    });

    it("clamps out-of-range indices instead of throwing", async () => {
      const textId = useWorkflowStore
        .getState()
        .addNode("text", { x: 0, y: 0 }, { text: "v0" });
      await useExecutionStore.getState().startRun();
      useExecutionStore.getState().setHistoryCursor(textId, 99);
      const rec = useExecutionStore.getState().getRecord(textId);
      expect(rec?.cursorIndex).toBe(0); // history.length - 1 with one entry
    });

    it("flows the cursor-selected upstream output into a downstream surgical run (regression)", async () => {
      // The bug: navigating an upstream node's history cursor to an OLDER
      // entry, then clicking Run on the downstream, used the LATEST output
      // anyway. After this fix, the surgical run must see exactly what the
      // user has selected in the body.
      const a = useWorkflowStore
        .getState()
        .addNode("text", { x: 0, y: 0 }, { text: "alpha" });
      const b = useWorkflowStore.getState().addNode("list", { x: 0, y: 0 });
      useWorkflowStore.getState().addEdge({
        source: a,
        sourceHandle: "out",
        target: b,
        targetHandle: "items",
      });

      // Build up 3 entries on A (alpha, beta, gamma).
      await useExecutionStore.getState().startRun();
      useWorkflowStore.getState().updateNodeConfig(a, { text: "beta" });
      await useExecutionStore.getState().startRun();
      useWorkflowStore.getState().updateNodeConfig(a, { text: "gamma" });
      await useExecutionStore.getState().startRun();

      const recA = useExecutionStore.getState().getRecord(a);
      expect(recA?.history).toHaveLength(3);

      // User scrolls A's cursor back to entry[0] (alpha).
      useExecutionStore.getState().setHistoryCursor(a, 0);
      // User runs B surgically — must consume "alpha", not "gamma".
      await useExecutionStore.getState().startRunNode(b);
      const recB = useExecutionStore.getState().getRecord(b);
      expect((recB?.output as StandardizedOutput).value).toBe("alpha");

      // Now cursor at entry[1] (beta) and re-run B — cache must NOT alias
      // back to the alpha result; downstream must re-execute with beta.
      useExecutionStore.getState().setHistoryCursor(a, 1);
      await useExecutionStore.getState().startRunNode(b);
      const recB2 = useExecutionStore.getState().getRecord(b);
      expect((recB2?.output as StandardizedOutput).value).toBe("beta");

      // Move back to entry[0] (alpha) again. Same per-entry seed hash as
      // the first run → expected cache hit returning "alpha".
      useExecutionStore.getState().setHistoryCursor(a, 0);
      await useExecutionStore.getState().startRunNode(b);
      const recB3 = useExecutionStore.getState().getRecord(b);
      expect((recB3?.output as StandardizedOutput).value).toBe("alpha");
    });
  });
});
