import { describe, expect, it } from "vitest";

import {
  __testHooks,
  textConcatNodeSchema,
} from "@/components/nodes/node-text-concat";
import type { ExecContext, StandardizedOutput } from "@/types/node";

const txt = (value: string): StandardizedOutput => ({ type: "text", value });

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

describe("text-concat schema basics", () => {
  it("registers as a reactive compose node emitting text", () => {
    expect(textConcatNodeSchema.kind).toBe("text-concat");
    expect(textConcatNodeSchema.category).toBe("compose");
    expect(textConcatNodeSchema.reactive).toBe(true);
    expect(textConcatNodeSchema.outputs.map((o) => o.dataType)).toEqual(["text"]);
  });

  it("starts with two ordered text sockets and grows with portCount", () => {
    expect(textConcatNodeSchema.inputs.map((h) => h.id)).toEqual([
      "text-0",
      "text-1",
    ]);
    expect(
      textConcatNodeSchema.getInputs!({ portCount: 4 }).map((h) => h.id),
    ).toEqual(["text-0", "text-1", "text-2", "text-3"]);
  });

  it("clamps portCount to MIN..MAX so a malicious config can't explode the UI", () => {
    expect(
      textConcatNodeSchema.getInputs!({ portCount: 0 } as never).map((h) => h.id),
    ).toEqual(["text-0", "text-1"]);
    expect(
      textConcatNodeSchema.getInputs!({ portCount: 9999 } as never),
    ).toHaveLength(__testHooks.MAX_PORTS);
  });
});

describe("text-concat execute", () => {
  it("joins wired text-N inputs in port order with the default blank-line separator", async () => {
    const out = (await textConcatNodeSchema.execute!(
      ctx(
        {
          "text-0": txt("Hello"),
          "text-1": txt("World"),
        },
        { portCount: 2 },
      ) as never,
    )) as StandardizedOutput;
    expect(out).toEqual(txt("Hello\n\nWorld"));
  });

  it("respects the configured separator", async () => {
    const out = (await textConcatNodeSchema.execute!(
      ctx(
        {
          "text-0": txt("a"),
          "text-1": txt("b"),
          "text-2": txt("c"),
        },
        { separator: " — ", portCount: 3 },
      ) as never,
    )) as StandardizedOutput;
    expect(out).toEqual(txt("a — b — c"));
  });

  it("skips empty / whitespace-only chunks by default (no stranded separators)", async () => {
    const out = (await textConcatNodeSchema.execute!(
      ctx(
        {
          "text-0": txt("first"),
          "text-1": txt("   "),
          "text-2": txt("third"),
        },
        { portCount: 3 },
      ) as never,
    )) as StandardizedOutput;
    expect(out).toEqual(txt("first\n\nthird"));
  });

  it("preserves blanks (and stranded separators) when skipEmpty is opted out", async () => {
    const out = (await textConcatNodeSchema.execute!(
      ctx(
        {
          "text-0": txt("a"),
          "text-2": txt("c"),
        },
        { separator: ",", skipEmpty: false, portCount: 3 },
      ) as never,
    )) as StandardizedOutput;
    // Middle slot is undefined → rendered as "" so we get "a,,c".
    expect(out).toEqual(txt("a,,c"));
  });

  it("returns the empty string when nothing is wired", async () => {
    const out = (await textConcatNodeSchema.execute!(
      ctx({}, { portCount: 2 }) as never,
    )) as StandardizedOutput;
    expect(out).toEqual(txt(""));
  });

  it("ignores upstreams that aren't text-typed (no crash, just skipped)", async () => {
    const out = (await textConcatNodeSchema.execute!(
      ctx(
        {
          "text-0": txt("hello"),
          "text-1": { type: "image", value: { url: "x" } },
          "text-2": txt("world"),
        },
        { portCount: 3 },
      ) as never,
    )) as StandardizedOutput;
    // text-1 is an image → undefined → skipped (skipEmpty default true).
    expect(out).toEqual(txt("hello\n\nworld"));
  });
});

describe("joinChunks (pure helper)", () => {
  const { joinChunks, DEFAULT_SEPARATOR } = __testHooks;

  it("uses the default separator when nothing is configured", () => {
    expect(DEFAULT_SEPARATOR).toBe("\n\n");
    expect(joinChunks(["a", "b"], DEFAULT_SEPARATOR, true)).toBe("a\n\nb");
  });

  it("filters undefined chunks regardless of skipEmpty when skipEmpty=true", () => {
    expect(joinChunks(["a", undefined, "b"], "·", true)).toBe("a·b");
  });

  it("treats undefined as '' when skipEmpty=false", () => {
    expect(joinChunks(["a", undefined, "b"], "·", false)).toBe("a··b");
  });
});
