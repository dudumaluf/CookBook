"use client";

import { Type } from "lucide-react";

import { defineNode } from "@/lib/engine/define-node";
import type { NodeBodyProps } from "@/types/node";

export interface TextNodeConfig {
  text: string;
}

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
      placeholder="Type anything…"
      rows={4}
      aria-label="Text content"
      className="nowheel block min-h-0 w-full flex-1 resize-none rounded-b-xl border-0 bg-transparent px-3 pb-2.5 pt-1 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/60 focus:bg-foreground/5"
      // React Flow drags from any element; we don't want dragging while typing.
      onPointerDown={(e) => e.stopPropagation()}
      onWheelCapture={(e) => e.stopPropagation()}
    />
  );
}

export const textNodeSchema = defineNode<TextNodeConfig>({
  kind: "text",
  category: "input",
  title: "Text",
  description: "A snippet of text. Plug into any text input.",
  icon: Type,
  inputs: [],
  outputs: [{ id: "out", label: "out", dataType: "text" }],
  defaultConfig: { text: "" },
  reactive: true,
  execute: async ({ config }) => ({
    type: "text",
    value: config.text,
  }),
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
