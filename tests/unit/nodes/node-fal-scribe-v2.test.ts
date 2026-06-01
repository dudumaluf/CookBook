import { beforeEach, describe, expect, it, vi } from "vitest";

const { callScribeV2 } = vi.hoisted(() => ({ callScribeV2: vi.fn() }));
vi.mock("@/lib/fal/call-scribe-v2", () => ({ callScribeV2 }));

import { scribeV2NodeSchema } from "@/components/nodes/node-fal-scribe-v2";
import type { ExecContext, StandardizedOutput } from "@/types/node";

type CtxArgs = Parameters<NonNullable<typeof scribeV2NodeSchema.execute>>[0];

function ctx(
  inputs: Record<string, StandardizedOutput | StandardizedOutput[] | undefined>,
  config: Record<string, unknown> = {},
): ExecContext {
  return {
    nodeId: "n1",
    config,
    inputs,
    signal: new AbortController().signal,
  } as ExecContext;
}

beforeEach(() => {
  callScribeV2.mockReset();
  callScribeV2.mockResolvedValue({
    text: "Hey, this is a test recording.",
    languageCode: "eng",
    languageProbability: 1,
    words: [
      {
        start: 0,
        end: 0.5,
        text: "Hey,",
        type: "word" as const,
        speakerId: "speaker_0",
      },
    ],
    model: "fal-ai/elevenlabs/speech-to-text/scribe-v2",
  });
});

describe("scribe-v2 node execute", () => {
  it("throws when no audio is wired", async () => {
    await expect(
      scribeV2NodeSchema.execute!(ctx({}) as CtxArgs),
    ).rejects.toThrow(/audio/i);
  });

  it("submits with audioUrl when audio is wired", async () => {
    await scribeV2NodeSchema.execute!(
      ctx({
        audio: { type: "audio", value: { url: "https://x/clip.mp3" } },
      }) as CtxArgs,
    );
    expect(callScribeV2).toHaveBeenCalledWith(
      expect.objectContaining({ audioUrl: "https://x/clip.mp3" }),
    );
  });

  it("forwards optional config (language, tagAudioEvents, diarize)", async () => {
    await scribeV2NodeSchema.execute!(
      ctx(
        { audio: { type: "audio", value: { url: "https://x/clip.mp3" } } },
        {
          languageCode: "spa",
          tagAudioEvents: false,
          diarize: false,
        },
      ) as CtxArgs,
    );
    expect(callScribeV2).toHaveBeenCalledWith(
      expect.objectContaining({
        audioUrl: "https://x/clip.mp3",
        languageCode: "spa",
        tagAudioEvents: false,
        diarize: false,
      }),
    );
  });

  it("forwards keyterms when present and non-empty", async () => {
    await scribeV2NodeSchema.execute!(
      ctx(
        { audio: { type: "audio", value: { url: "https://x/clip.mp3" } } },
        { keyterms: ["fal", "elevenlabs"] },
      ) as CtxArgs,
    );
    expect(callScribeV2).toHaveBeenCalledWith(
      expect.objectContaining({ keyterms: ["fal", "elevenlabs"] }),
    );
  });

  it("strips whitespace-only keyterms before forwarding", async () => {
    await scribeV2NodeSchema.execute!(
      ctx(
        { audio: { type: "audio", value: { url: "https://x/clip.mp3" } } },
        { keyterms: ["fal", "   ", "elevenlabs"] },
      ) as CtxArgs,
    );
    expect(callScribeV2).toHaveBeenCalledWith(
      expect.objectContaining({ keyterms: ["fal", "elevenlabs"] }),
    );
  });

  it("omits keyterms when empty array", async () => {
    await scribeV2NodeSchema.execute!(
      ctx(
        { audio: { type: "audio", value: { url: "https://x/clip.mp3" } } },
        { keyterms: [] },
      ) as CtxArgs,
    );
    const call = callScribeV2.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.keyterms).toBeUndefined();
  });

  it("trims whitespace from a wired language code", async () => {
    await scribeV2NodeSchema.execute!(
      ctx(
        { audio: { type: "audio", value: { url: "https://x/clip.mp3" } } },
        { languageCode: "  fra  " },
      ) as CtxArgs,
    );
    expect(callScribeV2).toHaveBeenCalledWith(
      expect.objectContaining({ languageCode: "fra" }),
    );
  });

  it("treats blank languageCode as auto-detect (omitted)", async () => {
    await scribeV2NodeSchema.execute!(
      ctx(
        { audio: { type: "audio", value: { url: "https://x/clip.mp3" } } },
        { languageCode: "   " },
      ) as CtxArgs,
    );
    const call = callScribeV2.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.languageCode).toBeUndefined();
  });

  it("emits the full transcript as the standardized text output", async () => {
    const result = await scribeV2NodeSchema.execute!(
      ctx({
        audio: { type: "audio", value: { url: "https://x/clip.mp3" } },
      }) as CtxArgs,
    );
    const out = (result as { output: StandardizedOutput }).output;
    expect(out.type).toBe("text");
    if (out.type === "text") {
      expect(out.value).toBe("Hey, this is a test recording.");
    }
  });

  it("is a non-reactive transform node with audio in / text out", () => {
    expect(scribeV2NodeSchema.kind).toBe("fal-scribe-v2");
    expect(scribeV2NodeSchema.category).toBe("transform");
    expect(scribeV2NodeSchema.reactive).toBe(false);
    expect(scribeV2NodeSchema.inputs.map((i) => i.id)).toEqual(["audio"]);
    expect(scribeV2NodeSchema.outputs[0]?.dataType).toBe("text");
  });
});
