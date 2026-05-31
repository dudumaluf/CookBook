import { z } from "zod";

/**
 * Refactor operation DSL — Phase 3 of "assistant analyzes selection".
 *
 * The assistant proposes a refactor as a SUMMARY string + a list of
 * RefactorOperation entries. The user reviews them in
 * `RefactorPreviewModal`; on apply, `refactor-apply.ts` dispatches each
 * op against the workflow store inside a snapshot/rollback wrapper.
 *
 * Each operation shape mirrors the args of an existing construct tool
 * (`add_node`, `add_edge`, …) so the LLM can reuse what it already
 * knows. The only difference: the assistant doesn't execute the ops
 * directly during analysis — it queues them through `propose_refactor`,
 * giving the user one atomic gate before any mutation lands.
 *
 * Discriminated union keyed by `op` so the LLM emits a clean shape and
 * Zod validates strictly per-variant.
 */

/** Position of a node on the canvas. */
const positionSchema = z
  .object({ x: z.number(), y: z.number() })
  .strict();

export const addNodeOperationSchema = z
  .object({
    op: z.literal("add_node"),
    /** Optional client id so subsequent ops in the same proposal can refer to this new node. */
    clientId: z.string().min(1).optional(),
    kind: z.string().min(1),
    position: positionSchema,
    config: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const removeNodeOperationSchema = z
  .object({
    op: z.literal("remove_node"),
    nodeId: z.string().min(1),
  })
  .strict();

export const updateNodeConfigOperationSchema = z
  .object({
    op: z.literal("update_node_config"),
    nodeId: z.string().min(1),
    config: z.record(z.string(), z.unknown()),
  })
  .strict();

export const moveNodeOperationSchema = z
  .object({
    op: z.literal("move_node"),
    nodeId: z.string().min(1),
    position: positionSchema,
  })
  .strict();

export const addEdgeOperationSchema = z
  .object({
    op: z.literal("add_edge"),
    /**
     * Source / target may reference an existing canvas node id OR a
     * `clientId` declared by an earlier `add_node` op in the same
     * proposal. The applier resolves the ref at apply-time.
     */
    source: z.string().min(1),
    sourceHandle: z.string().min(1),
    target: z.string().min(1),
    targetHandle: z.string().min(1),
  })
  .strict();

export const removeEdgeOperationSchema = z
  .object({
    op: z.literal("remove_edge"),
    edgeId: z.string().min(1),
  })
  .strict();

export const refactorOperationSchema = z.discriminatedUnion("op", [
  addNodeOperationSchema,
  removeNodeOperationSchema,
  updateNodeConfigOperationSchema,
  moveNodeOperationSchema,
  addEdgeOperationSchema,
  removeEdgeOperationSchema,
]);

export type RefactorOperation = z.infer<typeof refactorOperationSchema>;

export const refactorProposalSchema = z
  .object({
    summary: z.string().min(1),
    operations: z.array(refactorOperationSchema).min(1),
  })
  .strict();

export type RefactorProposal = z.infer<typeof refactorProposalSchema>;

/** Status lifecycle for a queued proposal in the assistant store. */
export type RefactorProposalStatus =
  | "pending"
  | "applying"
  | "applied"
  | "cancelled"
  | "rejected"
  | "failed";

export interface PendingRefactor {
  id: string;
  summary: string;
  operations: RefactorOperation[];
  status: RefactorProposalStatus;
  /** Set when status is `failed`. */
  error?: string;
  /** Wall-clock ms when the proposal was queued. Useful for ordering / debug. */
  proposedAt: number;
}
