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
});
