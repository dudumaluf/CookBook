import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  composerNodeSchema,
  type ComposerNodeConfig,
} from "@/components/nodes/node-composer";
import { useExecutionStore } from "@/lib/stores/execution-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import { createDefaultDocument } from "@/types/composer";

// The editor's URL-layer button uses window.prompt; stub it so tests are quiet.
vi.stubGlobal("prompt", vi.fn());

const Body = composerNodeSchema.Body as React.ComponentType<{
  nodeId: string;
  config: ComposerNodeConfig;
  updateConfig: (p: Partial<ComposerNodeConfig>) => void;
  selected: boolean;
}>;

function baseConfig(): ComposerNodeConfig {
  return { doc: createDefaultDocument(), portCount: 1, seenInputs: [] };
}

beforeEach(() => {
  useWorkflowStore.setState({ nodes: [], edges: [] });
  useExecutionStore.setState({ records: new Map() });
});

describe("Composer node body", () => {
  it("shows the layer/canvas summary and the Open Composer button", () => {
    render(
      <Body
        nodeId="c1"
        config={baseConfig()}
        updateConfig={vi.fn()}
        selected={false}
      />,
    );
    expect(screen.getByText("0 layers")).toBeTruthy();
    expect(screen.getByText("1024×1024")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Open Composer/ })).toBeTruthy();
    // Editor is not mounted until opened.
    expect(screen.queryByTestId("composer-editor")).toBeNull();
  });

  it("opens the full-screen editor on click", () => {
    render(
      <Body
        nodeId="c1"
        config={baseConfig()}
        updateConfig={vi.fn()}
        selected={false}
      />,
    );
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Open Composer/ }));
    });
    expect(screen.getByTestId("composer-editor")).toBeTruthy();
  });

  it("auto-adds a VIDEO layer when a video output is wired in", () => {
    // Upstream node "v0" produced a video; wire it into layer-0.
    useExecutionStore.setState({
      records: new Map([
        [
          "v0",
          {
            status: "success",
            output: {
              type: "video",
              value: { url: "https://x/clip.mp4", width: 1920, height: 1080 },
            },
          },
        ],
      ]) as never,
    });
    useWorkflowStore.setState({
      nodes: [],
      edges: [
        {
          id: "e1",
          source: "v0",
          sourceHandle: "out",
          target: "c1",
          targetHandle: "layer-0",
        },
      ] as never,
    });

    const updateConfig = vi.fn();
    render(
      <Body
        nodeId="c1"
        config={baseConfig()}
        updateConfig={updateConfig}
        selected={false}
      />,
    );

    // The auto-add-on-wire effect drops the video in as an input layer tagged
    // with mediaType "video" (so the renderer samples a frame, not decode-as-still).
    expect(updateConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        doc: expect.objectContaining({
          layers: expect.arrayContaining([
            expect.objectContaining({
              source: expect.objectContaining({
                kind: "input",
                inputHandle: "layer-0",
                mediaType: "video",
              }),
            }),
          ]),
        }),
        seenInputs: expect.arrayContaining(["layer-0"]),
      }),
    );
  });

  it("adding a Solid layer and closing commits a doc with that layer", () => {
    const updateConfig = vi.fn();
    render(
      <Body
        nodeId="c1"
        config={baseConfig()}
        updateConfig={updateConfig}
        selected={false}
      />,
    );

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Open Composer/ }));
    });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Solid/ }));
    });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Close editor/ }));
    });

    expect(updateConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        doc: expect.objectContaining({
          layers: expect.arrayContaining([
            expect.objectContaining({
              source: expect.objectContaining({ kind: "solid" }),
            }),
          ]),
        }),
      }),
    );
    // Editor closed after committing.
    expect(screen.queryByTestId("composer-editor")).toBeNull();
  });
});
