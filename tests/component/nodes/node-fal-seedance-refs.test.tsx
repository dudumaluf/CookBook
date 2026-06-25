import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

import { seedanceVideoNodeSchema } from "@/components/nodes/node-fal-seedance";
import { useExecutionStore } from "@/lib/stores/execution-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import type { StandardizedOutput } from "@/types/node";

beforeEach(() => {
  useWorkflowStore.setState({ nodes: [], edges: [] });
  useExecutionStore.setState({ records: new Map() });
});
afterEach(() => cleanup());

function renderBody() {
  const Body = seedanceVideoNodeSchema.Body;
  render(
    <Body
      nodeId="sd"
      config={{ mode: "reference" }}
      updateConfig={vi.fn()}
      selected={false}
    />,
  );
}

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

describe("seedance prompt-refs row reflects the @Image[] array fan-out", () => {
  it("enumerates @Image1..@ImageN from a wired image array (e.g. Frames Extract)", async () => {
    useWorkflowStore.setState({
      nodes: [
        { id: "sd", kind: "seedance-video", position: { x: 0, y: 0 }, config: { mode: "reference" } },
        { id: "fx", kind: "frames-extract", position: { x: 0, y: 0 }, config: {} },
        { id: "v1", kind: "video", position: { x: 0, y: 0 }, config: {} },
      ],
      // The Frames Extract array lands on the bare `image` handle (@Image[]);
      // the black-screen song on the numbered `video-0` (@Video1).
      edges: [
        { id: "e1", source: "fx", sourceHandle: "out", target: "sd", targetHandle: "image" },
        { id: "e2", source: "v1", sourceHandle: "out", target: "sd", targetHandle: "video-0" },
      ],
    });
    const frames: StandardizedOutput[] = Array.from({ length: 9 }, (_, i) => ({
      type: "image",
      value: { url: `https://x/f${i}.png` },
    }));
    useExecutionStore.setState({
      records: new Map([["fx", { status: "done", output: frames }]]),
    });

    renderBody();

    await waitFor(() => expect(screen.getByText("@Image1")).toBeTruthy());
    // Whole 9-frame span fans out, plus the song video as @Video1.
    expect(screen.getByText("@Image5")).toBeTruthy();
    expect(screen.getByText("@Image9")).toBeTruthy();
    expect(screen.getByText("@Video1")).toBeTruthy();
    // Capped at the Fal max of 9 — no @Image10.
    expect(screen.queryByText("@Image10")).toBeNull();
  });

  it("shows a single @Image[] chip when the array source has not produced frames yet", async () => {
    useWorkflowStore.setState({
      nodes: [
        { id: "sd", kind: "seedance-video", position: { x: 0, y: 0 }, config: { mode: "reference" } },
        { id: "fx", kind: "frames-extract", position: { x: 0, y: 0 }, config: {} },
      ],
      edges: [
        { id: "e1", source: "fx", sourceHandle: "out", target: "sd", targetHandle: "image" },
      ],
    });
    // No execution record for `fx` → length unknown.

    renderBody();

    await waitFor(() => expect(screen.getByText("@Image[]")).toBeTruthy());
    expect(screen.queryByText("@Image1")).toBeNull();
  });
});

describe("seedance settings — resolution respects the model tier + mode", () => {
  const Settings = seedanceVideoNodeSchema.settings!.Content;
  const resolutionOptions = () =>
    Array.from(
      (screen.getByLabelText("Resolution") as HTMLSelectElement).options,
    ).map((o) => o.value);

  it("offers 1080p on the standard tier in reference mode", () => {
    render(
      <Settings
        nodeId="sd"
        config={{ model: "standard", mode: "reference" }}
        updateConfig={vi.fn()}
        selected={false}
      />,
    );
    expect(resolutionOptions()).toContain("1080p");
  });

  it("hides 1080p on the fast tier and shows the clamped 720p as selected", () => {
    render(
      <Settings
        nodeId="sd"
        config={{ model: "fast", mode: "reference", resolution: "1080p" }}
        updateConfig={vi.fn()}
        selected={false}
      />,
    );
    expect(resolutionOptions()).toEqual(["480p", "720p"]);
    expect((screen.getByLabelText("Resolution") as HTMLSelectElement).value).toBe(
      "720p",
    );
  });

  it("hides 1080p in image-to-video mode even on the standard tier", () => {
    render(
      <Settings
        nodeId="sd"
        config={{ model: "standard", mode: "first-frame", resolution: "1080p" }}
        updateConfig={vi.fn()}
        selected={false}
      />,
    );
    expect(resolutionOptions()).not.toContain("1080p");
  });
});
