import { z } from "zod";

import { nodeRegistry } from "@/lib/engine/registry";

import type { AssistantTool } from "../index";

/**
 * propose_node_schema — Slice 7.5 (ADR-0044).
 *
 * Used when the user asks for something the registry doesn't yet
 * support (e.g. "use the new Flux model", "give me a 4-image grid
 * compose node", "I want a CSV export node"). Instead of saying
 * "I can't" or improvising, the assistant proposes a node schema
 * that a developer can review and land as code.
 *
 * The tool DOES NOT modify the registry. It returns a structured
 * proposal (kind, title, category, inputs, outputs, defaultConfig
 * shape, summary) that the chat surfaces back to the user. The
 * user can copy it to give to the dev, or use it as the spec for
 * a manual implementation later.
 *
 * Validation:
 *   - `kind` must be unique vs existing registry kinds (no clobber).
 *   - inputs/outputs follow the same NodeIO shape as live nodes.
 *   - Returns a `proposalId` (timestamp + kind hash) so the user
 *     can refer back to it across turns.
 */

const handleSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  dataType: z.string().min(1),
  multiple: z.boolean().optional(),
});

const argsSchema = z
  .object({
    kind: z
      .string()
      .min(1)
      .regex(/^[a-z0-9-]+$/, {
        message: "Kind must be lowercase kebab-case (a-z, 0-9, hyphens).",
      }),
    title: z.string().min(1),
    category: z.string().min(1),
    description: z.string().min(1),
    inputs: z.array(handleSchema),
    outputs: z.array(handleSchema).min(1),
    defaultConfig: z.record(z.string(), z.unknown()).optional(),
    rationale: z.string().min(1),
  })
  .strict();

function makeProposalId(kind: string): string {
  // Compact id the user / dev can refer to: "kind-2026-05-28T14:01"
  const ts = new Date().toISOString().slice(0, 16);
  return `proposal:${kind}-${ts}`;
}

export const proposeNodeSchemaTool: AssistantTool = {
  name: "propose_node_schema",
  description:
    "Draft a NodeSchema proposal for the user to review. Use when the user asks for a capability the registry doesn't yet have. Returns the structured proposal — does NOT modify the registry. Reject with ok:false if the kind already exists.",
  parameters: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        description:
          "Lowercase kebab-case identifier. Must be unique vs existing registry kinds.",
      },
      title: {
        type: "string",
        description: "Human-readable name shown in node chrome (e.g. 'Flux Image').",
      },
      category: {
        type: "string",
        description:
          "Bucket for the catalog UI (input / transform / iterator / ai-text / ai-image / ai-vision / ai-video / compose / output).",
      },
      description: {
        type: "string",
        description: "1-2 sentence elevator pitch for the new node.",
      },
      inputs: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            label: { type: "string" },
            dataType: { type: "string" },
            multiple: { type: "boolean" },
          },
          required: ["id", "label", "dataType"],
          additionalProperties: false,
        },
      },
      outputs: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            label: { type: "string" },
            dataType: { type: "string" },
            multiple: { type: "boolean" },
          },
          required: ["id", "label", "dataType"],
          additionalProperties: false,
        },
      },
      defaultConfig: {
        type: "object",
        description:
          "Shape + sample values for the node's persistent config (e.g. { model: 'flux-dev', strength: 0.8 }).",
      },
      rationale: {
        type: "string",
        description:
          "Why this is needed — quote the user's intent if relevant. Helps the dev triage proposals.",
      },
    },
    required: [
      "kind",
      "title",
      "category",
      "description",
      "inputs",
      "outputs",
      "rationale",
    ],
    additionalProperties: false,
  },
  execute: async (rawArgs) => {
    const args = argsSchema.parse(rawArgs);
    if (nodeRegistry.get(args.kind)) {
      return {
        ok: false,
        error: `Kind '${args.kind}' already exists in the registry. Pick a different kind, or use update_node_config + existing nodes if the capability is already covered.`,
      };
    }
    const proposal = {
      proposalId: makeProposalId(args.kind),
      kind: args.kind,
      title: args.title,
      category: args.category,
      description: args.description,
      inputs: args.inputs,
      outputs: args.outputs,
      defaultConfig: args.defaultConfig ?? {},
      rationale: args.rationale,
      proposedAt: new Date().toISOString(),
    };
    return { ok: true, proposal };
  },
};
