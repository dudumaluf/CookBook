import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ComposerTimeline } from "@/components/nodes/composer/composer-timeline";
import {
  createLayer,
  type ComposerDocument,
  type ComposerInputRef,
} from "@/types/composer";

/**
 * Component coverage for the Composer timeline (Phase 4 / ADR-0091): the
 * transport + ruler scrub + per-layer clip drag all route through the pure
 * mutators. happy-dom reports 0-width layout, so we stub `clientWidth` to give
 * the time-area a deterministic px↔ms mapping the gestures can exercise.
 */

const AREA_W = 800;
let clientWidthSpy: { restore: () => void };

beforeAll(() => {
  const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get() {
      return AREA_W;
    },
  });
  clientWidthSpy = {
    restore: () => {
      if (desc) Object.defineProperty(HTMLElement.prototype, "clientWidth", desc);
    },
  };
});

afterAll(() => clientWidthSpy.restore());

function timelineDoc(): ComposerDocument {
  return {
    version: 1,
    width: 1920,
    height: 1080,
    background: null,
    durationMs: 5000,
    fps: 30,
    layers: [
      createLayer({ source: { kind: "solid", color: "#000" }, name: "BG" }),
      {
        ...createLayer({
          source: { kind: "input", inputHandle: "layer-1" },
          name: "Clip",
        }),
        timing: { startMs: 0, endMs: 2000 },
      },
    ],
  };
}

const inputs: Record<string, ComposerInputRef> = {
  "layer-1": { url: "https://x/v.mp4", mediaType: "video" },
};

function setup(overrides: Partial<React.ComponentProps<typeof ComposerTimeline>> = {}) {
  const handlers = {
    onScrub: vi.fn(),
    onTogglePlay: vi.fn(),
    onSelect: vi.fn(),
    onPatchLayer: vi.fn(),
    onPatchDoc: vi.fn(),
  };
  const doc = overrides.doc ?? timelineDoc();
  render(
    <ComposerTimeline
      doc={doc}
      inputs={inputs}
      playheadMs={0}
      playing={false}
      selectedId={null}
      {...handlers}
      {...overrides}
    />,
  );
  return { ...handlers, doc };
}

describe("ComposerTimeline", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the transport readout and a clip per layer", () => {
    const { doc } = setup();
    expect(screen.getByTestId("composer-time").textContent).toBe("0.0s / 5.0s");
    expect(screen.getByTestId("composer-timeline")).toBeTruthy();
    for (const l of doc.layers) {
      expect(screen.getByTestId(`composer-clip-${l.id}`)).toBeTruthy();
    }
  });

  it("toggles playback from the transport button", () => {
    const { onTogglePlay } = setup();
    fireEvent.click(screen.getByLabelText("Play"));
    expect(onTogglePlay).toHaveBeenCalledTimes(1);
  });

  it("scrubs when the ruler is pressed (px → ms)", () => {
    const { onScrub } = setup();
    fireEvent.pointerDown(screen.getByTestId("composer-ruler"), { clientX: 400 });
    // 400px of an 800px / 5000ms area → ~2500ms.
    expect(onScrub).toHaveBeenCalled();
    const ms = onScrub.mock.calls.at(-1)?.[0] as number;
    expect(ms).toBeGreaterThan(2300);
    expect(ms).toBeLessThan(2700);
  });

  it("drags a clip body to re-sequence its start", () => {
    const { doc, onPatchLayer } = setup();
    const clip = doc.layers[1]!;
    fireEvent.pointerDown(screen.getByTestId(`composer-clip-${clip.id}`), {
      clientX: 100,
    });
    act(() => {
      window.dispatchEvent(
        Object.assign(new Event("pointermove"), { clientX: 200 }),
      );
    });
    expect(onPatchLayer).toHaveBeenCalledWith(
      clip.id,
      expect.objectContaining({
        timing: expect.objectContaining({ startMs: expect.any(Number) }),
      }),
    );
    const patch = onPatchLayer.mock.calls.at(-1)?.[1] as {
      timing: { startMs: number; endMs: number };
    };
    // Moved right by ~625ms; duration (2000) preserved.
    expect(patch.timing.startMs).toBeGreaterThan(0);
    expect(patch.timing.endMs - patch.timing.startMs).toBe(2000);
  });

  it("lengthens the timeline from the duration stepper", () => {
    const { onPatchDoc } = setup();
    fireEvent.click(screen.getByLabelText("Lengthen timeline"));
    expect(onPatchDoc).toHaveBeenCalledWith(
      expect.objectContaining({ durationMs: 5500 }),
    );
  });
});
