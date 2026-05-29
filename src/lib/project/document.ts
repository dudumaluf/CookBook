/**
 * ProjectDocument — the canonical, self-contained serialization of a
 * project (ADR — project as a document).
 *
 * One (de)serializer used by BOTH destinations:
 *   - the cloud: stored as `cookbook_projects.state` (JSONB) by
 *     `project-sync`;
 *   - a file: exported / imported as `.cookbook` by `project/file` (later
 *     slice).
 *
 * Crucially the document carries `executionState` — each node's last
 * output + history — so reloading (or opening a file) restores not just
 * the graph but the *results* the user already generated. The Gallery
 * corpus (`cookbook_generations`) stays separate: it's the curated,
 * searchable archive, not the canvas truth.
 *
 * Forward-portable: `version` lets older payloads migrate forward, same
 * playbook as the workflow-store's local migrations.
 */

import { PROJECT_STATE_VERSION } from "@/lib/repositories/project-repository";
import { useAssetStore } from "@/lib/stores/asset-store";
import {
  HISTORY_CAP,
  useExecutionStore,
} from "@/lib/stores/execution-store";
import { useLayoutStore } from "@/lib/stores/layout-store";
import { useProjectStore } from "@/lib/stores/project-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import type {
  ExecutionHistoryEntry,
  ExecutionRecord,
  NodeUsage,
  StandardizedOutput,
} from "@/types/node";

/** One node's persisted execution result (only URLs/text — never bytes). */
export interface SerializedNodeExecution {
  output: StandardizedOutput | StandardizedOutput[];
  usage?: NodeUsage;
  elapsedMs?: number;
  history?: ExecutionHistoryEntry[];
}

/** Per-node execution results, keyed by node id. */
export type SerializedExecutionState = Record<string, SerializedNodeExecution>;

export interface ProjectDocumentLayout {
  libraryOpen: boolean;
  queueOpen: boolean;
  chatSheetOpen: boolean;
  approvalGateOn: boolean;
}

export interface ProjectDocument {
  /** Matches `PROJECT_STATE_VERSION`; bumped when the shape changes. */
  version: number;
  /** Provenance stamp (handy when opening a file from another build). */
  app?: { name: string; version: string };
  projectName: string;
  workflow: { nodes: unknown[]; edges: unknown[] };
  assets: unknown[];
  layout: ProjectDocumentLayout;
  /** Per-node last output + history. Absent on legacy (v1) payloads. */
  executionState?: SerializedExecutionState;
  /** ISO timestamp of when this snapshot was taken. */
  savedAt?: string;
}

const APP_NAME = "Cookbook";
const APP_VERSION = "M1";

/** A fresh, empty project document — used when creating a new project. */
export function emptyProjectDocument(
  name: string = "Untitled Project",
): ProjectDocument {
  return {
    version: PROJECT_STATE_VERSION,
    app: { name: APP_NAME, version: APP_VERSION },
    projectName: name,
    workflow: { nodes: [], edges: [] },
    assets: [],
    layout: {
      libraryOpen: true,
      queueOpen: false,
      chatSheetOpen: false,
      approvalGateOn: false,
    },
    executionState: {},
    savedAt: new Date().toISOString(),
  };
}

/* ──────────────────── execution-state (de)serialize ──────────────────── */

/**
 * Snapshot the execution-store records that carry a result. We keep only
 * `done` / `cached` records with an `output`; transient fields (status,
 * hash, fanOut, error) are dropped. History is capped defensively.
 */
export function serializeExecutionState(): SerializedExecutionState {
  const out: SerializedExecutionState = {};
  for (const [nodeId, rec] of useExecutionStore.getState().records) {
    if (rec.output === undefined) continue;
    if (rec.status !== "done" && rec.status !== "cached") continue;
    const entry: SerializedNodeExecution = { output: rec.output };
    if (rec.usage) entry.usage = rec.usage;
    if (rec.elapsedMs !== undefined) entry.elapsedMs = rec.elapsedMs;
    if (rec.history && rec.history.length > 0) {
      entry.history = rec.history.slice(-HISTORY_CAP);
    }
    out[nodeId] = entry;
  }
  return out;
}

/**
 * Rebuild execution-store records from a persisted execution state.
 *
 * Restored records are marked `"cached"` (not `"done"`): they're a replay
 * of a previously-computed result, not a fresh generation. This is what
 * makes `generation-sync` skip them automatically (it only persists
 * `done`), so reloading never re-inserts duplicate Gallery rows — no
 * separate dedup bookkeeping needed.
 */
export function executionStateToRecords(
  state: SerializedExecutionState | undefined,
): Map<string, ExecutionRecord> {
  const records = new Map<string, ExecutionRecord>();
  if (!state) return records;
  for (const [nodeId, entry] of Object.entries(state)) {
    if (!entry || entry.output === undefined) continue;
    const rec: ExecutionRecord = { status: "cached", output: entry.output };
    if (entry.usage) rec.usage = entry.usage;
    if (entry.elapsedMs !== undefined) rec.elapsedMs = entry.elapsedMs;
    if (entry.history && entry.history.length > 0) {
      rec.history = entry.history.slice(-HISTORY_CAP);
    }
    records.set(nodeId, rec);
  }
  return records;
}

/* ──────────────────── document (de)serialize ──────────────────── */

/** Snapshot every store into a self-contained document. */
export function serializeProject(): ProjectDocument {
  const workflow = useWorkflowStore.getState();
  const assets = useAssetStore.getState();
  const layout = useLayoutStore.getState();
  const project = useProjectStore.getState();
  return {
    version: PROJECT_STATE_VERSION,
    app: { name: APP_NAME, version: APP_VERSION },
    projectName: project.name,
    workflow: { nodes: workflow.nodes, edges: workflow.edges },
    assets: assets.assets,
    layout: {
      libraryOpen: layout.libraryOpen,
      queueOpen: layout.queueOpen,
      chatSheetOpen: layout.chatSheetOpen,
      approvalGateOn: layout.approvalGateOn,
    },
    executionState: serializeExecutionState(),
    savedAt: new Date().toISOString(),
  };
}

/**
 * Apply a document to the live stores. Order matters: assets first
 * (workflow's v9 migration reaches into the asset-store), then workflow,
 * layout, project name, and finally the execution records (rehydrated as
 * `cached` so the canvas shows past results without re-running anything).
 */
export function applyProjectDocument(
  raw: ProjectDocument | Record<string, unknown> | undefined,
): void {
  if (!raw) return;
  const doc = migrateProjectDocument(raw);
  if (doc.assets) {
    useAssetStore.setState({ assets: doc.assets as never });
  }
  if (doc.workflow) {
    useWorkflowStore.setState({
      nodes: doc.workflow.nodes as never,
      edges: doc.workflow.edges as never,
    });
  }
  if (doc.layout) {
    useLayoutStore.setState({
      libraryOpen: doc.layout.libraryOpen,
      queueOpen: doc.layout.queueOpen,
      chatSheetOpen: doc.layout.chatSheetOpen,
      approvalGateOn: doc.layout.approvalGateOn,
    });
  }
  if (doc.projectName) {
    useProjectStore.setState({ name: doc.projectName });
  }
  // Rehydrate the per-node results LAST so node bodies + history cursors
  // light up with what the user previously generated.
  useExecutionStore.setState({
    records: executionStateToRecords(doc.executionState),
  });
}

/**
 * Forward-port an older / partial payload to the current document shape.
 * Tolerant by design: a hand-edited or legacy blob never crashes the load
 * — missing fields fall back to safe defaults. Node-level migration
 * (workflow v1-v9) is handled by the workflow store / a shared migrator;
 * here we only normalise the document envelope.
 */
export function migrateProjectDocument(
  raw: ProjectDocument | Record<string, unknown>,
): ProjectDocument {
  const r = (raw ?? {}) as Partial<ProjectDocument>;
  const layout = (r.layout ?? {}) as Partial<ProjectDocumentLayout>;
  return {
    version: typeof r.version === "number" ? r.version : PROJECT_STATE_VERSION,
    ...(r.app ? { app: r.app } : {}),
    projectName:
      typeof r.projectName === "string" && r.projectName.length > 0
        ? r.projectName
        : "Untitled Project",
    workflow: {
      nodes: Array.isArray(r.workflow?.nodes) ? r.workflow!.nodes : [],
      edges: Array.isArray(r.workflow?.edges) ? r.workflow!.edges : [],
    },
    assets: Array.isArray(r.assets) ? r.assets : [],
    layout: {
      libraryOpen: layout.libraryOpen ?? true,
      queueOpen: layout.queueOpen ?? false,
      chatSheetOpen: layout.chatSheetOpen ?? false,
      approvalGateOn: layout.approvalGateOn ?? false,
    },
    ...(r.executionState ? { executionState: r.executionState } : {}),
    ...(r.savedAt ? { savedAt: r.savedAt } : {}),
  };
}
