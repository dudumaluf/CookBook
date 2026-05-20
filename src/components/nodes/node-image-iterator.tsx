"use client";

import { Image as ImageIcon, Layers } from "lucide-react";

import { defineNode } from "@/lib/engine/define-node";
import { extractInputArrayByType } from "@/lib/engine/extract-input";
import type { NodeBodyProps, StandardizedOutput } from "@/types/node";

/**
 * Image Iterator — collects N upstream images into one array output that
 * fan-outs onto the next single-input node.
 *
 * Wire 8 Image nodes (or one Library multi-select drag, future polish)
 * into the `images` handle, plug the iterator's `out` into a downstream
 * single-input image handle (e.g. HiggsfieldImageGen.image), and the
 * engine runs the downstream once per item, in parallel up to
 * maxConcurrent (4 — Higgsfield's per-keypair cap). See ADR-0030.
 *
 * Reactive (output is a pure function of upstream content). `iterator: true`
 * is the magic flag that switches the runner from "first item only" to
 * "fan-out N times". Without it the runner would just hand the array to
 * the downstream as the input value, which on a single-handle would only
 * ever take the first item.
 *
 * No knobs in Slice 4 — the iterator is just a pass-through bundler. Future
 * slices can grow `take(n)`, `skip(n)`, `randomize`, etc. as config without
 * breaking the existing fan-out semantics.
 */
/**
 * Empty config — Slice 4 ships the iterator as a pure pass-through bundler.
 * Future slices add `take(n)`, `skip(n)`, `randomize`, etc. without
 * breaking the existing shape.
 */
export type ImageIteratorNodeConfig = Record<string, never>;

function ImageIteratorNodeBody({}: NodeBodyProps<ImageIteratorNodeConfig>) {
  // The body doesn't render the upstream images directly — the engine
  // doesn't expose live upstream state to a node body, only the
  // execution-store records do, and we don't want to subscribe to those
  // here (the iterator is reactive, no run record). Instead, surface a
  // small explanatory hint and lean on the connected handles to show
  // count via React Flow's natural rendering.
  return (
    <div className="flex w-full min-w-[220px] flex-col gap-1.5 px-3 pb-2.5 pt-0.5">
      <div className="flex items-center gap-2 rounded-md bg-foreground/[0.04] px-2 py-2 text-[11px] text-muted-foreground">
        <Layers className="h-3 w-3 text-accent" />
        <span>
          Wire N images here. Downstream runs once per image, in parallel
          (up to 4 at a time).
        </span>
      </div>
    </div>
  );
}

export const imageIteratorNodeSchema = defineNode<ImageIteratorNodeConfig>({
  kind: "image-iterator",
  category: "iterator",
  title: "Image Iterator",
  description:
    "Bundle N images into a fan-out source: each downstream execution runs once per image (parallel, bounded).",
  icon: ImageIcon,
  inputs: [
    { id: "images", label: "images", dataType: "image", multiple: true },
  ],
  outputs: [{ id: "out", label: "out", dataType: "image" }],
  defaultConfig: {},
  reactive: true,
  iterator: true,
  execute: async ({ inputs }) => {
    // Take every wired upstream image and emit them as an array. The
    // engine sees the iterator flag + array shape and switches to the
    // fan-out branch when this lands on a single-input handle downstream.
    const refs = extractInputArrayByType(inputs, "images", "image");
    const outputs: StandardizedOutput[] = refs.map((ref) => ({
      type: "image",
      value: ref,
    }));
    return outputs;
  },
  Body: ImageIteratorNodeBody,
  size: {
    defaultWidth: 240,
    minWidth: 220,
    maxWidth: 360,
    resizable: "horizontal",
  },
});
