"use client";

import { Type } from "lucide-react";

import { defineNode } from "@/lib/engine/define-node";
import { extractInputByType } from "@/lib/engine/extract-input";
import type { NodeBodyProps, NodeIO } from "@/types/node";

/**
 * Text — a snippet of text. Plug into any text input.
 *
 * Supports `@variable` references in the body. Type `@audience` anywhere
 * in the body and a labeled `audience` input socket auto-appears on the
 * node — wire any text upstream into it and every `@audience` in the
 * body is substituted with the wired text on output. Unwired references
 * stay literal (`@audience` survives in the output) so it's easy to
 * spot what's still missing.
 *
 * Names follow `[a-zA-Z][a-zA-Z0-9_-]*` (so `@product-name`, `@user_id_42`,
 * `@variable1` all work; `@.` and `@123foo` don't). A lookbehind keeps
 * mid-word `@`s from accidentally matching, so emails like
 * `support@example.com` aren't clobbered into a substitution.
 */

export interface TextNodeConfig {
  text: string;
}

/* ────────────────────────────────────────────────────────────────────── */
/* Template parsing + rendering                                           */
/* ────────────────────────────────────────────────────────────────────── */

/**
 * `(?<=^|\W)` — lookbehind requiring start-of-string OR a non-word char
 * before the `@`. `\W` = `[^A-Za-z0-9_]`, which includes whitespace,
 * punctuation, and `\n`, so `@name` at the start of a line, after a
 * space, or after punctuation all match — but `email@example.com`
 * (the `@` follows the `l` word-char) does NOT.
 *
 * The character class permits letters, digits, underscores and hyphens
 * after the leading letter. Greedy match, naturally stops at the first
 * non-class char (so `@name.suffix` captures only `name`).
 */
const VAR_PATTERN = /(?<=^|\W)@([a-zA-Z][a-zA-Z0-9_-]*)/g;

/** Returns unique variable names in first-appearance order. */
export function parseVariables(text: string): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const match of text.matchAll(VAR_PATTERN)) {
    const name = match[1];
    if (name && !seen.has(name)) {
      seen.add(name);
      ordered.push(name);
    }
  }
  return ordered;
}

function variableInputs(text: string): NodeIO[] {
  return parseVariables(text).map((name) => ({
    id: `var-${name}`,
    label: name,
    dataType: "text" as const,
  }));
}

/**
 * Substitute `@name` tokens with their wired values. Tokens whose name
 * has no value in `values` are left literal so the user can see at a
 * glance what's still unwired in the rendered output.
 */
export function renderTemplate(
  template: string,
  values: Record<string, string | undefined>,
): string {
  return template.replace(VAR_PATTERN, (full, name: string) => {
    const value = values[name];
    return value !== undefined ? value : full;
  });
}

/* ────────────────────────────────────────────────────────────────────── */
/* Body                                                                   */
/* ────────────────────────────────────────────────────────────────────── */

function TextNodeBody({
  config,
  updateConfig,
}: NodeBodyProps<TextNodeConfig>) {
  return (
    // Flush textarea (ADR-0021): no border, transparent so the card colour
    // shows through, just a touch of left/right padding so the caret isn't
    // glued to the edge. `flex-1 min-h-0` lets the textarea fill the card
    // when the user drag-resizes height (ADR-0028); rows={4} keeps a
    // sensible content-driven default for fresh nodes.
    //
    // `nowheel` + `onWheelCapture stop` keeps the textarea scrollable
    // without zooming the canvas when the cursor is inside it.
    <textarea
      value={config.text}
      onChange={(e) => updateConfig({ text: e.target.value })}
      placeholder="Type anything…  use @name for a variable socket"
      rows={4}
      aria-label="Text content"
      className="nowheel block min-h-0 w-full flex-1 resize-none rounded-b-xl border-0 bg-transparent px-3 pb-2.5 pt-1 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/60 focus:bg-foreground/5"
      // React Flow drags from any element; we don't want dragging while typing.
      onPointerDown={(e) => e.stopPropagation()}
      onWheelCapture={(e) => e.stopPropagation()}
    />
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/* Schema                                                                 */
/* ────────────────────────────────────────────────────────────────────── */

export const textNodeSchema = defineNode<TextNodeConfig>({
  kind: "text",
  category: "input",
  title: "Text",
  description:
    "A snippet of text. Plug into any text input. Type `@name` in the body to add a labeled variable input socket — wire text into it and every `@name` in the body is substituted on output.",
  icon: Type,
  // Static `inputs` is empty — fresh nodes have no `@names` yet so no
  // sockets. `getInputs(config)` is the live truth, parsing the body
  // every render to derive the labeled var-N sockets.
  inputs: [],
  getInputs: (config) => variableInputs(config.text ?? ""),
  outputs: [{ id: "out", label: "out", dataType: "text" }],
  defaultConfig: { text: "" },
  reactive: true,
  execute: async ({ config, inputs }) => {
    const text = config.text ?? "";
    const vars = parseVariables(text);
    if (vars.length === 0) {
      // Fast path — no template logic, no input lookups, no allocations.
      return { type: "text", value: text };
    }
    const values: Record<string, string | undefined> = {};
    for (const name of vars) {
      values[name] = extractInputByType(inputs, `var-${name}`, "text");
    }
    return {
      type: "text",
      value: renderTemplate(text, values),
    };
  },
  Body: TextNodeBody,
  // Size contract (ADR-0028). `defaultWidth: 240` matches the legacy
  // `min-w-[240px]` so existing canvases visually unchanged. `maxWidth:
  // 520` caps the silhouette so a long prompt can't stretch the node
  // across the canvas; `maxHeight: 420` similarly caps vertical growth
  // — both honour the user's "don't let content-population make the
  // node huge" requirement. `resizable: "both"` for the bottom-right
  // drag handle so authors can pop the box bigger when drafting a long
  // prompt.
  size: {
    defaultWidth: 240,
    minWidth: 200,
    maxWidth: 520,
    minHeight: 100,
    maxHeight: 420,
    resizable: "both",
  },
});

// Exported for unit tests so the parsing / substitution can be exercised
// without spinning up the engine + store.
export const __testHooks = { parseVariables, renderTemplate, variableInputs };
