import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cleanupGroupIfOrphan } from "@/lib/library/cleanup-orphan-group";
import { useAssetStore } from "@/lib/stores/asset-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";

vi.mock("@/lib/library/upload-asset", () => ({
  uploadImageAsset: vi.fn(),
  deleteAssetObject: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  useAssetStore.getState().clear();
  useWorkflowStore.setState({ nodes: [], edges: [] });
});

afterEach(() => {
  useAssetStore.getState().clear();
  useWorkflowStore.setState({ nodes: [], edges: [] });
});

describe("cleanupGroupIfOrphan (Slice 5.6e, ADR-0032)", () => {
  it("drops an Untitled group when no iterator links to it after a delete", () => {
    // Pre-state: one Untitled group, no iterators on the canvas
    // (the iterator that owned it was just deleted).
    const groupId = useAssetStore.getState().createGroup({
      assetIds: ["a-1"],
      isUntitled: true,
    });
    cleanupGroupIfOrphan(groupId);
    expect(useAssetStore.getState().getAsset(groupId)).toBeUndefined();
  });

  it("preserves an Untitled group when another iterator still links to it", () => {
    const groupId = useAssetStore.getState().createGroup({
      assetIds: ["a-1"],
      isUntitled: true,
    });
    // Surviving iterator still pointing at the group.
    useWorkflowStore.setState({
      nodes: [
        {
          id: "iter-survivor",
          kind: "image-iterator",
          position: { x: 0, y: 0 },
          config: { groupId, cursor: 0, selectionMode: "all" },
        },
      ],
      edges: [],
    });
    cleanupGroupIfOrphan(groupId);
    // Group survived because there's still a linked iterator.
    expect(useAssetStore.getState().getAsset(groupId)?.kind).toBe(
      "asset-group",
    );
  });

  it("preserves a renamed (non-Untitled) group even when orphaned", () => {
    const groupId = useAssetStore.getState().createGroup({
      assetIds: ["a-1"],
      isUntitled: true,
    });
    // User renamed → flips isUntitled.
    useAssetStore.getState().renameGroup(groupId, "Real group");
    cleanupGroupIfOrphan(groupId);
    expect(useAssetStore.getState().getAsset(groupId)?.kind).toBe(
      "asset-group",
    );
  });

  it("is a no-op for empty / missing groupIds (idempotent)", () => {
    // No throw, no state change.
    cleanupGroupIfOrphan("");
    cleanupGroupIfOrphan("g-does-not-exist");
    expect(useAssetStore.getState().assets).toHaveLength(0);
  });

  it("ignores non-iterator nodes when computing linked references", () => {
    // A Text node with a coincidental config.groupId field should NOT
    // count as a linking iterator.
    const groupId = useAssetStore.getState().createGroup({
      assetIds: ["a-1"],
      isUntitled: true,
    });
    useWorkflowStore.setState({
      nodes: [
        {
          id: "text-1",
          kind: "text",
          position: { x: 0, y: 0 },
          // Defensive: we set a groupId-shaped property on a non-
          // iterator node. The cleanup should not be fooled.
          config: { text: "hello", groupId } as Record<string, unknown>,
        },
      ],
      edges: [],
    });
    cleanupGroupIfOrphan(groupId);
    expect(useAssetStore.getState().getAsset(groupId)).toBeUndefined();
  });

  it("counts a single-iterator owner as linked → preserves the group", () => {
    const groupId = useAssetStore.getState().createGroup({
      assetIds: ["a-1"],
      isUntitled: true,
    });
    useWorkflowStore.setState({
      nodes: [
        {
          id: "iter-only",
          kind: "image-iterator",
          position: { x: 0, y: 0 },
          config: { groupId, cursor: 0, selectionMode: "all" },
        },
      ],
      edges: [],
    });
    cleanupGroupIfOrphan(groupId);
    expect(useAssetStore.getState().getAsset(groupId)?.kind).toBe(
      "asset-group",
    );
  });
});
