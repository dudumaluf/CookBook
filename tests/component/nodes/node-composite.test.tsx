import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { compositeNodeSchema } from "@/components/nodes/node-composite";
import {
  _resetExecutionForTests,
  useExecutionStore,
} from "@/lib/stores/execution-store";
import type {
  CompositeNodeConfig,
} from "@/components/nodes/node-composite";
import type { ExecutionRecord } from "@/types/node";

const Body = compositeNodeSchema.Body!;

function baseConfig(): CompositeNodeConfig {
  return {
    recipeId: "r1",
    recipeName: "My Recipe",
    recipeVersion: 1,
    subgraph: {
      version: 2,
      nodes: [
        {
          id: "n1",
          kind: "fal-image",
          position: { x: 0, y: 0 },
          config: { model: "nano-banana-2", seed: -1 },
        },
      ],
      edges: [],
    },
    exposedInputs: [],
    exposedOutputs: [],
    exposedParams: [
      {
        internalNodeId: "n1",
        configKey: "model",
        label: "Model",
        control: "select",
        options: ["nano-banana-2", "flux-2-pro"],
      },
    ],
  };
}

function renderBody(
  config: CompositeNodeConfig,
  updateConfig = vi.fn(),
  nodeId = "c1",
) {
  render(
    <Body
      nodeId={nodeId}
      config={config}
      updateConfig={updateConfig}
      selected={false}
    />,
  );
  return updateConfig;
}

beforeEach(() => {
  _resetExecutionForTests();
});

describe("composite node body", () => {
  it("renders an exposed param as a control with the current value", () => {
    renderBody(baseConfig());
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("nano-banana-2");
    expect(screen.getByText("Model")).toBeInTheDocument();
  });

  it("writes a param change back into the inner node's config", () => {
    const updateConfig = renderBody(baseConfig());
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "flux-2-pro" },
    });
    expect(updateConfig).toHaveBeenCalledTimes(1);
    const patch = updateConfig.mock.calls[0]![0] as Partial<CompositeNodeConfig>;
    const node = patch.subgraph!.nodes[0] as { config: { model: string } };
    expect(node.config.model).toBe("flux-2-pro");
  });

  it("shows a preview of the last run's image result", () => {
    const records = new Map<string, ExecutionRecord>([
      [
        "c1",
        {
          status: "done",
          output: { type: "image", value: { url: "https://x/out.png" } },
        },
      ],
    ]);
    useExecutionStore.setState({ records });
    renderBody(baseConfig());
    const img = screen.getByAltText("Recipe result") as HTMLImageElement;
    expect(img.src).toContain("https://x/out.png");
  });

  it("falls back to the packaged-recipe summary when there are no params or result", () => {
    const cfg = baseConfig();
    cfg.exposedParams = [];
    renderBody(cfg);
    expect(screen.getByText(/Recipe ·/)).toBeInTheDocument();
  });
});
