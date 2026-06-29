import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

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
 * Regression test for the box-drawing bug: the mask editor lives inside a Base
 * UI Dialog whose Popup grabs POINTER CAPTURE on pointer-down (for its dismiss
 * logic). Once captured, every `pointermove` retargets to the popup, so an
 * element-level `onPointerMove` on the frame never fires and the box never
 * grows — a click still works, which is why the old points UI dropped points
 * fine but a box drag drew nothing. The fix drives the drag from WINDOW
 * listeners, which still receive the bubbled moves regardless of who holds
 * capture. We prove that by dispatching the move/up on `window` (NOT the frame),
 * standing in for capture being stolen. (Editor is box-only — Fal's SAM 3.1
 * video model 500s on point prompts; see ADR-0090.)
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

/** Dispatch a pointer event on `window` with the given client coords — stands
 * in for the Base UI Popup having stolen capture (moves never reach the frame). */
function winPointer(type: "pointermove" | "pointerup", x: number, y: number) {
  act(() => {
    window.dispatchEvent(
      Object.assign(new Event(type, { bubbles: true }), { clientX: x, clientY: y, pointerId: 1 }),
    );
  });
}

/** Mouse-family equivalent — stands in for an environment that suppresses
 * pointer events entirely, so only the mouse fallback fires. */
function winMouse(type: "mousemove" | "mouseup", x: number, y: number) {
  act(() => {
    window.dispatchEvent(
      Object.assign(new Event(type, { bubbles: true }), { clientX: x, clientY: y }),
    );
  });
}

describe("Sam31MaskEditor — box drawing", () => {
  it("commits a box from a drag even when capture is stolen (moves go to window)", async () => {
    const onChange = vi.fn();
    render(
      <Sam31MaskEditor videoUrl="https://x/v.mp4" box={null} onChange={onChange} />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /Draw a box around the object/i }),
    );
    const frameDiv = await openEditorAndGetFrame();

    // Press on the frame, but deliver the move + release on WINDOW only — the
    // frame element never sees them (capture stolen). The box must still draw.
    fireEvent.pointerDown(frameDiv, { clientX: 40, clientY: 30, pointerId: 1 });
    winPointer("pointermove", 200, 150);
    winPointer("pointerup", 200, 150);

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

  it("shows the draft box live while dragging (before release)", async () => {
    const onChange = vi.fn();
    render(
      <Sam31MaskEditor videoUrl="https://x/v.mp4" box={null} onChange={onChange} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Draw a box around the object/i }),
    );
    const frameDiv = await openEditorAndGetFrame();

    fireEvent.pointerDown(frameDiv, { clientX: 40, clientY: 30, pointerId: 1 });
    winPointer("pointermove", 200, 150);

    // A dashed draft rect is rendered inside the frame mid-drag (40%×40%).
    const draft = frameDiv.querySelector(".border-dashed") as HTMLElement | null;
    expect(draft).toBeTruthy();
    expect(draft!.style.width).toBe("40%");
    expect(draft!.style.height).toBe("40%");
  });

  it("commits a box via the mouse-event fallback (pointer events suppressed)", async () => {
    const onChange = vi.fn();
    render(
      <Sam31MaskEditor videoUrl="https://x/v.mp4" box={null} onChange={onChange} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Draw a box around the object/i }),
    );
    const frameDiv = await openEditorAndGetFrame();

    // Only the mouse family fires — no pointer events at all.
    fireEvent.mouseDown(frameDiv, { clientX: 40, clientY: 30, button: 0 });
    winMouse("mousemove", 200, 150);
    winMouse("mouseup", 200, 150);

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const arg = onChange.mock.calls.at(-1)![0] as {
      box?: { x0: number; y0: number; x1: number; y1: number };
    };
    expect(arg.box).toBeTruthy();
    expect(arg.box!.x0).toBeCloseTo(0.1, 5);
    expect(arg.box!.x1).toBeCloseTo(0.5, 5);
  });

  it("ignores a click-sized (non-drag) box", async () => {
    const onChange = vi.fn();
    render(
      <Sam31MaskEditor videoUrl="https://x/v.mp4" box={null} onChange={onChange} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Draw a box around the object/i }),
    );
    const frameDiv = await openEditorAndGetFrame();

    // Down + up at (nearly) the same spot → below the 2% threshold → no box.
    fireEvent.pointerDown(frameDiv, { clientX: 40, clientY: 30, pointerId: 1 });
    winPointer("pointerup", 41, 31);

    expect(onChange).not.toHaveBeenCalled();
  });
});
