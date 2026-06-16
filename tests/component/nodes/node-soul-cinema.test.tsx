import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  hasSoulCinemaOverrides,
  soulCinemaNodeSchema,
} from "@/components/nodes/node-soul-cinema";
import { _resetExecutionForTests } from "@/lib/stores/execution-store";
import type { SoulIdRef, StandardizedOutput } from "@/types/node";

vi.mock("@/lib/higgsfield/call-higgsfield-image", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/higgsfield/call-higgsfield-image")
  >("@/lib/higgsfield/call-higgsfield-image");
  return {
    ...actual,
    callHiggsfieldImage: vi.fn(),
  };
});

const higgs = await import("@/lib/higgsfield/call-higgsfield-image");
const callMock = vi.mocked(higgs.callHiggsfieldImage);

beforeEach(() => {
  callMock.mockReset();
  _resetExecutionForTests();
});

const CINEMA_SOUL: SoulIdRef = {
  customReferenceId: "b66a1caa-612f-440d-8353-debceb00aae6",
  variant: "cinema",
  name: "Dudu Cinema",
};

describe("soulCinemaNodeSchema", () => {
  it("declares the expected schema shape", () => {
    expect(soulCinemaNodeSchema.kind).toBe("soul-cinema");
    expect(soulCinemaNodeSchema.category).toBe("ai-image");
    expect(soulCinemaNodeSchema.reactive).toBe(false);
    const inputs = soulCinemaNodeSchema.inputs;
    expect(inputs.find((i) => i.id === "prompt")?.dataType).toBe("text");
    expect(inputs.find((i) => i.id === "image")?.dataType).toBe("image");
    expect(inputs.find((i) => i.id === "soulId")?.dataType).toBe("soul-id");
    expect(soulCinemaNodeSchema.outputs[0]).toMatchObject({
      id: "out",
      dataType: "image",
      multiple: true,
    });
  });

  it("declares a settings slot with hasOverrides predicate", () => {
    expect(soulCinemaNodeSchema.settings?.Content).toBeDefined();
    expect(soulCinemaNodeSchema.settings?.hasOverrides).toBe(
      hasSoulCinemaOverrides,
    );
  });

  /* ────────────────────────── hasOverrides ────────────────────────── */

  it("hasOverrides() is false on a default config", () => {
    expect(hasSoulCinemaOverrides({})).toBe(false);
    // enhancePrompt true is the default — not an override.
    expect(hasSoulCinemaOverrides({ enhancePrompt: true })).toBe(false);
  });

  it("hasOverrides() is true when any knob deviates from defaults", () => {
    expect(hasSoulCinemaOverrides({ aspectRatio: "21:9" })).toBe(true);
    expect(hasSoulCinemaOverrides({ resolution: "1080p" })).toBe(true);
    expect(hasSoulCinemaOverrides({ batchSize: 4 })).toBe(true);
    expect(hasSoulCinemaOverrides({ seed: 42 })).toBe(true);
    expect(hasSoulCinemaOverrides({ negativePrompt: "blur" })).toBe(true);
    expect(hasSoulCinemaOverrides({ enhancePrompt: false })).toBe(true);
  });

  /* ─────────────────────────── Body ───────────────────────────────── */

  describe("Body", () => {
    it("renders the metadata strip defaulting to a cinematic 16:9", () => {
      const Body = soulCinemaNodeSchema.Body;
      render(
        <Body nodeId="n1" config={{}} updateConfig={vi.fn()} selected={false} />,
      );
      expect(screen.getByText("Soul Cinema")).toBeTruthy();
      expect(screen.getByText("16:9")).toBeTruthy();
      expect(screen.getByText("720p")).toBeTruthy();
      expect(screen.getByText("×1")).toBeTruthy();
    });

    it("renders the empty-state hint with no executed images", () => {
      const Body = soulCinemaNodeSchema.Body;
      render(
        <Body nodeId="n1" config={{}} updateConfig={vi.fn()} selected={false} />,
      );
      expect(
        screen.getByText(/connect a prompt then click run/i),
      ).toBeTruthy();
    });

    it("running placeholder respects an ultra-wide 21:9 aspect", async () => {
      const { useExecutionStore } = await import(
        "@/lib/stores/execution-store"
      );
      useExecutionStore.setState({
        records: new Map([["n1", { status: "running" } as never]]),
      });

      const Body = soulCinemaNodeSchema.Body;
      render(
        <Body
          nodeId="n1"
          config={{ aspectRatio: "21:9" }}
          updateConfig={vi.fn()}
          selected={false}
        />,
      );
      const placeholder = screen.getByTestId("soul-cinema-running");
      expect(placeholder.style.aspectRatio).toBe("21 / 9");
    });

    it("running placeholder falls back to 16:9 when no aspectRatio is set", async () => {
      const { useExecutionStore } = await import(
        "@/lib/stores/execution-store"
      );
      useExecutionStore.setState({
        records: new Map([["n1", { status: "running" } as never]]),
      });

      const Body = soulCinemaNodeSchema.Body;
      render(
        <Body nodeId="n1" config={{}} updateConfig={vi.fn()} selected={false} />,
      );
      const placeholder = screen.getByTestId("soul-cinema-running");
      expect(placeholder.style.aspectRatio).toBe("16 / 9");
    });
  });

  /* ─────────────────────────── Settings ───────────────────────────── */

  describe("Settings", () => {
    const Settings = soulCinemaNodeSchema.settings!.Content;

    it("offers 21:9 in the aspect-ratio dropdown", () => {
      render(
        <Settings
          nodeId="g"
          config={{}}
          updateConfig={vi.fn()}
          selected={false}
        />,
      );
      const option = screen.getByRole("option", {
        name: "21:9",
      }) as HTMLOptionElement;
      expect(option).toBeTruthy();
    });

    it("toggling enhance prompt off persists enhancePrompt=false", () => {
      const updateConfig = vi.fn();
      render(
        <Settings
          nodeId="g"
          config={{}}
          updateConfig={updateConfig}
          selected={false}
        />,
      );
      const checkbox = screen.getByRole("checkbox", {
        name: /enhance prompt/i,
      });
      // Default config => checked.
      expect((checkbox as HTMLInputElement).checked).toBe(true);
      act(() => {
        fireEvent.click(checkbox);
      });
      expect(updateConfig).toHaveBeenCalledWith({ enhancePrompt: false });
    });
  });

  /* ─────────────────────────── execute() ───────────────────────────── */

  describe("execute()", () => {
    it("throws when prompt is empty", async () => {
      await expect(
        soulCinemaNodeSchema.execute!({
          nodeId: "n1",
          config: {},
          inputs: {},
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow(/prompt is empty/i);
      expect(callMock).not.toHaveBeenCalled();
    });

    it("always dispatches variant='cinema' + mode='none' with just a prompt", async () => {
      callMock.mockResolvedValueOnce({
        imageUrls: ["https://cdn.example/a.png"],
        requestId: "req-1",
        model: "higgsfield-ai/soul/cinema",
      });

      await soulCinemaNodeSchema.execute!({
        nodeId: "n1",
        config: {},
        inputs: { prompt: { type: "text", value: "a moody noir alley" } },
        signal: new AbortController().signal,
      });

      expect(callMock).toHaveBeenCalledTimes(1);
      const [args] = callMock.mock.calls[0]!;
      expect(args.variant).toBe("cinema");
      expect(args.mode).toBe("none");
      expect(args.soulId).toBeUndefined();
      expect(args.referenceUrl).toBeUndefined();
      expect(args.aspectRatio).toBe("16:9");
    });

    it("keeps variant='cinema' even when a non-cinema Soul ID is wired (just forwards the id)", async () => {
      callMock.mockResolvedValueOnce({
        imageUrls: ["https://cdn.example/a.png"],
        requestId: "req-2",
        model: "higgsfield-ai/soul/cinema",
      });

      await soulCinemaNodeSchema.execute!({
        nodeId: "n1",
        config: {},
        inputs: {
          prompt: { type: "text", value: "portrait" },
          soulId: {
            type: "soul-id",
            value: { ...CINEMA_SOUL, variant: "v2" },
          },
        },
        signal: new AbortController().signal,
      });

      const [args] = callMock.mock.calls[0]!;
      expect(args.variant).toBe("cinema");
      expect(args.soulId).toBe(CINEMA_SOUL.customReferenceId);
    });

    it("switches to mode='reference' when an image input is wired", async () => {
      callMock.mockResolvedValueOnce({
        imageUrls: ["https://cdn.example/a.png"],
        requestId: "req-3",
        model: "higgsfield-ai/soul/cinema",
      });

      await soulCinemaNodeSchema.execute!({
        nodeId: "n1",
        config: {},
        inputs: {
          prompt: { type: "text", value: "portrait" },
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
    });

    it("forwards aspect (incl 21:9) / resolution / batch / seed / negative / enhance", async () => {
      callMock.mockResolvedValueOnce({
        imageUrls: ["https://cdn.example/a.png"],
        requestId: "req-4",
        model: "higgsfield-ai/soul/cinema",
      });

      await soulCinemaNodeSchema.execute!({
        nodeId: "n1",
        config: {
          aspectRatio: "21:9",
          resolution: "1080p",
          batchSize: 4,
          seed: 42,
          negativePrompt: "blur",
          enhancePrompt: false,
        },
        inputs: { prompt: { type: "text", value: "go" } },
        signal: new AbortController().signal,
      });

      const [args] = callMock.mock.calls[0]!;
      expect(args.aspectRatio).toBe("21:9");
      expect(args.resolution).toBe("1080p");
      expect(args.batchSize).toBe(4);
      expect(args.seed).toBe(42);
      expect(args.negativePrompt).toBe("blur");
      expect(args.enhancePrompt).toBe(false);
    });

    it("never sends a styleId (cinema rejects style presets)", async () => {
      callMock.mockResolvedValueOnce({
        imageUrls: ["https://cdn.example/a.png"],
        requestId: "req-5",
        model: "higgsfield-ai/soul/cinema",
      });

      await soulCinemaNodeSchema.execute!({
        nodeId: "n1",
        config: {},
        inputs: { prompt: { type: "text", value: "go" } },
        signal: new AbortController().signal,
      });

      const [args] = callMock.mock.calls[0]!;
      expect(args.styleId).toBeUndefined();
    });

    it("returns an array of image StandardizedOutput entries (batch 4)", async () => {
      callMock.mockResolvedValueOnce({
        imageUrls: [
          "https://cdn.example/a.png",
          "https://cdn.example/b.png",
          "https://cdn.example/c.png",
          "https://cdn.example/d.png",
        ],
        requestId: "req-6",
        model: "higgsfield-ai/soul/cinema",
      });

      const result = await soulCinemaNodeSchema.execute!({
        nodeId: "n1",
        config: { batchSize: 4 },
        inputs: { prompt: { type: "text", value: "go" } },
        signal: new AbortController().signal,
      });

      expect(result).toMatchObject({
        usage: { model: "higgsfield-ai/soul/cinema" },
      });
      const outputs = (result as { output: StandardizedOutput[] }).output;
      expect(outputs).toHaveLength(4);
      expect(outputs[0]).toEqual({
        type: "image",
        value: { url: "https://cdn.example/a.png" },
      });
    });
  });
});
