import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import {
  imageIteratorNodeSchema,
  type ImageIteratorNodeConfig,
} from "@/components/nodes/node-image-iterator";
import { useAssetStore } from "@/lib/stores/asset-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import type { ImageAsset } from "@/types/asset";
import type { StandardizedOutput } from "@/types/node";

/* ────────────────────────────────────────────────────────────────────────── */
/* Helpers                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

function seedImageAsset(id: string, url: string, name: string): ImageAsset {
  const asset: ImageAsset = {
    id,
    name,
    tags: [],
    scope: "project",
    createdAt: 0,
    updatedAt: 0,
    kind: "image",
    source: { type: "url", url },
  };
  useAssetStore.setState((s) => ({ ...s, assets: [...s.assets, asset] }));
  return asset;
}

function makeConfig(
  partial: Partial<ImageIteratorNodeConfig> = {},
): ImageIteratorNodeConfig {
  return {
    assetIds: [],
    cursor: 0,
    selectionMode: "all",
    ...partial,
  };
}

beforeEach(() => {
  // Clean both stores so leftover state from one test doesn't bleed.
  useAssetStore.setState((s) => ({ ...s, assets: [] }));
  useWorkflowStore.setState({ nodes: [], edges: [] });
});

afterEach(() => {
  useAssetStore.setState((s) => ({ ...s, assets: [] }));
  useWorkflowStore.setState({ nodes: [], edges: [] });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* Schema shape (Slice 5.5: internal storage replaces multi-edge `images`)    */
/* ────────────────────────────────────────────────────────────────────────── */

describe("imageIteratorNodeSchema (Slice 5.5)", () => {
  it("declares the new schema shape — no inputs (storage moved to config)", () => {
    expect(imageIteratorNodeSchema.kind).toBe("image-iterator");
    expect(imageIteratorNodeSchema.category).toBe("iterator");
    expect(imageIteratorNodeSchema.reactive).toBe(true);
    // The fan-out flag stays on so the engine despatches one downstream
    // run per item the iterator emits (degenerate-but-correct for
    // single-item modes like `fixed` / `increment`).
    expect(imageIteratorNodeSchema.iterator).toBe(true);
    // Storage moved to config → no input handles. This is the
    // load-bearing change of Slice 5.5.
    expect(imageIteratorNodeSchema.inputs).toEqual([]);
    expect(imageIteratorNodeSchema.outputs[0]).toEqual({
      id: "out",
      label: "out",
      dataType: "image",
    });
  });

  it("default config is the empty bag with `selectionMode: 'all'` (matches pre-5.5 fan-out behaviour)", () => {
    expect(imageIteratorNodeSchema.defaultConfig).toEqual({
      assetIds: [],
      cursor: 0,
      selectionMode: "all",
    });
  });

  it("declares horizontal-only resize (Slice 5.5a body is still single-row)", () => {
    expect(imageIteratorNodeSchema.size?.resizable).toBe("horizontal");
  });

  /* ───────────────────────── execute() — selection modes ─────────────── */

  describe("execute()", () => {
    it("resolves assetIds via the asset store and emits image refs", async () => {
      seedImageAsset("a-1", "https://x/1.png", "First");
      seedImageAsset("a-2", "https://x/2.png", "Second");
      seedImageAsset("a-3", "https://x/3.png", "Third");

      const result = await imageIteratorNodeSchema.execute!({
        nodeId: "iter-1",
        config: makeConfig({
          assetIds: ["a-1", "a-2", "a-3"],
          selectionMode: "all",
        }),
        inputs: {},
        signal: new AbortController().signal,
      });

      const arr = result as StandardizedOutput[];
      expect(arr).toHaveLength(3);
      expect(arr[0]).toEqual({
        type: "image",
        value: { url: "https://x/1.png" },
      });
      expect(arr[2]).toEqual({
        type: "image",
        value: { url: "https://x/3.png" },
      });
    });

    it("drops asset ids that don't resolve to an image asset (stale references)", async () => {
      seedImageAsset("a-1", "https://x/1.png", "First");
      // a-2 deliberately not seeded — simulates user deleting the asset.

      const result = await imageIteratorNodeSchema.execute!({
        nodeId: "iter-1",
        config: makeConfig({
          assetIds: ["a-1", "a-missing", "a-2"],
          selectionMode: "all",
        }),
        inputs: {},
        signal: new AbortController().signal,
      });
      const arr = result as StandardizedOutput[];
      // Only `a-1` resolves; the others vanish.
      expect(arr).toHaveLength(1);
      expect(arr[0]).toEqual({
        type: "image",
        value: { url: "https://x/1.png" },
      });
    });

    it("`selectionMode: 'fixed'` emits exactly the cursor's item", async () => {
      seedImageAsset("a-1", "https://x/1.png", "First");
      seedImageAsset("a-2", "https://x/2.png", "Second");
      seedImageAsset("a-3", "https://x/3.png", "Third");

      const result = await imageIteratorNodeSchema.execute!({
        nodeId: "iter-1",
        config: makeConfig({
          assetIds: ["a-1", "a-2", "a-3"],
          cursor: 1,
          selectionMode: "fixed",
        }),
        inputs: {},
        signal: new AbortController().signal,
      });
      const arr = result as StandardizedOutput[];
      expect(arr).toHaveLength(1);
      expect(arr[0]).toEqual({
        type: "image",
        value: { url: "https://x/2.png" },
      });
    });

    it("`selectionMode: 'increment'` advances the persisted cursor for the next run", async () => {
      seedImageAsset("a-1", "https://x/1.png", "First");
      seedImageAsset("a-2", "https://x/2.png", "Second");
      // Seed an iterator node into the workflow store so updateNodeConfig
      // has a target to write to.
      useWorkflowStore.setState({
        nodes: [
          {
            id: "iter-1",
            kind: "image-iterator",
            position: { x: 0, y: 0 },
            config: makeConfig({
              assetIds: ["a-1", "a-2"],
              cursor: 0,
              selectionMode: "increment",
            }),
          },
        ],
        edges: [],
      });

      const result = await imageIteratorNodeSchema.execute!({
        nodeId: "iter-1",
        config: makeConfig({
          assetIds: ["a-1", "a-2"],
          cursor: 0,
          selectionMode: "increment",
        }),
        inputs: {},
        signal: new AbortController().signal,
      });
      const arr = result as StandardizedOutput[];
      // Emits cursor=0 item, then advances cursor to 1 for the *next* run.
      expect(arr).toHaveLength(1);
      expect(arr[0]).toEqual({
        type: "image",
        value: { url: "https://x/1.png" },
      });
      // Cursor was bumped on the persisted node.
      const persisted = useWorkflowStore
        .getState()
        .nodes.find((n) => n.id === "iter-1");
      expect(
        (persisted?.config as ImageIteratorNodeConfig).cursor,
      ).toBe(1);
    });

    it("returns an empty array when `assetIds` is empty (no run errors on a fresh iterator)", async () => {
      const result = await imageIteratorNodeSchema.execute!({
        nodeId: "iter-1",
        config: makeConfig({ assetIds: [] }),
        inputs: {},
        signal: new AbortController().signal,
      });
      expect(result).toEqual([]);
    });
  });

  /* ────────────────────────────── Body 5.5a copy ───────────────────────── */

  describe("body (Slice 5.5a placeholder)", () => {
    it("renders the empty-state copy when there are no assetIds", () => {
      const Body = imageIteratorNodeSchema.Body;
      render(
        <Body
          nodeId="iter-1"
          config={makeConfig({ assetIds: [] })}
          updateConfig={() => undefined}
          selected={false}
        />,
      );
      const el = screen.getByTestId("image-iterator-count");
      expect(el.textContent).toMatch(/no images yet/i);
    });

    it("shows the count + selection mode + current asset name when populated", () => {
      seedImageAsset("a-1", "https://x/1.png", "Subject ref");
      seedImageAsset("a-2", "https://x/2.png", "Backdrop");

      const Body = imageIteratorNodeSchema.Body;
      render(
        <Body
          nodeId="iter-1"
          config={makeConfig({
            assetIds: ["a-1", "a-2"],
            cursor: 0,
            selectionMode: "increment",
          })}
          updateConfig={() => undefined}
          selected={false}
        />,
      );
      const el = screen.getByTestId("image-iterator-count");
      expect(el.textContent).toMatch(/2 images/i);
      expect(el.textContent).toMatch(/increment/i);
      expect(el.textContent).toMatch(/Subject ref/);
    });
  });
});
