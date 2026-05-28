"use client";

import { ArrowRight } from "lucide-react";

import { defineNode } from "@/lib/engine/define-node";
import type { StandardizedOutput } from "@/types/node";

/**
 * Internal helper node — Slice 6.6.
 *
 * `passthrough` is a "constant" node that emits its `config.value`
 * (a `StandardizedOutput`) directly when executed. It's never shown in
 * the AddNode catalog and never lives on the user-visible canvas;
 * instead, the composite-node `execute()` injects ephemeral
 * passthrough nodes at the top of its sub-workflow so the engine sees
 * external composite inputs as if they were upstream-emitted values.
 *
 * This sidesteps having to teach the engine a "preset inputs" feature
 * — we just synthesize phantom upstream nodes that carry the right
 * payload, and the existing edge-resolution logic does the rest.
 */

export interface PassthroughNodeConfig {
  value: StandardizedOutput;
}

function PassthroughBody(): null {
  // Internal-only — never rendered on the canvas in M0a. The body is
  // here purely so the schema satisfies `NodeSchema.Body`.
  return null;
}

export const passthroughNodeSchema = defineNode<PassthroughNodeConfig>({
  kind: "passthrough",
  category: "input",
  title: "Passthrough",
  description:
    "Internal helper used by composite nodes to inject external inputs into a sub-workflow. Never visible in the catalog.",
  icon: ArrowRight,
  inputs: [],
  outputs: [{ id: "out", label: "out", dataType: "any" }],
  defaultConfig: {
    value: { type: "text", value: "" } as StandardizedOutput,
  },
  reactive: true,
  execute: async ({ config }) => config.value,
  Body: PassthroughBody as never,
});
