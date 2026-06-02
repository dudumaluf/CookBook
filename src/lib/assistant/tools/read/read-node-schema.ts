import { z } from "zod";

import { kindPitfalls } from "@/lib/engine/node-health";
import { nodeRegistry } from "@/lib/engine/registry";
import type { NodeIO } from "@/types/node";

import type { AssistantTool } from "../index";

/**
 * read_node_schema — Slice 2 of "Smarter assistant".
 *
 * Returns the full schema for ONE node kind: title, description,
 * category, reactivity / iterator flags, inputs, outputs, the shape
 * of `defaultConfig` (so the assistant knows what knobs the kind
 * exposes before reaching for `add_node`), and any recorded
 * `pitfalls` — known-bad patterns the assistant has been observed
 * producing for that kind (e.g. `array.separator` phantom field,
 * fal-image's `fal-ai/<id>` endpoint-id mistake). Pitfalls land in
 * the response BEFORE the LLM commits to a config patch so the
 * mistake gets prevented, not just caught later by
 * `check_workflow_health`.
 *
 * The lazy-catalog companion to `buildNodeCatalogKnowledge` — the
 * system prompt now ships one-line summaries; this tool fills in
 * the details on demand. Net token savings on a typical turn: the
 * assistant pulls one or two schemas at most, vs. paying ~3,500
 * tokens for the full catalog every turn whether it's needed or
 * not.
 */

const argsSchema = z
  .object({
    kind: z.string().min(1),
  })
  .strict();

function describeHandle(h: NodeIO): {
  id: string;
  dataType: NodeIO["dataType"];
  multiple?: boolean;
} {
  return {
    id: h.id,
    dataType: h.dataType,
    ...(h.multiple ? { multiple: true } : {}),
  };
}

export const readNodeSchemaTool: AssistantTool = {
  name: "read_node_schema",
  description:
    "Read the full schema for one node kind: title, description, category, reactivity, inputs, outputs, the shape of defaultConfig (so you know what knobs to set in `add_node`), and any recorded `pitfalls` (known-bad patterns this kind has been observed producing — e.g. phantom field names, endpoint-id mistakes). Use this when the one-line summary in the NODE CATALOG isn't enough, AND always before configuring a kind you haven't worked with before.",
  parameters: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        description:
          "The node kind from the NODE CATALOG, e.g. 'text', 'llm-text', 'fal-image'.",
      },
    },
    required: ["kind"],
    additionalProperties: false,
  },
  execute: async (rawArgs) => {
    const { kind } = argsSchema.parse(rawArgs);
    const schema = nodeRegistry.get(kind);
    if (!schema) {
      return { found: false, error: `No node kind: ${kind}` };
    }
    // `defaultConfig` may carry non-serializable bits (e.g. a class
    // instance for some legacy nodes); JSON-roundtripping strips
    // anything that wouldn't survive the wire and gives us a
    // deterministic shape for the assistant.
    let defaultConfig: unknown = null;
    try {
      defaultConfig = JSON.parse(JSON.stringify(schema.defaultConfig ?? {}));
    } catch {
      defaultConfig = null;
    }
    const pitfalls = kindPitfalls(schema.kind);
    return {
      found: true,
      kind: schema.kind,
      title: schema.title,
      description: schema.description,
      category: schema.category,
      reactive: schema.reactive === true,
      iterator: schema.iterator === true,
      inputs: schema.inputs.map(describeHandle),
      outputs: schema.outputs.map(describeHandle),
      defaultConfig,
      // Only include `pitfalls` when the kind has any. Keeps the typical
      // response one field smaller and signals to the LLM that absence
      // means "no recorded gotchas for this kind".
      ...(pitfalls.length > 0 ? { pitfalls } : {}),
    };
  },
};
