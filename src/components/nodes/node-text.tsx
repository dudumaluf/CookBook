"use client";

import { Type } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { defineNode } from "@/lib/engine/define-node";
import { extractInputByType } from "@/lib/engine/extract-input";
import { useExecutionStore } from "@/lib/stores/execution-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import type { NodeBodyProps, NodeIO } from "@/types/node";

/**
 * Text — a snippet of text. Plug into any text input.
 *
 * Supports `@variable` references in the body. Type `@audience` anywhere
 * and a labeled `audience` input socket auto-appears on the left edge of
 * the node — wire any text upstream into it and every `@audience` in
 * the body is substituted with the wired text on output. Unwired
 * references stay literal in the SUBSTITUTED OUTPUT (`@audience`
 * survives) so downstream nodes see exactly what's missing.
 *
 * The body is a **single contenteditable editor** (not a textarea +
 * preview split). Variables render inline as **non-editable colored
 * chips**; the plain text between chips is fully editable, so you can
 * write your prompt naturally with the variables visible in place. A
 * tiny `content / names` toggle in the corner swaps what the chips
 * display:
 *   • `content` (default) — chips show the wired upstream's text;
 *     unwired/empty variables fall back to the variable name in a
 *     dashed-italic placeholder.
 *   • `names` — chips show the `@name` token itself so you can read
 *     the template structure with the variable boundaries highlighted.
 *
 * Chips are **converted from plain text on a delimiter** (space / enter
 * / tab) or on blur, not on every keystroke — typing `@v`, `@va`, …,
 * `@vari` mid-word would flicker through different chips and feel
 * jittery. The variable SOCKET appears immediately though (parsed from
 * `config.text`), so you can wire while still typing.
 *
 * Names follow `[a-zA-Z][a-zA-Z0-9_-]*` (so `@product-name`,
 * `@user_id_42`, `@variable1` all work; `@.` and `@123foo` don't). A
 * lookbehind keeps mid-word `@`s from accidentally matching, so emails
 * like `support@example.com` aren't clobbered into a substitution.
 *
 * **Edge case:** `@a@b` with no separator only chips the first one —
 * the lookbehind that protects emails refuses to match a `@` after a
 * word char. Type a space (`@a @b`) and both chip up.
 */

export interface TextNodeConfig {
  text: string;
  /**
   * Chip render mode. `content` (default) shows wired upstream values;
   * `names` shows the `@name` tokens. Same colour family in both;
   * unwired variables ALWAYS fall back to the variable name in a
   * dashed-italic placeholder so missing wires are visible at a glance.
   */
  previewMode?: "content" | "names";
}

/* ────────────────────────────────────────────────────────────────────── */
/* Template parsing + rendering (same as before)                          */
/* ────────────────────────────────────────────────────────────────────── */

const VAR_PATTERN = /(?<=^|\W)@([a-zA-Z][a-zA-Z0-9_-]*)/g;

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
/* Live variable values from upstream                                     */
/* ────────────────────────────────────────────────────────────────────── */

function useVariableValues(nodeId: string): Record<string, string> {
  // Stable string signature of incoming `var-*` edges. The selector
  // returns a primitive so referential equality is automatic — body
  // re-renders only when wires change, not on every store mutation.
  const incomingKey = useWorkflowStore((s) => {
    let result = "";
    for (const e of s.edges) {
      if (e.target === nodeId && e.targetHandle?.startsWith("var-")) {
        result += `${e.targetHandle}<-${e.source}|`;
      }
    }
    return result;
  });

  // Subscribing to the records map ref re-renders this body whenever
  // any node's record changes — slight over-render but keeps the
  // resolver simple. `useMemo` against stable inputs (incomingKey +
  // records) keeps the values map reference stable across no-op
  // re-renders.
  const records = useExecutionStore((s) => s.records);

  return useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    if (!incomingKey) return map;
    for (const entry of incomingKey.split("|")) {
      if (!entry) continue;
      const [target, source] = entry.split("<-");
      if (!target || !source) continue;
      const name = target.slice(4);
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
/* Editor DOM helpers — chips, render, serialize, cursor                  */
/* ────────────────────────────────────────────────────────────────────── */

const CHIP_DATA_ATTR = "data-var-name";

function chipDisplayText(
  name: string,
  values: Record<string, string>,
  mode: "content" | "names",
): { label: string; isWired: boolean } {
  const value = values[name];
  const isWired = typeof value === "string" && value.length > 0;
  if (mode === "names") return { label: `@${name}`, isWired };
  return { label: isWired ? value! : name, isWired };
}

/**
 * Build a `<span>` chip element for a variable. The chip is
 * `contentEditable=false` so the browser treats it as an atomic unit:
 * caret skips over it, backspace deletes the whole chip, drag selects
 * it as a single token. We stash the variable NAME on a data-attribute
 * so serialization can recover the underlying `@name` regardless of
 * what the chip displays.
 */
function buildChipElement(
  name: string,
  values: Record<string, string>,
  mode: "content" | "names",
): HTMLSpanElement {
  const { label, isWired } = chipDisplayText(name, values, mode);
  const span = document.createElement("span");
  span.setAttribute(CHIP_DATA_ATTR, name);
  span.contentEditable = "false";
  span.textContent = label;
  // Tooltip with the FULL value (chip text may be truncated for long
  // values) so the user can still inspect what's wired in.
  span.title = isWired ? `@${name}: ${values[name]}` : `@${name} (unwired)`;

  // Inline styles keep the chip self-contained so the editor div
  // doesn't need any extra CSS injected. `var(--datatype-text)` aligns
  // chip colour with the text-data-type socket dot. `color-mix` gives
  // us tinted bg + dashed-border placeholders without bloating the
  // design tokens.
  Object.assign(span.style, {
    padding: "0 6px",
    borderRadius: "3px",
    fontWeight: "500",
    display: "inline-block",
    verticalAlign: "baseline",
    maxWidth: "200px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    userSelect: "all",
    cursor: "default",
    margin: "0 1px",
  } as Partial<CSSStyleDeclaration>);

  if (isWired) {
    span.style.color = "var(--datatype-text)";
    span.style.backgroundColor =
      "color-mix(in oklch, var(--datatype-text) 14%, transparent)";
  } else {
    span.style.color =
      "color-mix(in oklch, var(--datatype-text) 70%, transparent)";
    span.style.backgroundColor =
      "color-mix(in oklch, var(--datatype-text) 6%, transparent)";
    span.style.border = "1px dashed";
    span.style.borderColor =
      "color-mix(in oklch, var(--datatype-text) 38%, transparent)";
    span.style.fontStyle = "italic";
    span.style.padding = "0 5px";
  }

  return span;
}

/**
 * Render `text` into `editor`, replacing any existing children. `@name`
 * tokens become chips; the rest are plain text nodes. Newlines are
 * encoded as `<br>` so the browser line-breaks them (no whitespace
 * collapsing surprises with our `whitespace: pre-wrap` styling).
 */
function renderEditor(
  editor: HTMLElement,
  text: string,
  values: Record<string, string>,
  mode: "content" | "names",
): void {
  while (editor.firstChild) editor.removeChild(editor.firstChild);
  if (!text) return;

  // Helper to flush a chunk of plain text honouring newlines as <br>.
  const appendText = (chunk: string) => {
    if (!chunk) return;
    const segments = chunk.split("\n");
    segments.forEach((seg, i) => {
      if (seg) editor.appendChild(document.createTextNode(seg));
      if (i < segments.length - 1) {
        editor.appendChild(document.createElement("br"));
      }
    });
  };

  // Fresh regex per call — `/g` regexes carry `lastIndex` state across
  // calls, which would skip matches when the same pattern is reused.
  const regex = new RegExp(VAR_PATTERN.source, "g");
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    const name = match[1]!;
    if (start > lastIndex) appendText(text.slice(lastIndex, start));
    editor.appendChild(buildChipElement(name, values, mode));
    lastIndex = end;
  }
  if (lastIndex < text.length) appendText(text.slice(lastIndex));
}

/**
 * Walk the editor's direct children and recover the underlying
 * `@variable`-tokenized text. Chips serialize via the `data-var-name`
 * attr so we recover `@name` regardless of what the chip displays.
 * `<br>` becomes `\n`. `<div>` (Firefox/legacy paste) is treated as a
 * line wrapper.
 */
function serializeEditor(editor: HTMLElement): string {
  let result = "";
  for (const child of Array.from(editor.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      result += child.textContent ?? "";
    } else if (child instanceof HTMLElement) {
      const varName = child.getAttribute(CHIP_DATA_ATTR);
      if (varName) {
        result += `@${varName}`;
      } else if (child.tagName === "BR") {
        result += "\n";
      } else if (child.tagName === "DIV") {
        // Some browsers wrap on Enter — treat the wrapper as a leading
        // newline if it isn't the first child.
        if (result.length > 0 && !result.endsWith("\n")) result += "\n";
        result += child.textContent ?? "";
      } else {
        result += child.textContent ?? "";
      }
    }
  }
  return result;
}

/**
 * Convert a DOM caret position into a plain-text offset. Treats each
 * chip as `@name`.length characters — matching what the user "sees"
 * for the underlying token.
 */
function getCursorOffset(editor: HTMLElement): number | null {
  const sel = typeof window !== "undefined" ? window.getSelection() : null;
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!editor.contains(range.endContainer)) return null;

  let offset = 0;
  for (const child of Array.from(editor.childNodes)) {
    if (child === range.endContainer) {
      if (child.nodeType === Node.TEXT_NODE) offset += range.endOffset;
      return offset;
    }
    if (child.contains(range.endContainer)) {
      // Caret somehow lives inside a chip (shouldn't happen with
      // contenteditable=false but be defensive). Treat as end-of-chip.
      if (child instanceof HTMLElement) {
        const varName = child.getAttribute(CHIP_DATA_ATTR);
        if (varName) offset += varName.length + 1;
      }
      return offset;
    }
    if (child.nodeType === Node.TEXT_NODE) {
      offset += child.textContent?.length ?? 0;
    } else if (child instanceof HTMLElement) {
      const varName = child.getAttribute(CHIP_DATA_ATTR);
      if (varName) offset += varName.length + 1;
      else if (child.tagName === "BR") offset += 1;
    }
  }
  return offset;
}

function setCursorOffset(editor: HTMLElement, offset: number): void {
  const sel = typeof window !== "undefined" ? window.getSelection() : null;
  if (!sel) return;

  let remaining = offset;
  for (const child of Array.from(editor.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const len = child.textContent?.length ?? 0;
      if (remaining <= len) {
        const range = document.createRange();
        range.setStart(child, remaining);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        return;
      }
      remaining -= len;
    } else if (child instanceof HTMLElement) {
      const varName = child.getAttribute(CHIP_DATA_ATTR);
      if (varName) {
        const len = varName.length + 1;
        if (remaining <= len) {
          const range = document.createRange();
          range.setStartAfter(child);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
          return;
        }
        remaining -= len;
      } else if (child.tagName === "BR") {
        if (remaining === 0) {
          const range = document.createRange();
          range.setStartBefore(child);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
          return;
        }
        remaining -= 1;
      }
    }
  }
  // Clamp past-the-end → caret at end.
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

function reconcileEditor(
  editor: HTMLElement,
  values: Record<string, string>,
  mode: "content" | "names",
): void {
  const text = serializeEditor(editor);
  const wasFocused =
    typeof document !== "undefined" && document.activeElement === editor;
  const offset = wasFocused ? getCursorOffset(editor) : null;
  renderEditor(editor, text, values, mode);
  if (offset !== null) setCursorOffset(editor, offset);
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
  const previewMode: "content" | "names" =
    config.previewMode === "names" ? "names" : "content";
  const variables = parseVariables(text);
  const hasVariables = variables.length > 0;

  const values = useVariableValues(nodeId);

  const editorRef = useRef<HTMLDivElement>(null);
  // Tracks the last text WE serialized — lets us skip re-rendering on
  // our own changes and avoid a re-render-loop while the user types.
  const lastSerializedRef = useRef<string>("");
  const [isEmpty, setIsEmpty] = useState(text.length === 0);

  // Stable signature of values so the effect only runs when the actual
  // variable values for THIS node change (not when any unrelated node's
  // record updates).
  const valuesKey = useMemo(() => {
    const keys = Object.keys(values).sort();
    return keys.map((k) => `${k}=${values[k]}`).join("\u0000");
  }, [values]);

  // Sync the editor DOM with the desired text/values/mode. Skips when
  // the editor already matches `text` (our own input) AND values/mode
  // haven't changed — the re-render is driven by valuesKey/previewMode
  // entering the dep array.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const wasFocused =
      typeof document !== "undefined" && document.activeElement === editor;
    const offset = wasFocused ? getCursorOffset(editor) : null;
    renderEditor(editor, text, values, previewMode);
    if (offset !== null) {
      setCursorOffset(
        editor,
        // If text shrank externally (e.g. external set), clamp to len.
        Math.min(offset, text.length),
      );
    }
    lastSerializedRef.current = text;
    setIsEmpty(text.length === 0);
    // We intentionally re-render when ANY of these change — even if
    // text matches, valuesKey or previewMode flipping should refresh
    // chip labels. Callers' typing path bypasses this via
    // lastSerializedRef short-circuit in handleInput.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, valuesKey, previewMode]);

  function handleInput() {
    const editor = editorRef.current;
    if (!editor) return;
    const serialized = serializeEditor(editor);
    setIsEmpty(serialized.length === 0);
    if (serialized !== lastSerializedRef.current) {
      lastSerializedRef.current = serialized;
      updateConfig({ text: serialized });
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    // Force `<br>` for Enter so the serialized text gets a clean `\n`
    // (browsers default to `<div>` wrappers in some flows, which makes
    // round-tripping more annoying).
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      range.deleteContents();
      const br = document.createElement("br");
      range.insertNode(br);
      // Place caret AFTER the <br>. We add a zero-width text node so
      // the caret lands on the new line in browsers that otherwise
      // glue it to the BR.
      const zwsp = document.createTextNode("\u200B");
      br.after(zwsp);
      const r = document.createRange();
      r.setStartAfter(zwsp);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
      handleInput();
    }
  }

  function handleKeyUp(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== " " && e.key !== "Enter" && e.key !== "Tab") return;
    const editor = editorRef.current;
    if (!editor) return;
    reconcileEditor(editor, values, previewMode);
  }

  function handleBlur() {
    const editor = editorRef.current;
    if (!editor) return;
    reconcileEditor(editor, values, previewMode);
  }

  function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    // Paste plain text only — we don't want pasted HTML / chip
    // duplicates / arbitrary inline styles.
    e.preventDefault();
    const pasted = e.clipboardData.getData("text/plain");
    if (!pasted) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const node = document.createTextNode(pasted);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    handleInput();
    // Reconcile post-paste so any pasted `@names` get chipped up.
    const editor = editorRef.current;
    if (editor) reconcileEditor(editor, values, previewMode);
  }

  return (
    <div className="relative flex w-full min-h-0 flex-1 flex-col">
      {hasVariables && (
        <div
          className="absolute right-2 top-1.5 z-10 inline-flex overflow-hidden rounded-md border border-border/50 bg-background/85 text-[10px] backdrop-blur-sm"
          role="tablist"
          aria-label="Variable display mode"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            role="tab"
            aria-selected={previewMode === "content"}
            onClick={() => updateConfig({ previewMode: "content" })}
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
            className={
              previewMode === "names"
                ? "bg-foreground/10 px-2 py-0.5 text-foreground"
                : "px-2 py-0.5 text-muted-foreground hover:text-foreground"
            }
          >
            names
          </button>
        </div>
      )}

      {isEmpty && (
        <span
          aria-hidden
          className="pointer-events-none absolute left-3 top-1 select-none text-sm leading-relaxed text-muted-foreground/60"
        >
          Type anything…  use @name for a variable socket
        </span>
      )}

      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        spellCheck
        role="textbox"
        aria-multiline="true"
        aria-label="Text content"
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onBlur={handleBlur}
        onPaste={handlePaste}
        // React Flow drags from any element; opt out so typing /
        // selection works inside the editor without panning the canvas.
        onPointerDown={(e) => e.stopPropagation()}
        onWheelCapture={(e) => e.stopPropagation()}
        className="nowheel block min-h-[60px] w-full flex-1 resize-none whitespace-pre-wrap break-words rounded-b-xl border-0 bg-transparent px-3 pb-2.5 pt-1 text-sm leading-relaxed text-foreground outline-none focus:bg-foreground/5"
      />
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
    "A snippet of text. Plug into any text input. Type `@name` in the body to add a labeled variable input socket — wire text into it and every `@name` is substituted on output. Inline editor renders variables as colored chips with a `content / names` toggle.",
  icon: Type,
  inputs: [],
  getInputs: (config) => variableInputs(config.text ?? ""),
  outputs: [{ id: "out", label: "out", dataType: "text" }],
  defaultConfig: { text: "" },
  reactive: true,
  execute: async ({ config, inputs }) => {
    const text = config.text ?? "";
    const vars = parseVariables(text);
    if (vars.length === 0) {
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
  size: {
    defaultWidth: 240,
    minWidth: 200,
    maxWidth: 520,
    minHeight: 100,
    maxHeight: 480,
    resizable: "both",
  },
});

// Exported for unit + component tests so the parsing / substitution /
// editor DOM helpers can be exercised without spinning up the full
// engine + store.
export const __testHooks = {
  parseVariables,
  renderTemplate,
  variableInputs,
  buildChipElement,
  renderEditor,
  serializeEditor,
  reconcileEditor,
};
