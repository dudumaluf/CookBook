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
    <textarea
      value={config.text}
      onChange={(e) => updateConfig({ text: e.target.value })}
      placeholder="Type anything…"
      rows={3}
      aria-label="Text content"
      className="w-full min-w-[200px] resize-none rounded-md border border-border/60 bg-background/60 px-2 py-1.5 text-xs leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/70 focus:border-accent/60"
      // React Flow drags from any element; we don't want dragging while typing.
      onPointerDown={(e) => e.stopPropagation()}
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
});
