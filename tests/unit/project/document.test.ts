import { beforeEach, describe, expect, it } from "vitest";

import {
  applyProjectDocument,
  executionStateToRecords,
  migrateProjectDocument,
  type ProjectDocument,
  serializeExecutionState,
  serializeProject,
} from "@/lib/project/document";
import { useAssetStore } from "@/lib/stores/asset-store";
import {
  _resetExecutionForTests,
  useExecutionStore,
} from "@/lib/stores/execution-store";
import { useLayoutStore } from "@/lib/stores/layout-store";
import { useProjectStore } from "@/lib/stores/project-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import type { ExecutionRecord, StandardizedOutput } from "@/types/node";

function img(url: string): StandardizedOutput {
  return { type: "image", value: { url } };
}

beforeEach(() => {
  _resetExecutionForTests();
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
  useLayoutStore.setState({
    libraryOpen: true,
    queueOpen: false,
    chatSheetOpen: false,
    approvalGateOn: false,
  });
  useProjectStore.setState({ id: null, name: "Untitled Project" });
});

describe("serializeExecutionState", () => {
  it("captures done/cached records with output, drops transient + caps history", () => {
    const records = new Map<string, ExecutionRecord>([
      [
        "gen",
        {
          status: "done",
          output: img("a.png"),
          usage: { model: "x" },
          elapsedMs: 1200,
          hash: "deadbeef",
          history: [
            { output: img("a.png"), runId: 1, timestamp: 1 },
          ],
        },
      ],
      // running record (no output) → excluded.
      ["pending", { status: "running" }],
      // error → excluded.
      ["bad", { status: "error", error: "boom" }],
    ]);
    useExecutionStore.setState({ records });
    // All record keys must exist as live nodes (else they're pruned as orphans).
    useWorkflowStore.setState({
      nodes: [
        { id: "gen", kind: "fal-image", position: { x: 0, y: 0 }, config: {} },
        { id: "pending", kind: "fal-image", position: { x: 0, y: 0 }, config: {} },
        { id: "bad", kind: "fal-image", position: { x: 0, y: 0 }, config: {} },
      ],
      edges: [],
      selectedNodeIds: [],
      selectedEdgeIds: [],
    });

    const state = serializeExecutionState();
    expect(Object.keys(state)).toEqual(["gen"]);
    expect(state.gen!.output).toEqual(img("a.png"));
    expect(state.gen!.usage).toEqual({ model: "x" });
    expect(state.gen!.elapsedMs).toBe(1200);
    expect(state.gen!.history).toHaveLength(1);
    // Transient `hash`/`status` not part of the serialized shape.
    expect(
      (state.gen as unknown as Record<string, unknown>).hash,
    ).toBeUndefined();
  });

  it("never loses a result: keeps the last good output even when the node later errors", () => {
    useExecutionStore.setState({
      records: new Map<string, ExecutionRecord>([
        // Re-run errored, but a prior good generation lives in history.
        [
          "gen",
          {
            status: "error",
            error: "Fal hiccup",
            history: [
              { output: img("good.png"), usage: { model: "m" }, runId: 1, timestamp: 1 },
            ],
          },
        ],
      ]),
    });
    useWorkflowStore.setState({
      nodes: [
        { id: "gen", kind: "fal-image", position: { x: 0, y: 0 }, config: {} },
      ],
      edges: [],
      selectedNodeIds: [],
      selectedEdgeIds: [],
    });

    const state = serializeExecutionState();
    // Persisted from the last history entry, not dropped.
    expect(state.gen!.output).toEqual(img("good.png"));
    expect(state.gen!.history).toHaveLength(1);
  });

  it("prunes orphan records left by deleted nodes (bounds growth)", () => {
    useExecutionStore.setState({
      records: new Map<string, ExecutionRecord>([
        ["live", { status: "done", output: img("live.png") }],
        ["orphan", { status: "cached", output: img("orphan.png") }],
      ]),
    });
    // Only `live` is still in the graph; `orphan` was deleted.
    useWorkflowStore.setState({
      nodes: [
        { id: "live", kind: "fal-image", position: { x: 0, y: 0 }, config: {} },
      ],
      edges: [],
      selectedNodeIds: [],
      selectedEdgeIds: [],
    });

    const state = serializeExecutionState();
    expect(Object.keys(state)).toEqual(["live"]);
  });
});

describe("executionStateToRecords", () => {
  it("rebuilds records as `cached` (replay, not a fresh generation)", () => {
    const records = executionStateToRecords({
      gen: { output: img("a.png"), usage: { model: "x" } },
    });
    const rec = records.get("gen");
    expect(rec?.status).toBe("cached");
    expect(rec?.output).toEqual(img("a.png"));
    expect(rec?.usage).toEqual({ model: "x" });
  });

  it("returns an empty map for undefined state", () => {
    expect(executionStateToRecords(undefined).size).toBe(0);
  });
});

describe("serializeProject / applyProjectDocument round-trip", () => {
  it("restores workflow, layout, name, and node results", () => {
    useWorkflowStore.setState({
      nodes: [
        { id: "t1", kind: "text", position: { x: 0, y: 0 }, config: { text: "hi" } },
        { id: "g1", kind: "fal-image", position: { x: 0, y: 0 }, config: {} },
      ],
      edges: [],
      selectedNodeIds: [],
      selectedEdgeIds: [],
    });
    useLayoutStore.setState({
      libraryOpen: false,
      queueOpen: true,
      chatSheetOpen: false,
      approvalGateOn: true,
    });
    useProjectStore.setState({ id: "p1", name: "My Project" });
    useExecutionStore.setState({
      records: new Map<string, ExecutionRecord>([
        ["g1", { status: "done", output: img("r.png") }],
      ]),
    });

    const doc = serializeProject();
    expect(doc.projectName).toBe("My Project");
    expect(doc.workflow.nodes).toHaveLength(2);
    expect(doc.executionState?.g1?.output).toEqual(img("r.png"));

    // Wipe everything, then re-apply the document.
    _resetExecutionForTests();
    useWorkflowStore.setState({
      nodes: [],
      edges: [],
      selectedNodeIds: [],
      selectedEdgeIds: [],
    });
    useProjectStore.setState({ id: "p1", name: "Untitled Project" });

    applyProjectDocument(doc);

    expect(useWorkflowStore.getState().nodes).toHaveLength(2);
    expect(useLayoutStore.getState().queueOpen).toBe(true);
    expect(useProjectStore.getState().name).toBe("My Project");
    const rec = useExecutionStore.getState().getRecord("g1");
    // Rehydrated as cached so generation-sync skips it (no duplicate row).
    expect(rec?.status).toBe("cached");
    expect(rec?.output).toEqual(img("r.png"));
  });
});

describe("migrateProjectDocument", () => {
  it("fills safe defaults for a legacy/partial payload", () => {
    const migrated = migrateProjectDocument({
      version: 1,
      workflow: { nodes: [{ id: "a" }], edges: [] },
    } as Partial<ProjectDocument> as ProjectDocument);
    expect(migrated.projectName).toBe("Untitled Project");
    expect(migrated.assets).toEqual([]);
    expect(migrated.layout.libraryOpen).toBe(true);
    expect(migrated.workflow.nodes).toHaveLength(1);
  });

  it("tolerates an empty object", () => {
    const migrated = migrateProjectDocument({} as ProjectDocument);
    expect(migrated.workflow.nodes).toEqual([]);
    expect(migrated.layout.queueOpen).toBe(false);
  });
});
