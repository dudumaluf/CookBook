"use client";

import { Type } from "lucide-react";
import { useMemo } from "react";

import { defineNode } from "@/lib/engine/define-node";
import { extractInputByType } from "@/lib/engine/extract-input";
import { useExecutionStore } from "@/lib/stores/execution-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
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
 * The body has a **live preview** under the textarea (only when
 * variables exist) showing the rendered text with colored chips for
 * each `@variable`. The preview has a `content / names` toggle:
 *   • `content` (default) — chips show the wired upstream text;
 *     unwired/empty variables fall back to the variable name in a
 *     dashed-italic placeholder so missing wires are visible at a
 *     glance.
 *   • `names` — chips show the `@name` token itself (still colored)
 *     so you can read the template structure with the variable
 *     boundaries highlighted.
 *
 * Names follow `[a-zA-Z][a-zA-Z0-9_-]*` (so `@product-name`,
 * `@user_id_42`, `@variable1` all work; `@.` and `@123foo` don't). A
 * lookbehind keeps mid-word `@`s from accidentally matching, so emails
 * like `support@example.com` aren't clobbered into a substitution.
 */

export interface TextNodeConfig {
  text: string;
  /**
   * Preview render mode. `content` (default) shows wired upstream
   * values inline; `names` shows the `@name` tokens as chips. Same
   * color highlighting in both. Unwired variables ALWAYS fall back to
   * the variable name (so the user sees what's still missing) — the
   * mode only controls how WIRED variables render.
   */
  previewMode?: "content" | "names";
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
/* Live preview — variable values from upstream                           */
/* ────────────────────────────────────────────────────────────────────── */

/**
 * Resolve wired variable values from the workflow + execution stores.
 * Returns a map of variable name → upstream's text. Empty strings are
 * filtered (treated as "unwired") so the preview falls back to the
 * placeholder, matching the spec ("when text field filling the variable
 * is empty, show the standard name").
 *
 * The selectors return STABLE PRIMITIVES (a serialized signature for
 * incoming edges, the records map ref) so this hook only re-renders
 * when something actually changed. The map itself is rebuilt via
 * `useMemo` against those stable inputs.
 */
function useVariableValues(nodeId: string): Record<string, string> {
  // Stable signature of incoming `var-*` edges. The selector returns a
  // string, so referential equality is automatic — body re-renders only
  // when wires change.
  const incomingKey = useWorkflowStore((s) => {
    let result = "";
    for (const e of s.edges) {
      if (e.target === nodeId && e.targetHandle?.startsWith("var-")) {
        result += `${e.targetHandle}<-${e.source}|`;
      }
    }
    return result;
  });

  // Subscribe to the records map; reference changes whenever any node's
  // record updates, which is what we want for live preview when any
  // upstream output changes. Slight over-render across unrelated nodes
  // is acceptable here — the cost is parsing a small string + rebuilding
  // a tiny map. Optimise only if a profile shows it matters.
  const records = useExecutionStore((s) => s.records);

  return useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    if (!incomingKey) return map;
    for (const entry of incomingKey.split("|")) {
      if (!entry) continue;
      const [target, source] = entry.split("<-");
      if (!target || !source) continue;
      const name = target.slice(4); // strip "var-"
      const record = records.get(source);
      const out = record?.output;
      if (!out || Array.isArray(out)) continue;
      if (
        out.type === "text" &&
        typeof out.value === "string" &&
        out.value.length > 0
      ) {
        map[name] = out.value;
      }
    }
    return map;
  }, [incomingKey, records]);
}

/* ────────────────────────────────────────────────────────────────────── */
/* Preview render — colored variable chips                                */
/* ────────────────────────────────────────────────────────────────────── */

/**
 * Walk the template once, splitting into plain-text spans and
 * variable chips. We construct a new RegExp each call to reset the
 * `lastIndex` state of the global `/g` flag (otherwise consecutive
 * renders on the same template can skip matches).
 */
function renderPreviewParts(
  template: string,
  values: Record<string, string>,
  mode: "content" | "names",
): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  const regex = new RegExp(VAR_PATTERN.source, "g");
  let match: RegExpExecArray | null;
  while ((match = regex.exec(template)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    const name = match[1]!;

    if (start > lastIndex) {
      parts.push(
        <span key={`t-${key++}`}>{template.slice(lastIndex, start)}</span>,
      );
    }

    const wired = values[name];
    const hasValue = typeof wired === "string" && wired.length > 0;

    // Wired chip: solid blue text on a faint blue tint background.
    // Unwired chip: dashed-border ghost with the name as the label —
    // it's the same colour family so the user sees "this is a text
    // variable that's missing a wire", not "this is broken".
    const wiredStyle: React.CSSProperties = {
      color: "var(--datatype-text)",
      backgroundColor:
        "color-mix(in oklch, var(--datatype-text) 14%, transparent)",
    };
    const unwiredStyle: React.CSSProperties = {
      color:
        "color-mix(in oklch, var(--datatype-text) 70%, transparent)",
      borderColor:
        "color-mix(in oklch, var(--datatype-text) 38%, transparent)",
      backgroundColor:
        "color-mix(in oklch, var(--datatype-text) 6%, transparent)",
    };

    if (hasValue) {
      const label = mode === "names" ? `@${name}` : wired;
      parts.push(
        <span
          key={`v-${key++}`}
          className="rounded px-1 py-px font-medium"
          style={wiredStyle}
        >
          {label}
        </span>,
      );
    } else {
      parts.push(
        <span
          key={`v-${key++}`}
          className="rounded border border-dashed px-1 py-px italic"
          style={unwiredStyle}
        >
          {mode === "names" ? `@${name}` : name}
        </span>,
      );
    }
    lastIndex = end;
  }
  if (lastIndex < template.length) {
    parts.push(<span key={`t-${key++}`}>{template.slice(lastIndex)}</span>);
  }
  return parts;
}

/* ────────────────────────────────────────────────────────────────────── */
/* Body                                                                   */
/* ────────────────────────────────────────────────────────────────────── */

function TextNodeBody({
  nodeId,
  config,
  updateConfig,
}: NodeBodyProps<TextNodeConfig>) {
  const text = config.text ?? "";
  const variables = parseVariables(text);
  const hasVariables = variables.length > 0;
  const previewMode: "content" | "names" =
    config.previewMode === "names" ? "names" : "content";

  const values = useVariableValues(nodeId);

  return (
    // `flex-col` so textarea + preview stack inside the resizable card.
    // `min-h-0` lets the textarea actually shrink when the preview takes
    // space — without it the card overflows on small heights (ADR-0028).
    <div className="flex w-full min-h-0 flex-1 flex-col">
      {/* Editable textarea — always present so you can edit any time.
          When variables exist we tighten the bottom padding and drop
          the rounded-bottom-corner since the preview takes that role. */}
      <textarea
        value={text}
        onChange={(e) => updateConfig({ text: e.target.value })}
        placeholder="Type anything…  use @name for a variable socket"
        rows={hasVariables ? 3 : 4}
        aria-label="Text content"
        className={
          hasVariables
            ? "nowheel block min-h-[60px] w-full flex-1 resize-none border-0 bg-transparent px-3 pb-1.5 pt-1 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/60 focus:bg-foreground/5"
            : "nowheel block min-h-0 w-full flex-1 resize-none rounded-b-xl border-0 bg-transparent px-3 pb-2.5 pt-1 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/60 focus:bg-foreground/5"
        }
        // React Flow drags from any element; we don't want dragging while typing.
        onPointerDown={(e) => e.stopPropagation()}
        onWheelCapture={(e) => e.stopPropagation()}
      />

      {hasVariables && (
        // Preview region. `aria-live="polite"` so screen readers
        // announce changes without interrupting (mirrors how settings
        // toggle hints work elsewhere). `nowheel` keeps inner scroll
        // independent of canvas zoom.
        <div
          className="nowheel flex flex-col gap-1 rounded-b-xl border-t border-border/40 bg-foreground/[0.025] px-3 pb-2 pt-1.5"
          aria-live="polite"
          onWheelCapture={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between gap-2 text-[9.5px] uppercase tracking-[0.08em] text-muted-foreground/80">
            <span>preview</span>
            <div
              className="inline-flex overflow-hidden rounded-md border border-border/50 text-[10px]"
              role="tablist"
              aria-label="Preview mode"
            >
              <button
                type="button"
                role="tab"
                aria-selected={previewMode === "content"}
                onClick={() => updateConfig({ previewMode: "content" })}
                onPointerDown={(e) => e.stopPropagation()}
                className={
                  previewMode === "content"
                    ? "bg-foreground/10 px-2 py-0.5 text-foreground"
                    : "px-2 py-0.5 text-muted-foreground hover:text-foreground"
                }
              >
                content
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={previewMode === "names"}
                onClick={() => updateConfig({ previewMode: "names" })}
                onPointerDown={(e) => e.stopPropagation()}
                className={
                  previewMode === "names"
                    ? "bg-foreground/10 px-2 py-0.5 text-foreground"
                    : "px-2 py-0.5 text-muted-foreground hover:text-foreground"
                }
              >
                names
              </button>
            </div>
          </div>
          <p className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words text-[12px] leading-relaxed text-foreground/90">
            {renderPreviewParts(text, values, previewMode)}
          </p>
        </div>
      )}
    </div>
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
    "A snippet of text. Plug into any text input. Type `@name` in the body to add a labeled variable input socket — wire text into it and every `@name` in the body is substituted on output. Live preview below the textarea (toggle: content / names) shows what downstream nodes will see.",
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
  // across the canvas; `maxHeight: 480` (bumped from 420) gives the
  // preview a little more room when variables stack up. `resizable:
  // "both"` for the bottom-right drag handle so authors can pop the
  // box bigger when drafting a long prompt.
  size: {
    defaultWidth: 240,
    minWidth: 200,
    maxWidth: 520,
    minHeight: 100,
    maxHeight: 480,
    resizable: "both",
  },
});

// Exported for unit tests so the parsing / substitution can be exercised
// without spinning up the engine + store.
export const __testHooks = {
  parseVariables,
  renderTemplate,
  variableInputs,
  renderPreviewParts,
};
