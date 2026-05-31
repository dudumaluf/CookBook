/**
 * Canvas clipboard — copy / paste / duplicate node selections.
 *
 * Stores a snapshot of the selected nodes + edges (whose endpoints are both
 * inside the selection) in a module-level buffer, then re-instantiates them
 * on paste with fresh ids and a translated position so the paste lands at
 * the current viewport center.
 *
 * The buffer is per-tab in-memory only. We *also* fire-and-forget a write
 * to the system clipboard so the user can copy a node here and paste it
 * into another tab — but the in-memory buffer is the canonical source on
 * paste (we don't currently read the system clipboard back; doing so is an
 * async permission-gated API and the keyboard handler is synchronous).
 *
 * The keyboard plumbing is exported as `tryHandleClipboardKey` so unit
 * tests can dispatch it without mounting React. Editable targets
 * (input / textarea / contentEditable) are excluded so plain text
 * copy / paste inside the prompt bar / node textareas keeps working.
 */

import type { NodeInstance, WorkflowEdge } from "@/types/node";
import {
  getSpawnPosition,
  type SpawnPosition,
} from "@/lib/canvas/spawn-position";

/* ────────────────────────── Payload + buffer state ────────────────────────── */

interface SerializedNode {
  id: string;
  kind: string;
  position: { x: number; y: number };
  config: unknown;
  label?: string;
  size?: { width?: number; height?: number };
}

interface SerializedEdge {
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
}

export interface ClipboardPayload {
  version: 1;
  nodes: SerializedNode[];
  edges: SerializedEdge[];
}

let buffer: ClipboardPayload | null = null;

/** Read the current in-memory clipboard payload (or `null` if empty). */
export function getClipboardBuffer(): ClipboardPayload | null {
  return buffer;
}

/** Test-only: reset the in-memory buffer. */
export function __resetClipboardForTests(): void {
  buffer = null;
}

/* ──────────────────────────── State contract ──────────────────────────── */

/**
 * The slice of `workflow-store` the clipboard layer needs. Decoupled from
 * the store directly so tests can inject a fake without spinning up Zustand.
 */
export interface ClipboardState {
  nodes: readonly NodeInstance[];
  edges: readonly WorkflowEdge[];
  selectedNodeIds: readonly string[];
  addNode: (
    kind: string,
    position: { x: number; y: number },
    initialConfig?: Record<string, unknown>,
  ) => string;
  addEdge: (edge: Omit<WorkflowEdge, "id">) => string | undefined;
  renameNode: (id: string, label: string | undefined) => void;
  resizeNode: (
    id: string,
    size: { width?: number; height?: number } | undefined,
  ) => void;
  setSelectedNodeIds: (ids: string[]) => void;
}

/* ─────────────────────────────── Copy ─────────────────────────────── */

/**
 * Snapshot the current selection into the in-memory buffer (and best-effort
 * write to the system clipboard). Returns the payload for tests; returns
 * `null` when nothing is selected.
 */
export function copySelectedNodes(
  state: ClipboardState,
): ClipboardPayload | null {
  if (state.selectedNodeIds.length === 0) return null;

  const selected = new Set(state.selectedNodeIds);
  const pickedNodes = state.nodes
    .filter((n) => selected.has(n.id))
    .map<SerializedNode>((n) => ({
      id: n.id,
      kind: n.kind,
      position: { x: n.position.x, y: n.position.y },
      // JSON deep-clone so later edits on the source node don't leak
      // into the buffered payload (configs are already JSON-shaped).
      config: JSON.parse(JSON.stringify(n.config ?? null)),
      ...(n.label !== undefined ? { label: n.label } : {}),
      ...(n.size ? { size: { ...n.size } } : {}),
    }));

  // Only include edges fully internal to the selection — paste-into-graph
  // wouldn't have endpoints to re-anchor a half-dangling edge to.
  const pickedEdges = state.edges
    .filter((e) => selected.has(e.source) && selected.has(e.target))
    .map<SerializedEdge>((e) => ({
      source: e.source,
      sourceHandle: e.sourceHandle,
      target: e.target,
      targetHandle: e.targetHandle,
    }));

  const payload: ClipboardPayload = {
    version: 1,
    nodes: pickedNodes,
    edges: pickedEdges,
  };
  buffer = payload;

  // Best-effort system-clipboard mirror so cross-tab paste *could* work in
  // the future. Failures (no permission, http origin, missing API) are
  // silent — the in-memory buffer is what paste actually reads today.
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      void navigator.clipboard.writeText(serializeForClipboard(payload));
    } catch {
      // ignore
    }
  }

  return payload;
}

const CLIPBOARD_TAG = "cookbook-clipboard:v1:";

function serializeForClipboard(payload: ClipboardPayload): string {
  return CLIPBOARD_TAG + JSON.stringify(payload);
}

/* ─────────────────────────────── Paste ─────────────────────────────── */

export interface PasteOptions {
  /**
   * Override the paste anchor. When omitted, falls back to the current
   * canvas viewport center (`getSpawnPosition`).
   */
  center?: SpawnPosition;
  /**
   * Override the source payload (mostly for tests; the default reads from
   * the in-memory buffer).
   */
  payload?: ClipboardPayload;
  /**
   * Pre-computed position translation. Used by `duplicateSelectedNodes` to
   * place the copy at a fixed +30/+30 offset from the original instead of
   * dragging it to the viewport center.
   */
  pasteOffset?: { dx: number; dy: number };
}

export interface PasteResult {
  newNodeIds: string[];
  newEdgeIds: string[];
}

/**
 * Re-instantiate the buffered payload onto the graph with fresh ids.
 * - Each node gets a new id (via `addNode`); old → new id mapping is then
 *   used to re-anchor any internal edges in the payload.
 * - Position is translated so the bounding-box centre lands at the paste
 *   anchor (viewport center by default).
 * - Selection is replaced with the freshly-pasted node ids so a follow-up
 *   Backspace removes the copy, not the original.
 */
export function pasteFromClipboard(
  state: ClipboardState,
  options: PasteOptions = {},
): PasteResult {
  const payload = options.payload ?? buffer;
  if (!payload || payload.nodes.length === 0) {
    return { newNodeIds: [], newEdgeIds: [] };
  }

  // Compute the {dx,dy} translation that places the payload's centroid at
  // the paste anchor. `pasteOffset` short-circuits the centroid math (used
  // for "duplicate in place + 30px").
  let dx = 0;
  let dy = 0;
  if (options.pasteOffset) {
    dx = options.pasteOffset.dx;
    dy = options.pasteOffset.dy;
  } else {
    const xs = payload.nodes.map((n) => n.position.x);
    const ys = payload.nodes.map((n) => n.position.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const center = options.center ?? getSpawnPosition();
    dx = center.x - cx;
    dy = center.y - cy;
  }

  const idMap = new Map<string, string>();
  const newNodeIds: string[] = [];

  for (const n of payload.nodes) {
    const newId = state.addNode(
      n.kind,
      { x: n.position.x + dx, y: n.position.y + dy },
      n.config as Record<string, unknown>,
    );
    if (!newId) continue;
    idMap.set(n.id, newId);
    newNodeIds.push(newId);
    if (n.label !== undefined) state.renameNode(newId, n.label);
    if (n.size) state.resizeNode(newId, n.size);
  }

  const newEdgeIds: string[] = [];
  for (const e of payload.edges) {
    const ns = idMap.get(e.source);
    const nt = idMap.get(e.target);
    if (!ns || !nt) continue;
    const id = state.addEdge({
      source: ns,
      sourceHandle: e.sourceHandle,
      target: nt,
      targetHandle: e.targetHandle,
    });
    if (id) newEdgeIds.push(id);
  }

  if (newNodeIds.length > 0) {
    state.setSelectedNodeIds(newNodeIds);
  }

  return { newNodeIds, newEdgeIds };
}

/* ─────────────────────────── Duplicate ─────────────────────────── */

/**
 * Copy + paste in one step. Skips the system-clipboard / centroid math —
 * the duplicate lands at a fixed +30/+30 offset from the original so the
 * user immediately sees both copies side by side.
 */
export function duplicateSelectedNodes(state: ClipboardState): PasteResult {
  const payload = copySelectedNodes(state);
  if (!payload) return { newNodeIds: [], newEdgeIds: [] };
  return pasteFromClipboard(state, {
    payload,
    pasteOffset: { dx: 30, dy: 30 },
  });
}

/* ─────────────────────── Keyboard dispatch ─────────────────────── */

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable === true
  );
}

/**
 * Returns `true` iff the event was a clipboard shortcut we acted on (so the
 * caller knows we already called `preventDefault`). Pure / DOM-event-only
 * — no React, no store imports — to mirror `tryHandleDeleteKey` and stay
 * trivial to unit-test.
 *
 * Recognised shortcuts (Cmd on macOS, Ctrl elsewhere):
 *   ⌘C  copy current selection
 *   ⌘V  paste from buffer at viewport center
 *   ⌘D  duplicate selection in place (+30/+30 offset)
 *
 * Editable targets (input / textarea / select / contentEditable) are
 * excluded so plain-text copy / paste inside the prompt bar and node
 * textareas keeps working.
 */
export function tryHandleClipboardKey(
  event: KeyboardEvent,
  getState: () => ClipboardState,
): boolean {
  if (isEditableTarget(event.target)) return false;
  const cmd = event.metaKey || event.ctrlKey;
  if (!cmd) return false;
  // Skip when other modifiers are held (avoid swallowing ⌘⇧C in DevTools,
  // ⌘⌥V "paste-and-match-style", etc.). We only own the bare ⌘C / ⌘V / ⌘D.
  if (event.shiftKey || event.altKey) return false;

  const key = event.key.toLowerCase();

  if (key === "c") {
    const state = getState();
    if (state.selectedNodeIds.length === 0) return false;
    copySelectedNodes(state);
    event.preventDefault();
    return true;
  }
  if (key === "v") {
    if (!buffer) return false;
    pasteFromClipboard(getState());
    event.preventDefault();
    return true;
  }
  if (key === "d") {
    const state = getState();
    if (state.selectedNodeIds.length === 0) return false;
    duplicateSelectedNodes(state);
    event.preventDefault();
    return true;
  }
  return false;
}
