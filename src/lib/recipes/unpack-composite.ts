import type { CompositeNodeConfig } from "@/components/nodes/node-composite";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import type { NodeInstance, WorkflowEdge } from "@/types/node";

/**
 * Unpack-composite — Slice 6.6.
 *
 * Replaces a composite node on canvas with the expanded subgraph it
 * was holding. Inverse-ish of `saveSelectionAsRecipe`:
 *
 *   1. Read the composite's `config.subgraph` (its captured nodes +
 *      internal edges).
 *   2. Generate fresh ids for every internal node (so they don't
 *      collide with anything else on canvas) and remap edges to use
 *      the new ids.
 *   3. Translate the inner positions so the unpacked subgraph lands
 *      around the composite's current position (top-left anchor).
 *   4. Rewire the composite's external edges (the ones from / to the
 *      composite's exposed handles) onto the matching internal node
 *      handles. Edges whose handle id no longer maps to an exposed
 *      entry get dropped — recipe schema mismatch.
 *   5. Atomic store update: remove the composite + its external
 *      edges, add the unpacked nodes + the remapped internal edges +
 *      the rewired external edges.
 *
 * The recipe row in `cookbook_recipes` is left untouched — unpacking
 * is a canvas-only operation; the saved recipe still exists in the
 * library and can be re-instantiated wherever.
 */

function makeId(): string {
  return `node_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36)}`;
}

export function unpackComposite(compositeNodeId: string): void {
  const ws = useWorkflowStore.getState();
  const composite = ws.nodes.find((n) => n.id === compositeNodeId);
  if (!composite || composite.kind !== "composite") return;
  const config = composite.config as CompositeNodeConfig;
  const { subgraph, exposedInputs, exposedOutputs } = config;

  // Re-id every internal node so it can coexist with anything on canvas.
  const idMap = new Map<string, string>();
  for (const n of subgraph.nodes) {
    idMap.set(n.id, makeId());
  }

  // Anchor the unpacked top-left at the composite's position. Same
  // translate-by-min trick instantiate-on-canvas already uses.
  const minX =
    subgraph.nodes.length > 0
      ? Math.min(...subgraph.nodes.map((n) => n.position.x))
      : 0;
  const minY =
    subgraph.nodes.length > 0
      ? Math.min(...subgraph.nodes.map((n) => n.position.y))
      : 0;
  const dx = composite.position.x - minX;
  const dy = composite.position.y - minY;

  const unpackedNodes: NodeInstance[] = subgraph.nodes.map((n) => ({
    ...n,
    id: idMap.get(n.id)!,
    position: { x: n.position.x + dx, y: n.position.y + dy },
  }));

  const internalEdges: WorkflowEdge[] = (subgraph.edges ?? [])
    .filter((e) => idMap.has(e.source) && idMap.has(e.target))
    .map((e) => ({
      ...e,
      id: makeId(),
      source: idMap.get(e.source)!,
      target: idMap.get(e.target)!,
    }));

  // Rewire the composite's external edges.
  const exposedInByLabel = new Map<string, (typeof exposedInputs)[number]>();
  for (const h of exposedInputs) exposedInByLabel.set(h.label, h);
  const exposedOutByLabel = new Map<string, (typeof exposedOutputs)[number]>();
  for (const h of exposedOutputs) exposedOutByLabel.set(h.label, h);

  const rewiredIncoming: WorkflowEdge[] = ws.edges
    .filter((e) => e.target === compositeNodeId)
    .map((e) => {
      const exposed = exposedInByLabel.get(e.targetHandle);
      if (!exposed) return null;
      const remappedTarget = idMap.get(exposed.internalNodeId);
      if (!remappedTarget) return null;
      return {
        ...e,
        id: makeId(),
        target: remappedTarget,
        targetHandle: exposed.internalHandleId,
      };
    })
    .filter((e): e is WorkflowEdge => e !== null);

  const rewiredOutgoing: WorkflowEdge[] = ws.edges
    .filter((e) => e.source === compositeNodeId)
    .map((e) => {
      const exposed = exposedOutByLabel.get(e.sourceHandle);
      if (!exposed) return null;
      const remappedSource = idMap.get(exposed.internalNodeId);
      if (!remappedSource) return null;
      return {
        ...e,
        id: makeId(),
        source: remappedSource,
        sourceHandle: exposed.internalHandleId,
      };
    })
    .filter((e): e is WorkflowEdge => e !== null);

  useWorkflowStore.setState((state) => ({
    nodes: [
      ...state.nodes.filter((n) => n.id !== compositeNodeId),
      ...unpackedNodes,
    ],
    edges: [
      ...state.edges.filter(
        (e) => e.source !== compositeNodeId && e.target !== compositeNodeId,
      ),
      ...internalEdges,
      ...rewiredIncoming,
      ...rewiredOutgoing,
    ],
    selectedNodeIds: unpackedNodes.map((n) => n.id),
    selectedEdgeIds: [],
  }));
}
