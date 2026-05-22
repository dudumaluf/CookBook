"use client";

import { Image as ImageIcon, Layers } from "lucide-react";

import { defineNode } from "@/lib/engine/define-node";
import { extractInputArrayByType } from "@/lib/engine/extract-input";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
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

function ImageIteratorNodeBody({
  nodeId,
}: NodeBodyProps<ImageIteratorNodeConfig>) {
  // Subscribe to the edges array directly and derive the multi-edge count
  // here. We can't read it from upstream execution state (the iterator is
  // reactive, so it has no run record); the workflow store edges are the
  // source of truth for "how many things are wired in".
  //
  // Note: this picks up *any* edge into our `images` handle including ones
  // currently in-flight (being dragged). React Flow's connection logic
  // doesn't add to `edges` until the drop completes, so we don't have to
  // filter for "committed" edges manually.
  const connectedCount = useWorkflowStore(
    (s) =>
      s.edges.filter(
        (e) => e.target === nodeId && e.targetHandle === "images",
      ).length,
  );

  // Note (ADR-0031, Slice 5.4): we *don't* visually telegraph "this port
  // accepts multiple edges" with a larger ring here, because ADR-0023
  // explicitly mandates uniform port chrome across the canvas (only the
  // datatype color differs). Multi-edge is discoverable by trying — the
  // count below is the only place we surface it. The Slice 5.5 redesign
  // will move multi-image storage *inside* the node body anyway, at
  // which point the multi-edge pattern goes away entirely.
  return (
    <div className="flex w-full min-w-[220px] flex-col gap-1.5 px-3 pb-2.5 pt-0.5">
      <div className="flex items-center gap-2 rounded-md bg-foreground/[0.04] px-2 py-2 text-[11px] text-muted-foreground">
        <Layers className="h-3 w-3 shrink-0 text-accent" />
        <span data-testid="image-iterator-count" className="leading-snug">
          {connectedCount === 0 ? (
            <>
              <span className="text-foreground/80">No images connected.</span>{" "}
              Wire image nodes into the left port.
            </>
          ) : connectedCount === 1 ? (
            <>
              <span className="text-foreground/85">1 image connected.</span>{" "}
              Wire more for fan-out (parallel, up to 4 at a time).
            </>
          ) : (
            <>
              <span className="text-foreground/85">
                {connectedCount} images connected.
              </span>{" "}
              Downstream runs once per image, in parallel (up to 4 at a time).
            </>
          )}
        </span>
      </div>
      <p className="px-1 text-[10.5px] leading-snug text-muted-foreground/60">
        Planned: drop images directly into this node (Slice 5.5).
      </p>
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
