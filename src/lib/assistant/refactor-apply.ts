import type {
  PendingRefactor,
  RefactorOperation,
} from "@/lib/assistant/refactor-types";
import { nodeRegistry } from "@/lib/engine/registry";
import { useAssistantStore } from "@/lib/stores/assistant-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";

/**
 * Refactor apply path — Phase 3.
 *
 * Atomic execution of a `PendingRefactor` against the workflow store.
 * Snapshot, apply each op via the existing store APIs, roll back if
 * anything throws or returns an explicit failure shape.
 *
 * The dispatcher runs OPS DIRECTLY against `useWorkflowStore` rather
 * than re-entering the LLM tool surface — same outcomes, no extra
 * round-trip, and we control the snapshot/rollback boundary tightly.
 *
 * Why not invoke the construct-tool `execute` functions?
 *   - Round-tripping through `getTool(...).execute(...)` adds Zod
 *     re-validation that the proposal has already passed.
 *   - Tool execute fns return `{ ok, ...}` shapes designed for an LLM
 *     reader; we want raw store-level signals here.
 *   - Direct calls keep the rollback easy: one snapshot taken before
 *     the loop, one `setState(snapshot)` if any op fails.
 *
 * Cross-op references:
 *   - An `add_node` op may carry a `clientId`; subsequent `add_edge`
 *     ops may use that clientId as `source` or `target`. The applier
 *     resolves it to the real node id minted by `addNode()`.
 */

export interface ApplyResult {
  ok: boolean;
  /** Number of ops successfully applied before stopping. */
  appliedCount: number;
  /** Error message when `ok === false`. */
  error?: string;
  /** Map of clientId → real node id, for new add_node ops. */
  newNodeIds: Record<string, string>;
}

export async function applyRefactor(
  refactor: PendingRefactor,
): Promise<ApplyResult> {
  const ws = useWorkflowStore;
  const snapshot = ws.getState();
  // We snapshot just nodes / edges / selection — every other piece of
  // state (canvas viewport, etc.) lives on different stores and isn't
  // mutated by the construct ops, so cloning the world here is wasted
  // work. JSON round-trip ensures rollback gets a true deep clone (no
  // mutation aliasing the in-memory state).
  const nodesBackup = JSON.parse(JSON.stringify(snapshot.nodes));
  const edgesBackup = JSON.parse(JSON.stringify(snapshot.edges));
  const selNodesBackup = [...snapshot.selectedNodeIds];
  const selEdgesBackup = [...snapshot.selectedEdgeIds];

  const newNodeIds: Record<string, string> = {};
  let appliedCount = 0;

  function rollback() {
    ws.setState({
      nodes: nodesBackup,
      edges: edgesBackup,
      selectedNodeIds: selNodesBackup,
      selectedEdgeIds: selEdgesBackup,
    });
  }

  try {
    for (const op of refactor.operations) {
      const opError = applyOne(op, newNodeIds);
      if (opError) {
        rollback();
        return {
          ok: false,
          appliedCount,
          error: `Op ${appliedCount + 1} (${op.op}) failed: ${opError}`,
          newNodeIds: {},
        };
      }
      appliedCount += 1;
    }
    return { ok: true, appliedCount, newNodeIds };
  } catch (err) {
    rollback();
    return {
      ok: false,
      appliedCount,
      error: err instanceof Error ? err.message : String(err),
      newNodeIds: {},
    };
  }
}

/**
 * Apply a single op. Returns an error string on failure, or null on
 * success. Throws nothing — keeps the caller's try/catch free for
 * unexpected runtime failures only.
 */
function applyOne(
  op: RefactorOperation,
  newNodeIds: Record<string, string>,
): string | null {
  const ws = useWorkflowStore.getState();
  switch (op.op) {
    case "add_node": {
      if (!nodeRegistry.get(op.kind)) {
        return `Unknown node kind '${op.kind}'.`;
      }
      const id = ws.addNode(op.kind, op.position, op.config);
      if (!id) return `Failed to add node of kind '${op.kind}'.`;
      if (op.clientId) newNodeIds[op.clientId] = id;
      return null;
    }
    case "remove_node": {
      const exists = ws.nodes.find((n) => n.id === op.nodeId);
      if (!exists) return `No node with id '${op.nodeId}' to remove.`;
      ws.removeNode(op.nodeId);
      return null;
    }
    case "update_node_config": {
      const exists = ws.nodes.find((n) => n.id === op.nodeId);
      if (!exists) return `No node with id '${op.nodeId}' to update.`;
      ws.updateNodeConfig(op.nodeId, op.config);
      return null;
    }
    case "move_node": {
      const exists = ws.nodes.find((n) => n.id === op.nodeId);
      if (!exists) return `No node with id '${op.nodeId}' to move.`;
      ws.moveNode(op.nodeId, op.position);
      return null;
    }
    case "add_edge": {
      // Resolve clientId references to real ids (for nodes added in the
      // same proposal). Falls back to the literal value when the ref
      // isn't a clientId — that's the "edge between existing canvas
      // nodes" case.
      const source = newNodeIds[op.source] ?? op.source;
      const target = newNodeIds[op.target] ?? op.target;
      if (!ws.nodes.find((n) => n.id === source)) {
        return `No source node '${source}'.`;
      }
      if (!ws.nodes.find((n) => n.id === target)) {
        return `No target node '${target}'.`;
      }
      const id = ws.addEdge({
        source,
        sourceHandle: op.sourceHandle,
        target,
        targetHandle: op.targetHandle,
      });
      if (!id) {
        return `Edge from ${source}.${op.sourceHandle} → ${target}.${op.targetHandle} rejected.`;
      }
      return null;
    }
    case "remove_edge": {
      const exists = ws.edges.find((e) => e.id === op.edgeId);
      if (!exists) return `No edge with id '${op.edgeId}' to remove.`;
      ws.removeEdge(op.edgeId);
      return null;
    }
    default: {
      // Exhaustiveness guard. If a new op variant is added to the
      // discriminated union and we forget to handle it here, this
      // assignment fails the typecheck.
      const _exhaustive: never = op;
      void _exhaustive;
      return `Unknown op shape.`;
    }
  }
}

/**
 * Top-level "apply the currently-pending refactor" helper used by the
 * RefactorPreviewModal's Apply button. Updates store status before
 * (`applying`) and after (`applied` / `failed`) so the UI reflects
 * progress without the modal needing to manage its own state machine.
 */
export async function applyPendingRefactor(): Promise<ApplyResult> {
  const store = useAssistantStore.getState();
  const pending = store.pendingRefactor;
  if (!pending) {
    return {
      ok: false,
      appliedCount: 0,
      error: "No pending refactor to apply.",
      newNodeIds: {},
    };
  }
  store.updatePendingRefactor({ status: "applying" });
  const result = await applyRefactor(pending);
  if (result.ok) {
    store.updatePendingRefactor({ status: "applied" });
  } else {
    store.updatePendingRefactor({
      status: "failed",
      error: result.error,
    });
  }
  return result;
}
