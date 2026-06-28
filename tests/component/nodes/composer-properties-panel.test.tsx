import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ComposerPropertiesPanel } from "@/components/nodes/composer/composer-properties-panel";
import {
  createDefaultDocument,
  createLayer,
  type ComposerLayer,
} from "@/types/composer";

const doc = createDefaultDocument();

function inputLayer(): ComposerLayer {
  return createLayer({ source: { kind: "input", inputHandle: "layer-0" } });
}

describe("ComposerPropertiesPanel — mask controls", () => {
  it("offers an input picker + URL button when the layer has no mask", () => {
    const layer = inputLayer();
    render(
      <ComposerPropertiesPanel
        doc={{ ...doc, layers: [layer] }}
        selected={layer}
        inputs={{
          "layer-0": { url: "https://x/a.png", mediaType: "image" },
          "layer-1": { url: "https://x/m.png", mediaType: "image" },
        }}
        onPatchDoc={vi.fn()}
        onPatchLayer={vi.fn()}
        onPatchTransform={vi.fn()}
      />,
    );
    expect(screen.getByText("Mask")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Mask from URL/ })).toBeTruthy();
    expect(
      screen.getByRole("option", { name: /Use an input as mask/ }),
    ).toBeTruthy();
  });

  it("picking an input as mask sets an alpha mask via onPatchLayer", () => {
    const onPatchLayer = vi.fn();
    const layer = inputLayer();
    render(
      <ComposerPropertiesPanel
        doc={{ ...doc, layers: [layer] }}
        selected={layer}
        inputs={{ "layer-1": { url: "https://x/m.png", mediaType: "image" } }}
        onPatchDoc={vi.fn()}
        onPatchLayer={onPatchLayer}
        onPatchTransform={vi.fn()}
      />,
    );

    // The mask input picker is the select currently showing the placeholder.
    fireEvent.change(screen.getByDisplayValue("Use an input as mask…"), {
      target: { value: "layer-1" },
    });

    expect(onPatchLayer).toHaveBeenCalledWith(
      layer.id,
      expect.objectContaining({
        mask: expect.objectContaining({
          source: { kind: "input", inputHandle: "layer-1" },
          mode: "alpha",
          invert: false,
        }),
      }),
    );
  });

  it("toggling invert and removing edit the mask via onPatchLayer", () => {
    const onPatchLayer = vi.fn();
    const layer = inputLayer();
    layer.mask = {
      source: { kind: "input", inputHandle: "layer-1" },
      mode: "alpha",
      invert: false,
    };
    render(
      <ComposerPropertiesPanel
        doc={{ ...doc, layers: [layer] }}
        selected={layer}
        inputs={{ "layer-1": { url: "https://x/m.png", mediaType: "image" } }}
        onPatchDoc={vi.fn()}
        onPatchLayer={onPatchLayer}
        onPatchTransform={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText("invert"));
    expect(onPatchLayer).toHaveBeenCalledWith(
      layer.id,
      expect.objectContaining({ mask: expect.objectContaining({ invert: true }) }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(onPatchLayer).toHaveBeenCalledWith(layer.id, { mask: undefined });
  });
});
