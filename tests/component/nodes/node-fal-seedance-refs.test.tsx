import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";

import { seedanceVideoNodeSchema } from "@/components/nodes/node-fal-seedance";
import { useExecutionStore } from "@/lib/stores/execution-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";

beforeEach(() => {
  useWorkflowStore.setState({ nodes: [], edges: [] });
  useExecutionStore.setState({ records: new Map() });
});
afterEach(() => cleanup());

describe("seedance reference names sync from connected nodes", () => {
  it("inherits ALL three slot names (not just the alphabetically-first)", async () => {
    useWorkflowStore.setState({
      nodes: [
        { id: "sd", kind: "seedance-video", position: { x: 0, y: 0 }, config: { mode: "reference" } },
        { id: "i1", kind: "image", position: { x: 0, y: 0 }, config: {}, label: "character" },
        { id: "v1", kind: "video", position: { x: 0, y: 0 }, config: {}, label: "performance" },
        { id: "a1", kind: "audio", position: { x: 0, y: 0 }, config: {}, label: "song" },
      ],
      edges: [
        { id: "e1", source: "i1", sourceHandle: "out", target: "sd", targetHandle: "image-0" },
        { id: "e2", source: "v1", sourceHandle: "out", target: "sd", targetHandle: "video-0" },
        { id: "e3", source: "a1", sourceHandle: "out", target: "sd", targetHandle: "audio-0" },
      ],
    });

    const updateConfig = vi.fn();
    const Body = seedanceVideoNodeSchema.Body;
    render(
      <Body
        nodeId="sd"
        config={{ mode: "reference" }}
        updateConfig={updateConfig}
        selected={false}
      />,
    );

    await waitFor(() => {
      const withNames = updateConfig.mock.calls.find(
        (c) => (c[0] as { refNames?: unknown }).refNames,
      );
      expect(withNames).toBeTruthy();
      expect((withNames![0] as { refNames: Record<string, string> }).refNames).toEqual({
        "image-0": "character",
        "video-0": "performance",
        "audio-0": "song",
      });
    });
  });
});
