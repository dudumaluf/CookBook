import { describe, expect, it } from "vitest";

import {
  __testHooks,
  textNodeSchema,
} from "@/components/nodes/node-text";
import type { ExecContext, StandardizedOutput } from "@/types/node";

const { parseVariables, renderTemplate, variableInputs } = __testHooks;

const txt = (value: string): StandardizedOutput => ({ type: "text", value });

function ctx(
  text: string,
  inputs: Record<string, StandardizedOutput | StandardizedOutput[] | undefined> = {},
): ExecContext {
  return {
    nodeId: "n1",
    config: { text },
    inputs,
    signal: new AbortController().signal,
  } as ExecContext;
}

/* ────────────────────────────────────────────────────────────────────── */
/* parseVariables                                                         */
/* ────────────────────────────────────────────────────────────────────── */

describe("parseVariables", () => {
  it("returns no variables for empty / plain text", () => {
    expect(parseVariables("")).toEqual([]);
    expect(parseVariables("hello world")).toEqual([]);
  });

  it("captures a single `@name` at the start of the body", () => {
    expect(parseVariables("@variable1 Morning")).toEqual(["variable1"]);
  });

  it("captures `@name` after whitespace, punctuation, or newline", () => {
    expect(parseVariables("hello @name")).toEqual(["name"]);
    expect(parseVariables("foo,@name")).toEqual(["name"]);
    expect(parseVariables("foo\n@name")).toEqual(["name"]);
  });

  it("captures multiple distinct variables in first-appearance order", () => {
    expect(parseVariables("@b first, then @a, then @c")).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("dedupes repeated occurrences while preserving order", () => {
    expect(parseVariables("@a is @a and @b")).toEqual(["a", "b"]);
  });

  it("ignores mid-word `@` so emails don't get clobbered", () => {
    expect(parseVariables("contact support@example.com please")).toEqual([]);
  });

  it("rejects names that don't start with a letter", () => {
    expect(parseVariables("@123 @_under @-dash @good")).toEqual(["good"]);
  });

  it("supports digits, underscores and hyphens after the leading letter", () => {
    expect(parseVariables("@v1 @user_id_42 @product-name")).toEqual([
      "v1",
      "user_id_42",
      "product-name",
    ]);
  });

  it("stops the name at the first non-class char (so `@name.foo` captures `name` only)", () => {
    expect(parseVariables("@name.foo")).toEqual(["name"]);
    expect(parseVariables("@name, @next")).toEqual(["name", "next"]);
  });
});

/* ────────────────────────────────────────────────────────────────────── */
/* renderTemplate                                                         */
/* ────────────────────────────────────────────────────────────────────── */

describe("renderTemplate", () => {
  it("substitutes wired values into the template", () => {
    expect(renderTemplate("@variable1 Morning", { variable1: "good" })).toBe(
      "good Morning",
    );
  });

  it("substitutes EVERY occurrence of a repeated `@name`", () => {
    expect(renderTemplate("@x and @x and @y", { x: "1", y: "2" })).toBe(
      "1 and 1 and 2",
    );
  });

  it("leaves unwired references LITERAL so the user can see what's missing", () => {
    expect(renderTemplate("Hello @audience", {})).toBe("Hello @audience");
    expect(
      renderTemplate("@known then @unknown", { known: "yes" }),
    ).toBe("yes then @unknown");
  });

  it("treats explicitly-undefined values as unwired (not as the string 'undefined')", () => {
    expect(
      renderTemplate("Hi @name", { name: undefined }),
    ).toBe("Hi @name");
  });

  it("does NOT substitute mid-word matches (email-safe)", () => {
    expect(
      renderTemplate("Email me at support@example.com", {
        example: "REPLACED",
      }),
    ).toBe("Email me at support@example.com");
  });

  it("substitutes empty strings cleanly", () => {
    expect(renderTemplate("[@x] is empty", { x: "" })).toBe("[] is empty");
  });
});

/* ────────────────────────────────────────────────────────────────────── */
/* variableInputs / schema getInputs                                      */
/* ────────────────────────────────────────────────────────────────────── */

describe("variableInputs / schema.getInputs", () => {
  it("returns one labeled `var-{name}` socket per parsed variable", () => {
    expect(variableInputs("Hello @audience and @topic")).toEqual([
      { id: "var-audience", label: "audience", dataType: "text" },
      { id: "var-topic", label: "topic", dataType: "text" },
    ]);
  });

  it("schema starts with no static inputs (fresh node has no variables)", () => {
    expect(textNodeSchema.inputs).toEqual([]);
  });

  it("schema.getInputs derives sockets from `config.text`", () => {
    expect(textNodeSchema.getInputs!({ text: "" }).map((h) => h.id)).toEqual([]);
    expect(
      textNodeSchema.getInputs!({ text: "@a and @b" }).map((h) => h.id),
    ).toEqual(["var-a", "var-b"]);
  });

  it("getInputs handles missing config.text gracefully", () => {
    // Belt-and-braces — execute() and getInputs both fall back to "".
    expect(
      textNodeSchema.getInputs!({} as unknown as { text: string }),
    ).toEqual([]);
  });
});

/* ────────────────────────────────────────────────────────────────────── */
/* execute                                                                */
/* ────────────────────────────────────────────────────────────────────── */

describe("textNodeSchema.execute", () => {
  it("returns the raw body when there are no `@variables` (fast path)", async () => {
    const out = await textNodeSchema.execute!(ctx("plain text") as never);
    expect(out).toEqual(txt("plain text"));
  });

  it("substitutes wired values from `var-N` inputs", async () => {
    const out = await textNodeSchema.execute!(
      ctx("@variable1 Morning", { "var-variable1": txt("good") }) as never,
    );
    expect(out).toEqual(txt("good Morning"));
  });

  it("leaves unwired `@names` literal in the output", async () => {
    const out = await textNodeSchema.execute!(
      ctx("@a then @b", { "var-a": txt("ALPHA") }) as never,
    );
    expect(out).toEqual(txt("ALPHA then @b"));
  });

  it("substitutes a repeated variable everywhere it appears", async () => {
    const out = await textNodeSchema.execute!(
      ctx("@x and @x", { "var-x": txt("ONE") }) as never,
    );
    expect(out).toEqual(txt("ONE and ONE"));
  });

  it("ignores type-mismatched upstreams (e.g. an image landed on a var- socket)", async () => {
    const out = await textNodeSchema.execute!(
      ctx("Hi @name", {
        "var-name": { type: "image", value: { url: "x" } },
      }) as never,
    );
    // Type-mismatched → undefined → unwired → literal `@name`.
    expect(out).toEqual(txt("Hi @name"));
  });

  it("preserves the body verbatim when the body is the empty string", async () => {
    const out = await textNodeSchema.execute!(ctx("") as never);
    expect(out).toEqual(txt(""));
  });
});
