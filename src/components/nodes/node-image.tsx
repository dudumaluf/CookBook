"use client";

import { Image as ImageIcon } from "lucide-react";

import { defineNode } from "@/lib/engine/define-node";
import type { NodeBodyProps } from "@/types/node";

export interface ImageNodeConfig {
  url: string;
}

function ImageNodeBody({
  config,
  updateConfig,
}: NodeBodyProps<ImageNodeConfig>) {
  const hasImage = Boolean(config.url?.trim());

  return (
    <div className="flex w-full min-w-[200px] flex-col gap-1.5">
      {hasImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={config.url}
          alt="Image source"
          className="aspect-square w-full rounded-md border border-border/60 bg-background/40 object-cover"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
      ) : (
        <div className="flex aspect-square w-full items-center justify-center rounded-md border border-dashed border-border/60 bg-background/40 text-muted-foreground/50">
          <ImageIcon className="h-6 w-6" />
        </div>
      )}

      <input
        type="text"
        value={config.url}
        onChange={(e) => updateConfig({ url: e.target.value })}
        placeholder="https://… (drag asset in Slice 2)"
        aria-label="Image URL"
        className="w-full rounded-md border border-border/60 bg-background/60 px-2 py-1 text-xs text-foreground outline-none placeholder:text-muted-foreground/70 focus:border-accent/60"
        onPointerDown={(e) => e.stopPropagation()}
      />
    </div>
  );
}

export const imageNodeSchema = defineNode<ImageNodeConfig>({
  kind: "image",
  category: "input",
  title: "Image",
  description: "A single image referenced by URL. Library drag lands in Slice 2.",
  icon: ImageIcon,
  inputs: [],
  outputs: [{ id: "out", label: "out", dataType: "image" }],
  defaultConfig: { url: "" },
  reactive: true,
  execute: async ({ config }) => ({
    type: "image",
    value: { url: config.url },
  }),
  Body: ImageNodeBody,
});
