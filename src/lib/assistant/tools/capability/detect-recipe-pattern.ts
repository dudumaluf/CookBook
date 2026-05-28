import { z } from "zod";

import { useWorkflowStore } from "@/lib/stores/workflow-store";

import type { AssistantTool } from "../index";

/**
 * detect_recipe_pattern — Slice 7.5 (ADR-0044).
 *
 * Inspect the live canvas for repeated subgraph "shapes" — sets of
 * nodes connected by the same kind sequence. When the user has wired
 * the same chain (e.g. `text → llm-text → array → list`) more than
 * `minOccurrences` times, we surface that pattern as a candidate to
 * collapse into a recipe.
 *
 * Why canvas-only (not gallery history)?
 *   The workflow store is the live source of truth — generations
 *   give us *what was produced*, not *how the graph was wired*. A
 *   user might build the same shape 3 times today (different prompts,
 *   different runs) and never run it; pattern detection catches that.
 *
 * Algorithm (deliberately simple):
 *   1. Build adjacency lists keyed by node kind sequences.
 *   2. For each connected component, hash the kind sequence.
 *   3. Count duplicates.
 *   4. Return clusters with count >= minOccurrences.
 *
 * Tool result:
 *   { patterns: [{ kindSequence, count, exampleNodeIds[] }] }
 *
 * The LLM uses this to suggest "save as recipe" via
 * `select_nodes` + `save_selection_as_recipe`.
 */

const argsSchema = z
  .object({
    minOccurrences: z.number().int().min(2).max(10).optional(),
  })
  .strict();

interface Pattern {
  kindSequence: string;
  count: number;
  exampleNodeIds: string[];
}

export const detectRecipePatternTool: AssistantTool = {
  name: "detect_recipe_pattern",
  description:
    "Scan the live canvas for repeated subgraph shapes (same node-kind sequences). Returns patterns appearing >= minOccurrences (default 2). Use to suggest 'save as recipe' when the user has clearly built the same chain multiple times.",
  parameters: {
    type: "object",
    properties: {
      minOccurrences: {
        type: "number",
        description: "Minimum duplicate count. Default 2.",
      },
    },
    additionalProperties: false,
  },
  execute: async (rawArgs) => {
    const args = argsSchema.parse(rawArgs ?? {});
    const minOccurrences = args.minOccurrences ?? 2;
    const ws = useWorkflowStore.getState();
    if (ws.nodes.length === 0) {
      return { ok: true, patterns: [] };
    }
    // Build adjacency: kind sequences via BFS from nodes with no
    // incoming edges (sources).
    const incoming = new Map<string, string[]>();
    const outgoing = new Map<string, string[]>();
    for (const e of ws.edges) {
      if (!outgoing.has(e.source)) outgoing.set(e.source, []);
      outgoing.get(e.source)!.push(e.target);
      if (!incoming.has(e.target)) incoming.set(e.target, []);
      incoming.get(e.target)!.push(e.source);
    }
    const sources = ws.nodes.filter(
      (n) => !incoming.has(n.id) || incoming.get(n.id)!.length === 0,
    );

    function kindOf(id: string): string {
      return ws.nodes.find((n) => n.id === id)?.kind ?? "?";
    }

    const seqMap = new Map<string, string[]>(); // sequence string → first nodeId

    function walk(startId: string): void {
      const stack: { id: string; chain: string[]; visited: Set<string> }[] = [
        { id: startId, chain: [], visited: new Set() },
      ];
      while (stack.length > 0) {
        const { id, chain, visited } = stack.pop()!;
        if (visited.has(id)) continue;
        visited.add(id);
        const newChain = [...chain, kindOf(id)];
        if (newChain.length >= 2) {
          const key = newChain.join(" → ");
          if (!seqMap.has(key)) seqMap.set(key, []);
          seqMap.get(key)!.push(startId);
        }
        const nexts = outgoing.get(id) ?? [];
        for (const next of nexts) {
          stack.push({ id: next, chain: newChain, visited });
        }
      }
    }

    for (const src of sources) walk(src.id);

    // Pattern detection runs by counting distinct subgraph instances
    // per kind sequence. Each `seqMap` entry already lists every
    // source node where the sequence emanates; those are the
    // distinct instances.
    const patterns: Pattern[] = [];
    for (const [seq, sources] of seqMap.entries()) {
      const uniq = Array.from(new Set(sources));
      if (uniq.length >= minOccurrences) {
        patterns.push({
          kindSequence: seq,
          count: uniq.length,
          exampleNodeIds: uniq.slice(0, 5),
        });
      }
    }
    // Sort longest sequences first — bigger candidates are more
    // valuable as recipes.
    patterns.sort((a, b) => {
      const lenDelta =
        b.kindSequence.split(" → ").length -
        a.kindSequence.split(" → ").length;
      if (lenDelta !== 0) return lenDelta;
      return b.count - a.count;
    });
    return { ok: true, patterns };
  },
};
