import { z } from "zod";

import { nodeRegistry } from "@/lib/engine/registry";
import type { NodeIO } from "@/types/node";

import type { AssistantTool } from "../index";

/**
 * read_node_schema — Slice 2 of "Smarter assistant".
 *
 * Returns the full schema for ONE node kind: title, description,
 * category, reactivity / iterator flags, inputs, outputs, and the
 * shape of `defaultConfig` (so the assistant knows what knobs the
 * kind exposes before reaching for `add_node`).
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
    "Read the full schema for one node kind: title, description, category, reactivity, inputs, outputs, and the shape of defaultConfig (so you know what knobs to set in `add_node`). Use this when the one-line summary in the NODE CATALOG isn't enough — e.g. before configuring a node you haven't worked with before.",
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
    };
  },
};
