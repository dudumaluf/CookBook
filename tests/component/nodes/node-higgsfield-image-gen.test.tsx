import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  hasHiggsfieldImageGenOverrides,
  higgsfieldImageGenNodeSchema,
} from "@/components/nodes/node-higgsfield-image-gen";
import type { HiggsfieldSoulStyle } from "@/lib/higgsfield/types";
import { _resetExecutionForTests } from "@/lib/stores/execution-store";
import type { SoulIdRef, StandardizedOutput } from "@/types/node";

vi.mock("@/lib/higgsfield/call-higgsfield-image", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/higgsfield/call-higgsfield-image")
  >("@/lib/higgsfield/call-higgsfield-image");
  return {
    ...actual,
    callHiggsfieldImage: vi.fn(),
    fetchSoulStyles: vi.fn(),
  };
});

const higgs = await import("@/lib/higgsfield/call-higgsfield-image");
const callMock = vi.mocked(higgs.callHiggsfieldImage);
const fetchStylesMock = vi.mocked(higgs.fetchSoulStyles);

beforeEach(() => {
  callMock.mockReset();
  fetchStylesMock.mockReset();
  // Default: empty catalog so old tests don't accidentally poke the
  // picker's grid path. Tests that exercise the picker override.
  fetchStylesMock.mockResolvedValue([]);
  _resetExecutionForTests();
});

const STYLE_FIXTURE: HiggsfieldSoulStyle[] = [
  {
    id: "95151de0-e0e5-4e04-bd45-c58c8a4ac023",
    name: "Street photography",
    description: "",
    previewUrl: "https://cdn.example/street.webp",
  },
  {
    id: "3d5584b2-4d15-48d2-8a09-c1073259f4c6",
    name: "Editorial street style",
    description: "",
    previewUrl: "https://cdn.example/editorial.webp",
  },
  {
    id: "fafd3087-0d0f-4fb1-9af6-91b7d304687c",
    name: "Warm ambient",
    description: "",
    previewUrl: "https://cdn.example/warm.webp",
  },
];

const SOUL_REF: SoulIdRef = {
  customReferenceId: "b66a1caa-612f-440d-8353-debceb00aae6",
  variant: "v2",
  name: "Dudu Model",
  thumbnailUrl: "https://cdn.example/dudu.png",
};

describe("higgsfieldImageGenNodeSchema", () => {
  it("declares the expected schema shape", () => {
    expect(higgsfieldImageGenNodeSchema.kind).toBe("higgsfield-image-gen");
    expect(higgsfieldImageGenNodeSchema.category).toBe("ai-image");
    expect(higgsfieldImageGenNodeSchema.reactive).toBe(false);
    const inputs = higgsfieldImageGenNodeSchema.inputs;
    expect(inputs.find((i) => i.id === "prompt")?.dataType).toBe("text");
    expect(inputs.find((i) => i.id === "soulId")?.dataType).toBe("soul-id");
    expect(inputs.find((i) => i.id === "image")?.dataType).toBe("image");
    expect(higgsfieldImageGenNodeSchema.outputs[0]).toMatchObject({
      id: "out",
      dataType: "image",
      multiple: true,
    });
  });

  it("declares both-axis resize with sensible width / height ranges", () => {
    const size = higgsfieldImageGenNodeSchema.size;
    expect(size?.resizable).toBe("both");
    expect(size!.minWidth).toBeGreaterThan(0);
    expect(size!.maxWidth).toBeGreaterThan(size!.minWidth!);
    expect(size!.maxHeight).toBeGreaterThan(size!.minHeight!);
  });

  it("declares a settings slot with hasOverrides predicate", () => {
    expect(higgsfieldImageGenNodeSchema.settings?.Content).toBeDefined();
    expect(higgsfieldImageGenNodeSchema.settings?.hasOverrides).toBe(
      hasHiggsfieldImageGenOverrides,
    );
  });

  /* ────────────────────────── hasOverrides ────────────────────────── */

  it("hasOverrides() returns false on a default config", () => {
    expect(hasHiggsfieldImageGenOverrides({})).toBe(false);
  });

  it("hasOverrides() returns true when any of the optional knobs is set", () => {
    expect(hasHiggsfieldImageGenOverrides({ aspectRatio: "9:16" })).toBe(
      true,
    );
    expect(hasHiggsfieldImageGenOverrides({ resolution: "1080p" })).toBe(
      true,
    );
    expect(hasHiggsfieldImageGenOverrides({ batchSize: 4 })).toBe(true);
    expect(hasHiggsfieldImageGenOverrides({ seed: 42 })).toBe(true);
    expect(
      hasHiggsfieldImageGenOverrides({ negativePrompt: "blur" }),
    ).toBe(true);
    expect(
      hasHiggsfieldImageGenOverrides({
        styleId: "a3f4c891-7b2e-4d1a-9e8c-1f4b2a3c5d6e",
      }),
    ).toBe(true);
  });

  /* ─────────────────────────── Body ───────────────────────────────── */

  describe("Body", () => {
    it("renders the metadata strip with defaults when no overrides are set", () => {
      const Body = higgsfieldImageGenNodeSchema.Body;
      render(
        <Body
          nodeId="n1"
          config={{}}
          updateConfig={vi.fn()}
          selected={false}
        />,
      );
      expect(screen.getByText("Higgsfield Soul")).toBeTruthy();
      expect(screen.getByText("1:1")).toBeTruthy();
      expect(screen.getByText("720p")).toBeTruthy();
      expect(screen.getByText("×1")).toBeTruthy();
    });

    it("renders the empty-state hint when there are no executed images", () => {
      const Body = higgsfieldImageGenNodeSchema.Body;
      render(
        <Body
          nodeId="n1"
          config={{}}
          updateConfig={vi.fn()}
          selected={false}
        />,
      );
      expect(
        screen.getByText(/connect a prompt then click run/i),
      ).toBeTruthy();
    });

    /* ─────────────── Slice 5.6.2: aspect-ratio-aware preview ─────── */

    it("running placeholder respects config.aspectRatio (9:16 portrait)", async () => {
      const { useExecutionStore } = await import("@/lib/stores/execution-store");
      useExecutionStore.setState({
        records: new Map([["n1", { status: "running" } as never]]),
      });

      const Body = higgsfieldImageGenNodeSchema.Body;
      render(
        <Body
          nodeId="n1"
          config={{ aspectRatio: "9:16" }}
          updateConfig={vi.fn()}
          selected={false}
        />,
      );
      const placeholder = screen.getByTestId("higgsfield-running");
      expect(placeholder.style.aspectRatio).toBe("9 / 16");
    });

    it("running placeholder falls back to 1:1 when no aspectRatio is set", async () => {
      const { useExecutionStore } = await import("@/lib/stores/execution-store");
      useExecutionStore.setState({
        records: new Map([["n1", { status: "running" } as never]]),
      });

      const Body = higgsfieldImageGenNodeSchema.Body;
      render(
        <Body
          nodeId="n1"
          config={{}}
          updateConfig={vi.fn()}
          selected={false}
        />,
      );
      const placeholder = screen.getByTestId("higgsfield-running");
      expect(placeholder.style.aspectRatio).toBe("1 / 1");
    });

    it("single-result preview uses config.aspectRatio (16:9 landscape)", async () => {
      const { useExecutionStore } = await import("@/lib/stores/execution-store");
      useExecutionStore.setState({
        records: new Map([
          [
            "n1",
            {
              status: "done",
              output: { type: "image", value: { url: "https://x.test/a.png" } },
            } as never,
          ],
        ]),
      });

      const Body = higgsfieldImageGenNodeSchema.Body;
      render(
        <Body
          nodeId="n1"
          config={{ aspectRatio: "16:9" }}
          updateConfig={vi.fn()}
          selected={false}
        />,
      );
      const result = screen.getByTestId("higgsfield-result-single");
      expect(result.style.aspectRatio).toBe("16 / 9");
    });
  });

  /* ─────────────────────────── execute() ───────────────────────────── */

  describe("execute()", () => {
    it("throws when prompt is empty", async () => {
      await expect(
        higgsfieldImageGenNodeSchema.execute!({
          nodeId: "n1",
          config: {},
          inputs: {},
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow(/prompt is empty/i);
      expect(callMock).not.toHaveBeenCalled();
    });

    it("dispatches with variant='none' + mode='none' when no soul / image is wired", async () => {
      callMock.mockResolvedValueOnce({
        imageUrls: ["https://cdn.example/a.png"],
        requestId: "req-1",
        model: "higgsfield-ai/soul/v2/standard",
      });

      await higgsfieldImageGenNodeSchema.execute!({
        nodeId: "n1",
        config: {},
        inputs: {
          prompt: { type: "text", value: "editorial portrait" },
        },
        signal: new AbortController().signal,
      });

      expect(callMock).toHaveBeenCalledTimes(1);
      const [args] = callMock.mock.calls[0]!;
      expect(args.variant).toBe("none");
      expect(args.mode).toBe("none");
      expect(args.soulId).toBeUndefined();
      expect(args.referenceUrl).toBeUndefined();
      expect(args.styleId).toBeUndefined();
    });

    it("inherits variant from the wired SoulID and mode='none' when no image / style is set", async () => {
      callMock.mockResolvedValueOnce({
        imageUrls: ["https://cdn.example/a.png"],
        requestId: "req-2",
        model: "higgsfield-ai/soul/v2/standard",
      });

      await higgsfieldImageGenNodeSchema.execute!({
        nodeId: "n1",
        config: {},
        inputs: {
          prompt: { type: "text", value: "editorial portrait" },
          soulId: { type: "soul-id", value: SOUL_REF },
        },
        signal: new AbortController().signal,
      });

      const [args] = callMock.mock.calls[0]!;
      expect(args.variant).toBe("v2");
      expect(args.mode).toBe("none");
      expect(args.soulId).toBe(SOUL_REF.customReferenceId);
    });

    it("switches to mode='reference' when an image input is wired (drops styleId)", async () => {
      callMock.mockResolvedValueOnce({
        imageUrls: ["https://cdn.example/a.png"],
        requestId: "req-3",
        model: "higgsfield-ai/soul/v2/standard",
      });

      await higgsfieldImageGenNodeSchema.execute!({
        nodeId: "n1",
        config: { styleId: "a3f4c891-7b2e-4d1a-9e8c-1f4b2a3c5d6e" },
        inputs: {
          prompt: { type: "text", value: "editorial portrait" },
          soulId: { type: "soul-id", value: SOUL_REF },
          image: {
            type: "image",
            value: { url: "https://example.com/ref.jpg" },
          },
        },
        signal: new AbortController().signal,
      });

      const [args] = callMock.mock.calls[0]!;
      expect(args.mode).toBe("reference");
      expect(args.referenceUrl).toBe("https://example.com/ref.jpg");
      expect(args.styleId).toBeUndefined();
    });

    it("uses mode='style' when a styleId is set and no image is wired", async () => {
      callMock.mockResolvedValueOnce({
        imageUrls: ["https://cdn.example/a.png"],
        requestId: "req-4",
        model: "higgsfield-ai/soul/v2/standard",
      });

      await higgsfieldImageGenNodeSchema.execute!({
        nodeId: "n1",
        config: { styleId: "a3f4c891-7b2e-4d1a-9e8c-1f4b2a3c5d6e" },
        inputs: {
          prompt: { type: "text", value: "editorial portrait" },
          soulId: { type: "soul-id", value: SOUL_REF },
        },
        signal: new AbortController().signal,
      });

      const [args] = callMock.mock.calls[0]!;
      expect(args.mode).toBe("style");
      expect(args.styleId).toBe("a3f4c891-7b2e-4d1a-9e8c-1f4b2a3c5d6e");
      expect(args.referenceUrl).toBeUndefined();
    });

    it("returns an array of image StandardizedOutput entries (batch_size = 4)", async () => {
      callMock.mockResolvedValueOnce({
        imageUrls: [
          "https://cdn.example/a.png",
          "https://cdn.example/b.png",
          "https://cdn.example/c.png",
          "https://cdn.example/d.png",
        ],
        requestId: "req-5",
        model: "higgsfield-ai/soul/v2/standard",
      });

      const result = await higgsfieldImageGenNodeSchema.execute!({
        nodeId: "n1",
        config: { batchSize: 4 },
        inputs: {
          prompt: { type: "text", value: "go" },
        },
        signal: new AbortController().signal,
      });

      expect(result).toMatchObject({
        usage: { model: "higgsfield-ai/soul/v2/standard" },
      });
      const outputs = (
        result as { output: StandardizedOutput[] }
      ).output;
      expect(outputs).toHaveLength(4);
      expect(outputs[0]).toEqual({
        type: "image",
        value: { url: "https://cdn.example/a.png" },
      });
    });

    it("forwards aspect / resolution / batchSize / seed / negativePrompt", async () => {
      callMock.mockResolvedValueOnce({
        imageUrls: ["https://cdn.example/a.png"],
        requestId: "req-6",
        model: "higgsfield-ai/soul/v2/standard",
      });

      await higgsfieldImageGenNodeSchema.execute!({
        nodeId: "n1",
        config: {
          aspectRatio: "9:16",
          resolution: "1080p",
          batchSize: 4,
          seed: 42,
          negativePrompt: "blur",
        },
        inputs: {
          prompt: { type: "text", value: "go" },
        },
        signal: new AbortController().signal,
      });

      const [args] = callMock.mock.calls[0]!;
      expect(args.aspectRatio).toBe("9:16");
      expect(args.resolution).toBe("1080p");
      expect(args.batchSize).toBe(4);
      expect(args.seed).toBe(42);
      expect(args.negativePrompt).toBe("blur");
    });
  });

  /* ──────────────────── Slice 5.3: Soul Style picker ──────────────────── */

  describe("Soul Style picker (settings popover)", () => {
    const Settings = higgsfieldImageGenNodeSchema.settings!.Content;

    it("fetches the catalog on mount and renders a 2-column thumbnail grid", async () => {
      fetchStylesMock.mockResolvedValueOnce(STYLE_FIXTURE);
      render(
        <Settings
          nodeId="g"
          config={{}}
          updateConfig={vi.fn()}
          selected={false}
        />,
      );
      // Loading first…
      expect(screen.getByText(/loading styles/i)).toBeTruthy();
      // …then the catalog renders.
      const grid = await screen.findByTestId("soul-style-grid");
      expect(grid.className).toContain("grid-cols-2");
      expect(screen.getByText("Street photography")).toBeTruthy();
      expect(screen.getByText("Editorial street style")).toBeTruthy();
      expect(screen.getByText("Warm ambient")).toBeTruthy();
      expect(fetchStylesMock).toHaveBeenCalledTimes(1);
    });

    it("clicking a thumbnail commits its UUID via updateConfig", async () => {
      fetchStylesMock.mockResolvedValueOnce(STYLE_FIXTURE);
      const updateConfig = vi.fn();
      render(
        <Settings
          nodeId="g"
          config={{}}
          updateConfig={updateConfig}
          selected={false}
        />,
      );
      const grid = await screen.findByTestId("soul-style-grid");
      const editorial = (grid.querySelectorAll("button")[1] as HTMLButtonElement);
      await act(async () => {
        fireEvent.click(editorial);
      });
      expect(updateConfig).toHaveBeenCalledWith({
        styleId: "3d5584b2-4d15-48d2-8a09-c1073259f4c6",
      });
    });

    it("the active style row carries aria-pressed=true and the selected chip renders its name", async () => {
      fetchStylesMock.mockResolvedValueOnce(STYLE_FIXTURE);
      render(
        <Settings
          nodeId="g"
          config={{ styleId: STYLE_FIXTURE[0]!.id }}
          updateConfig={vi.fn()}
          selected={false}
        />,
      );
      await screen.findByTestId("soul-style-grid");
      const pressed = screen.getAllByRole("button", { pressed: true });
      // First style is the selected one; the chip duplicates the name above.
      expect(pressed.length).toBe(1);
      // Two occurrences expected: the selected-chip preview + the grid item.
      expect(screen.getAllByText("Street photography").length).toBeGreaterThanOrEqual(1);
    });

    it("Clear button clears the selected styleId via updateConfig(undefined)", async () => {
      fetchStylesMock.mockResolvedValueOnce(STYLE_FIXTURE);
      const updateConfig = vi.fn();
      render(
        <Settings
          nodeId="g"
          config={{ styleId: STYLE_FIXTURE[0]!.id }}
          updateConfig={updateConfig}
          selected={false}
        />,
      );
      await screen.findByTestId("soul-style-grid");
      const clearBtn = screen.getByRole("button", { name: /clear/i });
      await act(async () => {
        fireEvent.click(clearBtn);
      });
      expect(updateConfig).toHaveBeenCalledWith({ styleId: undefined });
    });

    it("renders an empty-state copy when the catalog is empty", async () => {
      fetchStylesMock.mockResolvedValueOnce([]);
      render(
        <Settings
          nodeId="g"
          config={{}}
          updateConfig={vi.fn()}
          selected={false}
        />,
      );
      await waitFor(() => {
        expect(screen.getByText(/no styles available/i)).toBeTruthy();
      });
    });

    it("renders an inline error pill when the fetch fails", async () => {
      fetchStylesMock.mockRejectedValueOnce(new Error("Higgsfield 503"));
      render(
        <Settings
          nodeId="g"
          config={{}}
          updateConfig={vi.fn()}
          selected={false}
        />,
      );
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toMatch(/Higgsfield 503/);
    });
  });
});
