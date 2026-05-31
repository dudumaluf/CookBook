/**
 * Canvas spawn-position registry — module-level singleton.
 *
 * The Add Node popover (`AddNodeButton`) and the clipboard's paste handler
 * both want to drop new nodes at the current viewport center, expressed in
 * React-Flow *flow* coordinates. The clean way to compute that uses
 * `useReactFlow().screenToFlowPosition`, but that hook only works inside a
 * `<ReactFlowProvider>` — and the Add Node popover lives in the shell, one
 * tree above the provider.
 *
 * Rather than hoist the provider, we expose a tiny registry: `CanvasFlowInner`
 * registers a getter on mount; consumers call `getSpawnPosition()` at the
 * moment of action. No subscription, no React context — just a function
 * pointer the canvas owns.
 *
 * Fallback: when no canvas is mounted (e.g. SSR, tests, the welcome screen
 * before `ReactFlow` has rendered), `getSpawnPosition()` returns
 * `{ x: 200, y: 160 }` so a fresh load still places the first node in a
 * sensible spot.
 */

export interface SpawnPosition {
  x: number;
  y: number;
}

type SpawnPositionGetter = () => SpawnPosition;

const FALLBACK: SpawnPosition = { x: 200, y: 160 };

let registeredGetter: SpawnPositionGetter | null = null;

/**
 * Register the canvas-aware getter. Called by `CanvasFlowInner` on mount;
 * pass `null` on unmount so a stale React Flow instance can't be queried
 * after the canvas is gone.
 */
export function setSpawnPositionGetter(
  getter: SpawnPositionGetter | null,
): void {
  registeredGetter = getter;
}

/**
 * Read the current viewport-center spawn position in flow coordinates.
 *
 * Wraps the registered getter in a try/catch so a single React Flow hiccup
 * (mid-unmount, ResizeObserver mid-flush, etc.) never bubbles up into the
 * Add Node menu / clipboard paste path. We'd rather drop a node at the
 * fallback than throw.
 */
export function getSpawnPosition(): SpawnPosition {
  if (!registeredGetter) return FALLBACK;
  try {
    const pos = registeredGetter();
    if (
      !pos ||
      !Number.isFinite(pos.x) ||
      !Number.isFinite(pos.y)
    ) {
      return FALLBACK;
    }
    return pos;
  } catch {
    return FALLBACK;
  }
}

/**
 * Test-only helper: clear the registered getter so unit tests starting from
 * a known state aren't poisoned by a previous test's registration.
 */
export function __resetSpawnPositionGetterForTests(): void {
  registeredGetter = null;
}
