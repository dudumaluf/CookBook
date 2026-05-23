import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import {
  imageIteratorNodeSchema,
  type ImageIteratorNodeConfig,
} from "@/components/nodes/node-image-iterator";
import { useAssetStore } from "@/lib/stores/asset-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import type { AssetGroupAsset, ImageAsset } from "@/types/asset";
import type { StandardizedOutput } from "@/types/node";

vi.mock("@/lib/library/upload-asset", () => ({
  uploadImageAsset: vi.fn(),
  deleteAssetObject: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

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

function seedGroup(
  id: string,
  name: string,
  assetIds: string[],
  isUntitled = false,
): AssetGroupAsset {
  const group: AssetGroupAsset = {
    id,
    name,
    tags: [],
    scope: "project",
    createdAt: 0,
    updatedAt: 0,
    kind: "asset-group",
    assetIds,
    isUntitled,
  };
  useAssetStore.setState((s) => ({ ...s, assets: [...s.assets, group] }));
  return group;
}

function makeConfig(
  partial: Partial<ImageIteratorNodeConfig> = {},
): ImageIteratorNodeConfig {
  return {
    groupId: "",
    cursor: 0,
    selectionMode: "all",
    ...partial,
  };
}

beforeEach(() => {
  useAssetStore.setState((s) => ({ ...s, assets: [] }));
  useWorkflowStore.setState({ nodes: [], edges: [] });
});

afterEach(() => {
  useAssetStore.setState((s) => ({ ...s, assets: [] }));
  useWorkflowStore.setState({ nodes: [], edges: [] });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* Schema shape (Slice 5.6: groupId replaces assetIds)                         */
/* ────────────────────────────────────────────────────────────────────────── */

describe("imageIteratorNodeSchema (Slice 5.6)", () => {
  it("declares the new schema shape — groupId replaces assetIds", () => {
    expect(imageIteratorNodeSchema.kind).toBe("image-iterator");
    expect(imageIteratorNodeSchema.category).toBe("iterator");
    expect(imageIteratorNodeSchema.reactive).toBe(true);
    // The fan-out flag stays on so the engine despatches one downstream
    // run per item the iterator emits.
    expect(imageIteratorNodeSchema.iterator).toBe(true);
    // Storage is the linked AssetGroup; iterator has no input handles.
    expect(imageIteratorNodeSchema.inputs).toEqual([]);
    expect(imageIteratorNodeSchema.outputs[0]).toEqual({
      id: "out",
      label: "out",
      dataType: "image",
    });
  });

  it("default config is the empty-link with selectionMode 'all'", () => {
    expect(imageIteratorNodeSchema.defaultConfig).toEqual({
      groupId: "",
      cursor: 0,
      selectionMode: "all",
    });
  });

  /* ───────────────────────── execute() — selection modes ─────────────── */

  describe("execute()", () => {
    it("resolves group → assetIds → image refs and emits all in 'all' mode", async () => {
      seedImageAsset("a-1", "https://x/1.png", "First");
      seedImageAsset("a-2", "https://x/2.png", "Second");
      seedImageAsset("a-3", "https://x/3.png", "Third");
      seedGroup("g-1", "My set", ["a-1", "a-2", "a-3"]);

      const result = await imageIteratorNodeSchema.execute!({
        nodeId: "iter-1",
        config: makeConfig({ groupId: "g-1", selectionMode: "all" }),
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

    it("returns an empty array when groupId is empty (placeholder iterator)", async () => {
      const result = await imageIteratorNodeSchema.execute!({
        nodeId: "iter-1",
        config: makeConfig({ groupId: "" }),
        inputs: {},
        signal: new AbortController().signal,
      });
      expect(result).toEqual([]);
    });

    it("returns an empty array when the linked group was deleted", async () => {
      // Iterator points to a group that no longer exists.
      const result = await imageIteratorNodeSchema.execute!({
        nodeId: "iter-1",
        config: makeConfig({ groupId: "g-deleted" }),
        inputs: {},
        signal: new AbortController().signal,
      });
      expect(result).toEqual([]);
    });

    it("drops asset ids that don't resolve to an image (stale references)", async () => {
      seedImageAsset("a-1", "https://x/1.png", "First");
      // a-2 deliberately not seeded.
      seedGroup("g-1", "My set", ["a-1", "a-missing", "a-2"]);

      const result = await imageIteratorNodeSchema.execute!({
        nodeId: "iter-1",
        config: makeConfig({ groupId: "g-1", selectionMode: "all" }),
        inputs: {},
        signal: new AbortController().signal,
      });
      const arr = result as StandardizedOutput[];
      expect(arr).toHaveLength(1);
      expect(arr[0]).toEqual({
        type: "image",
        value: { url: "https://x/1.png" },
      });
    });

    it("'fixed' mode emits exactly the cursor item from the group", async () => {
      seedImageAsset("a-1", "https://x/1.png", "First");
      seedImageAsset("a-2", "https://x/2.png", "Second");
      seedImageAsset("a-3", "https://x/3.png", "Third");
      seedGroup("g-1", "My set", ["a-1", "a-2", "a-3"]);

      const result = await imageIteratorNodeSchema.execute!({
        nodeId: "iter-1",
        config: makeConfig({
          groupId: "g-1",
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

    it("'increment' mode advances the persisted cursor for the next run", async () => {
      seedImageAsset("a-1", "https://x/1.png", "First");
      seedImageAsset("a-2", "https://x/2.png", "Second");
      seedGroup("g-1", "My set", ["a-1", "a-2"]);
      useWorkflowStore.setState({
        nodes: [
          {
            id: "iter-1",
            kind: "image-iterator",
            position: { x: 0, y: 0 },
            config: makeConfig({
              groupId: "g-1",
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
          groupId: "g-1",
          cursor: 0,
          selectionMode: "increment",
        }),
        inputs: {},
        signal: new AbortController().signal,
      });
      const arr = result as StandardizedOutput[];
      expect(arr).toHaveLength(1);
      expect(arr[0]).toEqual({
        type: "image",
        value: { url: "https://x/1.png" },
      });
      const persisted = useWorkflowStore
        .getState()
        .nodes.find((n) => n.id === "iter-1");
      expect(
        (persisted?.config as ImageIteratorNodeConfig).cursor,
      ).toBe(1);
    });
  });

  /* ──────────────────────── Body (Slice 5.6: linked) ───────────────────── */

  describe("body — empty states", () => {
    it("shows the 'no group linked' empty state when groupId is empty", () => {
      const Body = imageIteratorNodeSchema.Body;
      render(
        <Body
          nodeId="iter-1"
          config={makeConfig({ groupId: "" })}
          updateConfig={() => undefined}
          selected={false}
        />,
      );
      const empty = screen.getByTestId("image-iterator-empty-no-group");
      expect(empty.textContent).toMatch(/no group linked/i);
      expect(empty.textContent).toMatch(/drag a library group/i);
    });

    it("shows the 'group is empty' state when the linked group has no assetIds", () => {
      seedGroup("g-1", "Photoshoot", []);
      const Body = imageIteratorNodeSchema.Body;
      render(
        <Body
          nodeId="iter-1"
          config={makeConfig({ groupId: "g-1" })}
          updateConfig={() => undefined}
          selected={false}
        />,
      );
      const empty = screen.getByTestId("image-iterator-empty-group");
      expect(empty.textContent).toMatch(/group is empty/i);
      expect(empty.textContent).toMatch(/Photoshoot/);
    });

    it("shows the 'no group linked' state when groupId points to a deleted group", () => {
      const Body = imageIteratorNodeSchema.Body;
      render(
        <Body
          nodeId="iter-1"
          config={makeConfig({ groupId: "g-deleted" })}
          updateConfig={() => undefined}
          selected={false}
        />,
      );
      expect(
        screen.getByTestId("image-iterator-empty-no-group"),
      ).toBeInTheDocument();
    });
  });

  describe("body — populated", () => {
    it("renders the cursor's thumbnail, counter, mode chip, and group name", () => {
      seedImageAsset("a-1", "https://x/1.png", "Subject ref");
      seedImageAsset("a-2", "https://x/2.png", "Backdrop");
      seedGroup("g-1", "References", ["a-1", "a-2"]);

      const Body = imageIteratorNodeSchema.Body;
      render(
        <Body
          nodeId="iter-1"
          config={makeConfig({
            groupId: "g-1",
            cursor: 0,
            selectionMode: "increment",
          })}
          updateConfig={() => undefined}
          selected={false}
        />,
      );
      const img = screen.getByAltText("Subject ref") as HTMLImageElement;
      expect(img.src).toContain("https://x/1.png");
      expect(
        screen.getByTestId("iterator-cursor-counter").textContent,
      ).toBe("1 / 2");
      expect(screen.getByTestId("image-iterator-mode-chip").textContent)
        .toBe("increment");
      const label = screen.getByTestId("image-iterator-group-label");
      expect(label.textContent).toMatch(/References/);
      expect(label.textContent).toMatch(/Subject ref/);
    });

    it("renders an 'Untitled' badge for auto-created groups", () => {
      seedImageAsset("a-1", "https://x/1.png", "First");
      seedGroup("g-1", "Untitled 1", ["a-1"], /* isUntitled */ true);
      const Body = imageIteratorNodeSchema.Body;
      render(
        <Body
          nodeId="iter-1"
          config={makeConfig({ groupId: "g-1" })}
          updateConfig={() => undefined}
          selected={false}
        />,
      );
      expect(
        screen.getByTestId("image-iterator-untitled-badge"),
      ).toBeInTheDocument();
    });

    it("does NOT render the Untitled badge for renamed groups", () => {
      seedImageAsset("a-1", "https://x/1.png", "First");
      seedGroup("g-1", "Photoshoot Paris", ["a-1"], /* isUntitled */ false);
      const Body = imageIteratorNodeSchema.Body;
      render(
        <Body
          nodeId="iter-1"
          config={makeConfig({ groupId: "g-1" })}
          updateConfig={() => undefined}
          selected={false}
        />,
      );
      expect(
        screen.queryByTestId("image-iterator-untitled-badge"),
      ).toBeNull();
    });

    it("clicking the cursor's right arrow updates config.cursor via updateConfig", () => {
      seedImageAsset("a-1", "https://x/1.png", "First");
      seedImageAsset("a-2", "https://x/2.png", "Second");
      seedGroup("g-1", "Pair", ["a-1", "a-2"]);
      const updateConfig = vi.fn();

      const Body = imageIteratorNodeSchema.Body;
      render(
        <Body
          nodeId="iter-1"
          config={makeConfig({
            groupId: "g-1",
            cursor: 0,
            selectionMode: "fixed",
          })}
          updateConfig={updateConfig}
          selected={false}
        />,
      );
      fireEvent.click(
        screen.getByRole("button", { name: /image next item/i }),
      );
      expect(updateConfig).toHaveBeenCalledWith({ cursor: 1 });
    });
  });

  /* ────────────────────── Settings popover (Slice 5.6) ─────────────────── */

  describe("settings content — selection mode picker", () => {
    it("renders the selection-mode dropdown with every mode option", () => {
      seedGroup("g-1", "G", []);
      const SettingsContent = imageIteratorNodeSchema.settings!.Content;
      render(
        <SettingsContent
          nodeId="iter-1"
          config={makeConfig({ groupId: "g-1" })}
          updateConfig={() => undefined}
          selected={false}
        />,
      );
      const select = screen.getByLabelText(
        /selection mode/i,
      ) as HTMLSelectElement;
      const optionValues = Array.from(select.options).map((o) => o.value);
      expect(optionValues).toEqual([
        "fixed",
        "increment",
        "decrement",
        "random",
        "range",
        "all",
      ]);
    });

    it("changing the dropdown commits via updateConfig", () => {
      seedGroup("g-1", "G", []);
      const updateConfig = vi.fn();
      const SettingsContent = imageIteratorNodeSchema.settings!.Content;
      render(
        <SettingsContent
          nodeId="iter-1"
          config={makeConfig({ groupId: "g-1" })}
          updateConfig={updateConfig}
          selected={false}
        />,
      );
      fireEvent.change(screen.getByLabelText(/selection mode/i), {
        target: { value: "increment" },
      });
      expect(updateConfig).toHaveBeenCalledWith({ selectionMode: "increment" });
    });

    it("renders Start + End range inputs only when selectionMode === 'range'", () => {
      seedImageAsset("a-1", "https://x/1.png", "First");
      seedImageAsset("a-2", "https://x/2.png", "Second");
      seedImageAsset("a-3", "https://x/3.png", "Third");
      seedGroup("g-1", "Set", ["a-1", "a-2", "a-3"]);
      const SettingsContent = imageIteratorNodeSchema.settings!.Content;
      const { rerender } = render(
        <SettingsContent
          nodeId="iter-1"
          config={makeConfig({ groupId: "g-1" })}
          updateConfig={() => undefined}
          selected={false}
        />,
      );
      expect(screen.queryByLabelText(/start \(1-indexed\)/i)).toBeNull();

      rerender(
        <SettingsContent
          nodeId="iter-1"
          config={makeConfig({
            groupId: "g-1",
            selectionMode: "range",
          })}
          updateConfig={() => undefined}
          selected={false}
        />,
      );
      expect(screen.getByLabelText(/start \(1-indexed\)/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/end \(1-indexed\)/i)).toBeInTheDocument();
    });

    it("renders the 'Detach from group' button only when a real group is linked", () => {
      const SettingsContent = imageIteratorNodeSchema.settings!.Content;
      const { rerender } = render(
        <SettingsContent
          nodeId="iter-1"
          config={makeConfig({ groupId: "" })}
          updateConfig={() => undefined}
          selected={false}
        />,
      );
      expect(
        screen.queryByTestId("image-iterator-detach-button"),
      ).toBeNull();

      seedGroup("g-1", "Linked", []);
      rerender(
        <SettingsContent
          nodeId="iter-1"
          config={makeConfig({ groupId: "g-1" })}
          updateConfig={() => undefined}
          selected={false}
        />,
      );
      expect(
        screen.getByTestId("image-iterator-detach-button"),
      ).toBeInTheDocument();
    });

    it("clicking 'Detach from group' creates a (copy) group and re-links the iterator", () => {
      // Seed an image asset and a real (non-Untitled) source group.
      seedImageAsset("a-1", "https://x/1.png", "First");
      seedImageAsset("a-2", "https://x/2.png", "Second");
      seedGroup("g-source", "Photoshoot Paris", ["a-1", "a-2"]);

      const updateConfig = vi.fn();
      const SettingsContent = imageIteratorNodeSchema.settings!.Content;
      render(
        <SettingsContent
          nodeId="iter-1"
          config={makeConfig({
            groupId: "g-source",
            cursor: 1,
            selectionMode: "fixed",
          })}
          updateConfig={updateConfig}
          selected={false}
        />,
      );
      fireEvent.click(
        screen.getByTestId("image-iterator-detach-button"),
      );

      // Two updateConfig calls: groupId rewrite + cursor reset.
      const calls = updateConfig.mock.calls.map((c) => c[0]);
      const groupIdCall = calls.find(
        (c) => typeof c?.groupId === "string",
      );
      const cursorCall = calls.find((c) => c?.cursor === 0);
      expect(groupIdCall).toBeDefined();
      expect(cursorCall).toBeDefined();
      const newGroupId = (groupIdCall as { groupId: string }).groupId;
      // The new group exists in the asset store, named "<source> (copy)",
      // referencing the SAME asset ids (no byte duplication).
      const newGroup = useAssetStore.getState().getAsset(newGroupId);
      expect(newGroup?.kind).toBe("asset-group");
      if (newGroup?.kind === "asset-group") {
        expect(newGroup.name).toBe("Photoshoot Paris (copy)");
        expect(newGroup.assetIds).toEqual(["a-1", "a-2"]);
        expect(newGroup.isUntitled).toBe(false);
      }
      // Source group survives unchanged.
      const source = useAssetStore.getState().getAsset("g-source");
      if (source?.kind === "asset-group") {
        expect(source.name).toBe("Photoshoot Paris");
        expect(source.assetIds).toEqual(["a-1", "a-2"]);
      }
    });
  });

  /* ─────────────────────────── hasOverrides ───────────────────────────── */

  describe("settings.hasOverrides", () => {
    it("returns false on a default-config iterator (mode='all', cursor=0)", () => {
      const has = imageIteratorNodeSchema.settings?.hasOverrides;
      expect(has?.(makeConfig({ groupId: "g-1" }))).toBe(false);
    });
    it("returns true once selectionMode is anything other than 'all'", () => {
      const has = imageIteratorNodeSchema.settings?.hasOverrides;
      expect(
        has?.(makeConfig({ groupId: "g-1", selectionMode: "fixed" })),
      ).toBe(true);
    });
    it("returns true once cursor moved off 0", () => {
      const has = imageIteratorNodeSchema.settings?.hasOverrides;
      expect(has?.(makeConfig({ groupId: "g-1", cursor: 1 }))).toBe(true);
    });
  });
});
