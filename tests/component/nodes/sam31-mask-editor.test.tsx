import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const { callSam31Video, uploadVideoFromUrl, probeMedia, extractFrame } =
  vi.hoisted(() => ({
    callSam31Video: vi.fn(),
    uploadVideoFromUrl: vi.fn(),
    probeMedia: vi.fn(),
    extractFrame: vi.fn(),
  }));
vi.mock("@/lib/fal/call-sam31-video", () => ({ callSam31Video }));
vi.mock("@/lib/library/upload-asset", () => ({ uploadVideoFromUrl }));
vi.mock("@/lib/media", () => ({ probeMedia, extractFrame }));

import { Sam31MaskEditor } from "@/components/nodes/node-fal-sam31-video";

/**
 * Regression test for the box-drawing bug: the mask editor lives inside a
 * Base UI Dialog (a portal), where `setPointerCapture` can throw
 * `InvalidStateError`. The handler used to call it BEFORE seeding the draft
 * box, so a throw silently aborted the draw — points worked (no capture) but
 * the box never appeared. The fix seeds the draft first and guards capture.
 *
 * happy-dom doesn't implement pointer capture, so we install a THROWING
 * `setPointerCapture` on the frame element to stand in for the real-browser
 * failure, then assert the box still commits.
 */

// Minimal Image stand-in so `loadImageDims` resolves (happy-dom doesn't fire
// load events when `src` is assigned).
class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 400;
  naturalHeight = 300;
  private _src = "";
  set src(v: string) {
    this._src = v;
    setTimeout(() => this.onload?.(), 0);
  }
  get src() {
    return this._src;
  }
}

beforeEach(() => {
  extractFrame.mockReset();
  extractFrame.mockResolvedValue(new Blob(["x"], { type: "image/png" }));
  vi.stubGlobal("Image", FakeImage as unknown as typeof Image);
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn(() => "blob:frame"),
    revokeObjectURL: vi.fn(),
  });
});

async function openEditorAndGetFrame() {
  const frame = await screen.findByAltText("First frame");
  const frameDiv = frame.parentElement as HTMLElement;
  // Real layout so normalised coords are deterministic: 400×300 at the origin.
  frameDiv.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300, x: 0, y: 0, toJSON() {} }) as DOMRect;
  return frameDiv;
}

describe("Sam31MaskEditor — box drawing", () => {
  it("commits a box from a drag even when setPointerCapture throws (portal)", async () => {
    const onChange = vi.fn();
    render(
      <Sam31MaskEditor
        videoUrl="https://x/v.mp4"
        points={[]}
        box={null}
        onChange={onChange}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /Mark object visually/i }),
    );
    const frameDiv = await openEditorAndGetFrame();

    // Stand in for the Base UI portal where setPointerCapture throws.
    frameDiv.setPointerCapture = () => {
      throw new Error("InvalidStateError");
    };

    fireEvent.pointerDown(frameDiv, { clientX: 40, clientY: 30, pointerId: 1 });
    fireEvent.pointerMove(frameDiv, { clientX: 200, clientY: 150, pointerId: 1 });
    fireEvent.pointerUp(frameDiv, { clientX: 200, clientY: 150, pointerId: 1 });

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const arg = onChange.mock.calls.at(-1)![0] as {
      box?: { x0: number; y0: number; x1: number; y1: number };
    };
    expect(arg.box).toBeTruthy();
    expect(arg.box!.x0).toBeCloseTo(0.1, 5);
    expect(arg.box!.y0).toBeCloseTo(0.1, 5);
    expect(arg.box!.x1).toBeCloseTo(0.5, 5);
    expect(arg.box!.y1).toBeCloseTo(0.5, 5);
  });

  it("ignores a click-sized (non-drag) box", async () => {
    const onChange = vi.fn();
    render(
      <Sam31MaskEditor
        videoUrl="https://x/v.mp4"
        points={[]}
        box={null}
        onChange={onChange}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Mark object visually/i }),
    );
    const frameDiv = await openEditorAndGetFrame();

    // Down + up at (nearly) the same spot → below the 2% threshold → no box.
    fireEvent.pointerDown(frameDiv, { clientX: 40, clientY: 30, pointerId: 1 });
    fireEvent.pointerUp(frameDiv, { clientX: 41, clientY: 31, pointerId: 1 });

    expect(onChange).not.toHaveBeenCalled();
  });
});
