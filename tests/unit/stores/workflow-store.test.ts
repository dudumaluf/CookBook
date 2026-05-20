import { beforeEach, describe, expect, it } from "vitest";

import "@/lib/engine/all-nodes";
import { useWorkflowStore } from "@/lib/stores/workflow-store";

beforeEach(() => {
  useWorkflowStore.getState().clear();
  localStorage.clear();
});

describe("workflow-store", () => {
  it("addNode creates a node with default config from the registry", () => {
    const id = useWorkflowStore.getState().addNode("text", { x: 10, y: 20 });
    const node = useWorkflowStore.getState().nodes[0];
    expect(id).toMatch(/^text_/);
    expect(node?.kind).toBe("text");
    expect(node?.position).toEqual({ x: 10, y: 20 });
    expect(node?.config).toEqual({ text: "" });
  });

  it("addNode returns empty string for unknown kinds", () => {
    const id = useWorkflowStore.getState().addNode("does-not-exist", {
      x: 0,
      y: 0,
    });
    expect(id).toBe("");
    expect(useWorkflowStore.getState().nodes).toHaveLength(0);
  });

  it("addNode merges initialConfig over the schema's defaultConfig", () => {
    const id = useWorkflowStore.getState().addNode(
      "image",
      { x: 0, y: 0 },
      { url: "https://example.com/cat.jpg", assetId: "asset_abc" },
    );
    expect(useWorkflowStore.getState().nodes[0]?.config).toEqual({
      url: "https://example.com/cat.jpg",
      assetId: "asset_abc",
    });
    expect(id).toMatch(/^image_/);
  });

  it("updateNodeConfig merges partial config", () => {
    const id = useWorkflowStore.getState().addNode("text", { x: 0, y: 0 });
    useWorkflowStore
      .getState()
      .updateNodeConfig<{ text: string }>(id, { text: "hello" });
    expect(useWorkflowStore.getState().nodes[0]?.config).toEqual({
      text: "hello",
    });
  });

  it("moveNode updates position only", () => {
    const id = useWorkflowStore.getState().addNode("text", { x: 0, y: 0 });
    useWorkflowStore.getState().moveNode(id, { x: 100, y: 50 });
    expect(useWorkflowStore.getState().nodes[0]?.position).toEqual({
      x: 100,
      y: 50,
    });
  });

  it("removeNode also removes connected edges", () => {
    const a = useWorkflowStore.getState().addNode("text", { x: 0, y: 0 });
    const b = useWorkflowStore.getState().addNode("image", { x: 0, y: 0 });
    useWorkflowStore.getState().addEdge({
      source: a,
      sourceHandle: "out",
      target: b,
      targetHandle: "in",
    });
    expect(useWorkflowStore.getState().edges).toHaveLength(1);
    useWorkflowStore.getState().removeNode(a);
    expect(useWorkflowStore.getState().edges).toHaveLength(0);
  });

  it("addEdge rejects self-loops", () => {
    const id = useWorkflowStore.getState().addNode("text", { x: 0, y: 0 });
    const eid = useWorkflowStore.getState().addEdge({
      source: id,
      sourceHandle: "out",
      target: id,
      targetHandle: "in",
    });
    expect(eid).toBeUndefined();
  });

  describe("renameNode", () => {
    it("sets a trimmed label on a node", () => {
      const id = useWorkflowStore.getState().addNode("text", { x: 0, y: 0 });
      useWorkflowStore.getState().renameNode(id, "  Mood  ");
      expect(useWorkflowStore.getState().nodes[0]?.label).toBe("Mood");
    });

    it("clears the label when given empty/whitespace/undefined", () => {
      const id = useWorkflowStore.getState().addNode("text", { x: 0, y: 0 });
      useWorkflowStore.getState().renameNode(id, "Mood");
      useWorkflowStore.getState().renameNode(id, "   ");
      expect(useWorkflowStore.getState().nodes[0]?.label).toBeUndefined();

      useWorkflowStore.getState().renameNode(id, "Mood again");
      useWorkflowStore.getState().renameNode(id, undefined);
      expect(useWorkflowStore.getState().nodes[0]?.label).toBeUndefined();
    });

    it("renameNode on a missing id is a no-op (no throw)", () => {
      useWorkflowStore.getState().renameNode("nope", "anything");
      expect(useWorkflowStore.getState().nodes).toHaveLength(0);
    });
  });

  describe("resizeNode (ADR-0028 — per-instance user-resized dimensions)", () => {
    it("sets width and height, rounded to integer", () => {
      const id = useWorkflowStore.getState().addNode("text", { x: 0, y: 0 });
      useWorkflowStore
        .getState()
        .resizeNode(id, { width: 380.6, height: 220.2 });
      expect(useWorkflowStore.getState().nodes[0]?.size).toEqual({
        width: 381,
        height: 220,
      });
    });

    it("accepts width-only (axis-locked horizontal resize)", () => {
      const id = useWorkflowStore.getState().addNode("image", { x: 0, y: 0 });
      useWorkflowStore.getState().resizeNode(id, { width: 460 });
      expect(useWorkflowStore.getState().nodes[0]?.size).toEqual({
        width: 460,
      });
    });

    it("accepts height-only (axis-locked vertical resize)", () => {
      const id = useWorkflowStore.getState().addNode("text", { x: 0, y: 0 });
      useWorkflowStore.getState().resizeNode(id, { height: 320 });
      expect(useWorkflowStore.getState().nodes[0]?.size).toEqual({
        height: 320,
      });
    });

    it("clearing via undefined size strips the field entirely from the instance", () => {
      const id = useWorkflowStore.getState().addNode("text", { x: 0, y: 0 });
      useWorkflowStore
        .getState()
        .resizeNode(id, { width: 400, height: 200 });
      useWorkflowStore.getState().resizeNode(id, undefined);
      const n = useWorkflowStore.getState().nodes[0]!;
      expect(n.size).toBeUndefined();
      expect("size" in n).toBe(false);
    });

    it("clearing via an empty {} (both axes undefined) also strips the field", () => {
      const id = useWorkflowStore.getState().addNode("text", { x: 0, y: 0 });
      useWorkflowStore.getState().resizeNode(id, { width: 400 });
      useWorkflowStore.getState().resizeNode(id, {});
      const n = useWorkflowStore.getState().nodes[0]!;
      expect(n.size).toBeUndefined();
      expect("size" in n).toBe(false);
    });

    it("is a no-op when the same dimensions are emitted twice (avoids render churn)", () => {
      // React Flow re-emits the same rounded dims on every drag move.
      // The store should preserve referential equality of the node so
      // downstream selectors don't re-run unnecessarily.
      const id = useWorkflowStore.getState().addNode("text", { x: 0, y: 0 });
      useWorkflowStore
        .getState()
        .resizeNode(id, { width: 400, height: 200 });
      const before = useWorkflowStore.getState().nodes[0]!;
      useWorkflowStore
        .getState()
        .resizeNode(id, { width: 400.3, height: 200.4 });
      const after = useWorkflowStore.getState().nodes[0]!;
      expect(after).toBe(before);
    });

    it("resizeNode on a missing id is a no-op (no throw)", () => {
      useWorkflowStore
        .getState()
        .resizeNode("nope", { width: 400, height: 200 });
      expect(useWorkflowStore.getState().nodes).toHaveLength(0);
    });
  });

  describe("v6 migrate (NodeInstance.size — ADR-0028)", () => {
    it("preserves valid size on a node (positive finite numbers, rounded to int)", () => {
      const migrated = useWorkflowStore.persist.getOptions().migrate?.(
        {
          nodes: [
            {
              id: "n1",
              kind: "text",
              position: { x: 0, y: 0 },
              config: { text: "hi" },
              size: { width: 380.7, height: 220.2 },
            },
          ],
          edges: [],
        },
        5,
      ) as { nodes: { id: string; size?: { width?: number; height?: number } }[] };
      expect(migrated.nodes[0]?.size).toEqual({ width: 381, height: 220 });
    });

    it("strips out-of-range size dimensions (zero, negative, NaN, Infinity, non-number)", () => {
      const make = (size: unknown) =>
        useWorkflowStore.persist.getOptions().migrate?.(
          {
            nodes: [
              {
                id: "n1",
                kind: "text",
                position: { x: 0, y: 0 },
                config: { text: "" },
                size,
              },
            ],
            edges: [],
          },
          5,
        ) as { nodes: { id: string; size?: { width?: number; height?: number } }[] };

      // Each axis is sanitized independently.
      expect(make({ width: 0, height: 200 }).nodes[0]?.size).toEqual({
        height: 200,
      });
      expect(make({ width: -10, height: 200 }).nodes[0]?.size).toEqual({
        height: 200,
      });
      expect(make({ width: Number.NaN, height: 200 }).nodes[0]?.size).toEqual({
        height: 200,
      });
      expect(
        make({ width: Number.POSITIVE_INFINITY, height: 200 }).nodes[0]?.size,
      ).toEqual({ height: 200 });
      expect(make({ width: "380", height: 200 }).nodes[0]?.size).toEqual({
        height: 200,
      });

      // All-bad → size field stripped entirely.
      const empty = make({ width: 0, height: -1 });
      expect(empty.nodes[0]?.size).toBeUndefined();
      expect("size" in empty.nodes[0]!).toBe(false);
    });

    it("is idempotent on a v6 payload (already-clean size passes through)", () => {
      const payload = {
        nodes: [
          {
            id: "n1",
            kind: "text",
            position: { x: 0, y: 0 },
            config: { text: "" },
            size: { width: 380, height: 220 },
          },
        ],
        edges: [],
      };
      const migrated = useWorkflowStore.persist.getOptions().migrate?.(
        payload,
        6,
      ) as { nodes: { size: { width: number; height: number } }[] };
      expect(migrated.nodes[0]?.size).toEqual({ width: 380, height: 220 });
    });
  });

  describe("v* → v5 migrate (LLM Text config: model + optional temperature/maxTokens/reasoning)", () => {
    // v5 (ADR-0026) adds optional temperature/maxTokens/reasoning. v4
    // collapsed user/system to input handles. The migration is idempotent
    // and tolerates payloads from any earlier version (v1/v2 had `prompt`,
    // v3 had `user`/`system`, v4 had just `model`).
    it("strips `prompt` from a v1/v2 llm-text config, keeping `model`", () => {
      const migrated = useWorkflowStore.persist.getOptions().migrate?.(
        {
          nodes: [
            {
              id: "llm_v2",
              kind: "llm-text",
              position: { x: 0, y: 0 },
              config: {
                prompt: "old prompt body",
                model: "anthropic/claude-sonnet-4.5",
              },
            },
            {
              id: "text_old",
              kind: "text",
              position: { x: 0, y: 0 },
              config: { text: "untouched" },
            },
          ],
          edges: [],
        },
        2,
      ) as { nodes: { id: string; config: Record<string, unknown> }[] };

      const llm = migrated.nodes.find((n) => n.id === "llm_v2")!;
      expect(llm.config).toEqual({ model: "anthropic/claude-sonnet-4.5" });
      expect(llm.config.prompt).toBeUndefined();
      expect(llm.config.user).toBeUndefined();
      expect(llm.config.system).toBeUndefined();

      // Non-llm-text nodes pass through unchanged.
      const text = migrated.nodes.find((n) => n.id === "text_old")!;
      expect(text.config).toEqual({ text: "untouched" });
    });

    it("strips `user` and `system` from a v3 llm-text config", () => {
      const migrated = useWorkflowStore.persist.getOptions().migrate?.(
        {
          nodes: [
            {
              id: "llm_v3",
              kind: "llm-text",
              position: { x: 0, y: 0 },
              config: {
                user: "my prompt",
                system: "you are helpful",
                model: "openai/gpt-5",
              },
            },
          ],
          edges: [],
        },
        3,
      ) as { nodes: { id: string; config: Record<string, unknown> }[] };

      expect(migrated.nodes[0]?.config).toEqual({ model: "openai/gpt-5" });
    });

    it("is idempotent on an already-v4 payload", () => {
      const migrated = useWorkflowStore.persist.getOptions().migrate?.(
        {
          nodes: [
            {
              id: "llm",
              kind: "llm-text",
              position: { x: 0, y: 0 },
              config: { model: "openai/gpt-5" },
            },
          ],
          edges: [],
        },
        4,
      ) as { nodes: { id: string; config: Record<string, unknown> }[] };
      expect(migrated.nodes[0]?.config).toEqual({ model: "openai/gpt-5" });
    });

    it("defaults missing model to canonical sonnet-4.5", () => {
      const migrated = useWorkflowStore.persist.getOptions().migrate?.(
        {
          nodes: [
            {
              id: "llm",
              kind: "llm-text",
              position: { x: 0, y: 0 },
              config: { prompt: "x" },
            },
          ],
          edges: [],
        },
        1,
      ) as { nodes: { id: string; config: Record<string, unknown> }[] };
      expect(migrated.nodes[0]?.config).toEqual({
        model: "anthropic/claude-sonnet-4.5",
      });
    });

    it("tolerates a payload with no nodes (empty / brand-new project)", () => {
      const migrated = useWorkflowStore.persist.getOptions().migrate?.(
        {},
        2,
      );
      expect(migrated).toBeDefined();
    });

    /* v5-specific assertions ----------------------------------------- */

    it("preserves valid temperature, maxTokens, and reasoning on a v5 payload", () => {
      const migrated = useWorkflowStore.persist.getOptions().migrate?.(
        {
          nodes: [
            {
              id: "llm",
              kind: "llm-text",
              position: { x: 0, y: 0 },
              config: {
                model: "openai/gpt-5",
                temperature: 0.7,
                maxTokens: 1500,
                reasoning: true,
              },
            },
          ],
          edges: [],
        },
        5,
      ) as { nodes: { id: string; config: Record<string, unknown> }[] };
      expect(migrated.nodes[0]?.config).toEqual({
        model: "openai/gpt-5",
        temperature: 0.7,
        maxTokens: 1500,
        reasoning: true,
      });
    });

    it("strips out-of-range temperature (negative, > 2, NaN, non-number)", () => {
      const make = (temperature: unknown) =>
        useWorkflowStore.persist.getOptions().migrate?.(
          {
            nodes: [
              {
                id: "llm",
                kind: "llm-text",
                position: { x: 0, y: 0 },
                config: { model: "openai/gpt-5", temperature },
              },
            ],
            edges: [],
          },
          4,
        ) as { nodes: { config: Record<string, unknown> }[] };

      for (const bad of [-0.1, 2.1, Number.NaN, "0.7", true, null]) {
        const out = make(bad);
        expect(out.nodes[0]?.config.temperature).toBeUndefined();
      }
    });

    it("strips non-positive-integer maxTokens (decimal, zero, negative, non-number)", () => {
      const make = (maxTokens: unknown) =>
        useWorkflowStore.persist.getOptions().migrate?.(
          {
            nodes: [
              {
                id: "llm",
                kind: "llm-text",
                position: { x: 0, y: 0 },
                config: { model: "openai/gpt-5", maxTokens },
              },
            ],
            edges: [],
          },
          4,
        ) as { nodes: { config: Record<string, unknown> }[] };

      for (const bad of [0, -1, 1.5, "1500", null]) {
        const out = make(bad);
        expect(out.nodes[0]?.config.maxTokens).toBeUndefined();
      }
    });

    it("strips non-boolean reasoning", () => {
      const make = (reasoning: unknown) =>
        useWorkflowStore.persist.getOptions().migrate?.(
          {
            nodes: [
              {
                id: "llm",
                kind: "llm-text",
                position: { x: 0, y: 0 },
                config: { model: "openai/gpt-5", reasoning },
              },
            ],
            edges: [],
          },
          4,
        ) as { nodes: { config: Record<string, unknown> }[] };

      for (const bad of ["true", 1, null]) {
        const out = make(bad);
        expect(out.nodes[0]?.config.reasoning).toBeUndefined();
      }
      // True boolean passes through.
      const okTrue = make(true);
      expect(okTrue.nodes[0]?.config.reasoning).toBe(true);
      // Explicit false also passes through (rare but legal).
      const okFalse = make(false);
      expect(okFalse.nodes[0]?.config.reasoning).toBe(false);
    });
  });

  describe("edge selection", () => {
    it("setSelectedEdgeIds stores the ids verbatim", () => {
      useWorkflowStore.getState().setSelectedEdgeIds(["e1", "e2"]);
      expect(useWorkflowStore.getState().selectedEdgeIds).toEqual([
        "e1",
        "e2",
      ]);
    });

    it("removeEdge also drops the id from selectedEdgeIds", () => {
      // Build a node→node edge so we have a real id to work with.
      const a = useWorkflowStore.getState().addNode("text", { x: 0, y: 0 });
      const b = useWorkflowStore.getState().addNode("image", { x: 0, y: 0 });
      const edgeId = useWorkflowStore.getState().addEdge({
        source: a,
        sourceHandle: "out",
        target: b,
        targetHandle: "in",
      })!;
      useWorkflowStore.getState().setSelectedEdgeIds([edgeId]);
      expect(useWorkflowStore.getState().selectedEdgeIds).toContain(edgeId);
      useWorkflowStore.getState().removeEdge(edgeId);
      expect(useWorkflowStore.getState().selectedEdgeIds).not.toContain(edgeId);
    });

    it("removeNode cascades through edges AND clears them from selectedEdgeIds", () => {
      // Regression guard: a stale id in selectedEdgeIds after a cascade
      // delete would silently no-op the next Backspace press.
      const a = useWorkflowStore.getState().addNode("text", { x: 0, y: 0 });
      const b = useWorkflowStore.getState().addNode("image", { x: 0, y: 0 });
      const edgeId = useWorkflowStore.getState().addEdge({
        source: a,
        sourceHandle: "out",
        target: b,
        targetHandle: "in",
      })!;
      useWorkflowStore.getState().setSelectedEdgeIds([edgeId]);
      useWorkflowStore.getState().removeNode(a);
      expect(useWorkflowStore.getState().edges).toHaveLength(0);
      expect(useWorkflowStore.getState().selectedEdgeIds).toEqual([]);
    });

    it("clear() resets selectedEdgeIds along with everything else", () => {
      useWorkflowStore.getState().setSelectedEdgeIds(["e1"]);
      useWorkflowStore.getState().setSelectedNodeIds(["n1"]);
      useWorkflowStore.getState().clear();
      expect(useWorkflowStore.getState().selectedEdgeIds).toEqual([]);
      expect(useWorkflowStore.getState().selectedNodeIds).toEqual([]);
    });
  });

  it("addEdge rejects a second connection into the same single-input handle", () => {
    const a = useWorkflowStore.getState().addNode("text", { x: 0, y: 0 });
    const b = useWorkflowStore.getState().addNode("text", { x: 0, y: 0 });
    const c = useWorkflowStore.getState().addNode("image", { x: 0, y: 0 });
    // Image has no inputs, so let's use Text→Text via the (nonexistent) input
    // — registry-driven check should still reject the duplicate.
    const first = useWorkflowStore.getState().addEdge({
      source: a,
      sourceHandle: "out",
      target: c,
      targetHandle: "in",
    });
    expect(first).toBeDefined();
    const second = useWorkflowStore.getState().addEdge({
      source: b,
      sourceHandle: "out",
      target: c,
      targetHandle: "in",
    });
    expect(second).toBeUndefined();
  });
});
