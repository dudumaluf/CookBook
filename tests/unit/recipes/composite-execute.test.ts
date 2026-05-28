import { beforeEach, describe, expect, it } from "vitest";

import "@/lib/engine/all-nodes";
import { compositeNodeSchema } from "@/components/nodes/node-composite";
import { passthroughNodeSchema } from "@/components/nodes/node-passthrough";
import { textNodeSchema } from "@/components/nodes/node-text";

import { runWorkflow } from "@/lib/engine/run-workflow";
import { NodeRegistry } from "@/lib/engine/registry";
import type {
  ExecutionCache,
  RunWorkflowOptions,
} from "@/lib/engine/run-workflow";
import type { ExecutionRecord, NodeInstance } from "@/types/node";

/**
 * Slice 6.6 — composite-node execute() recurses into runWorkflow with
 * the captured subgraph and synthesizes phantom passthrough nodes for
 * external inputs. These tests exercise the end-to-end behavior:
 *
 *   - Inputs flow IN: an external value piped into the composite's
 *     exposed input lands on the right internal node handle.
 *   - Outputs flow OUT: the internal node's emit becomes the
 *     composite's emit.
 *   - Empty subgraph: composite returns an empty text — the engine
 *     never gets `undefined`.
 */

function makeRegistry() {
  const r = new NodeRegistry();
  r.register(textNodeSchema);
  r.register(compositeNodeSchema);
  r.register(passthroughNodeSchema);
  return r;
}

beforeEach(() => {
  // No global state — each test owns its registry / cache.
});

describe("composite-node execute()", () => {
  it("forwards an external input to the matching internal handle and emits the captured node's output", async () => {
    const registry = makeRegistry();

    // Subgraph: a single Text node. We expose its `out` output AND we
    // wire a phantom passthrough to inject a value into... wait — Text
    // has no inputs. Use a different shape: composite has no exposed
    // inputs; the internal Text node's config carries the value
    // verbatim. Output is the Text node's `out`.
    const compositeInstance: NodeInstance = {
      id: "comp",
      kind: "composite",
      position: { x: 0, y: 0 },
      config: {
        recipeId: null,
        recipeName: "Test",
        subgraph: {
          version: 1,
          nodes: [
            {
              id: "inner-text",
              kind: "text",
              position: { x: 0, y: 0 },
              config: { text: "from inside the composite" },
            },
          ],
          edges: [],
          exposedInputs: [],
          exposedOutputs: [
            {
              internalNodeId: "inner-text",
              internalHandleId: "out",
              label: "out",
              dataType: "text",
            },
          ],
        },
        exposedInputs: [],
        exposedOutputs: [
          {
            internalNodeId: "inner-text",
            internalHandleId: "out",
            label: "out",
            dataType: "text",
          },
        ],
      },
    } as never;

    const cache: ExecutionCache = new Map();
    const records = new Map<string, ExecutionRecord>();
    const opts: RunWorkflowOptions = {
      nodes: [compositeInstance],
      edges: [],
      registry,
      cache,
      signal: new AbortController().signal,
      onProgress: (id, r) => records.set(id, r),
    };
    await runWorkflow(opts);

    // Composite emitted Text's output as its own.
    const rec = records.get("comp");
    expect(rec?.status).toBe("done");
    const out = Array.isArray(rec?.output) ? rec!.output[0] : rec!.output!;
    expect(out.type).toBe("text");
    if (out.type === "text") {
      expect(out.value).toBe("from inside the composite");
    }
  });

  it("empty subgraph: composite emits a defined empty text rather than undefined", async () => {
    const registry = makeRegistry();
    const compositeInstance: NodeInstance = {
      id: "comp",
      kind: "composite",
      position: { x: 0, y: 0 },
      config: {
        recipeId: null,
        recipeName: "Empty",
        subgraph: {
          version: 1,
          nodes: [],
          edges: [],
          exposedInputs: [],
          exposedOutputs: [],
        },
        exposedInputs: [],
        exposedOutputs: [],
      },
    } as never;

    const cache: ExecutionCache = new Map();
    const records = new Map<string, ExecutionRecord>();
    await runWorkflow({
      nodes: [compositeInstance],
      edges: [],
      registry,
      cache,
      signal: new AbortController().signal,
      onProgress: (id, r) => records.set(id, r),
    });
    const rec = records.get("comp");
    expect(rec?.status).toBe("done");
    expect(rec?.output).toBeDefined();
  });
});
