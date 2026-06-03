import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "@/lib/engine/all-nodes";

/**
 * 2026-06-03 — Tier 1.4 execution hygiene tools.
 *
 * Three tools wrap `useExecutionStore` mutations:
 *   - clear_run (wipe records, keep cache)
 *   - clear_cache (wipe cache, keep records)
 *   - set_history_cursor (pick a different generation)
 *
 * The persist-cache machinery uses sessionStorage in production but
 * the test environment already mocks it for other suites; we just
 * verify the store-level effect is observable post-call.
 */

const { getTool } = await import("@/lib/assistant/tools");
const { useExecutionStore, _resetExecutionForTests } = await import(
  "@/lib/stores/execution-store"
);

beforeEach(() => {
  _resetExecutionForTests();
  useExecutionStore.setState({
    runId: 0,
    isRunning: false,
    records: new Map(),
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

/* ────────────────────────────────────────────────────────────────── */
/* clear_run                                                          */
/* ────────────────────────────────────────────────────────────────── */

describe("clear_run tool", () => {
  it("wipes all records and is idempotent", async () => {
    useExecutionStore.setState({
      records: new Map([
        [
          "n1",
          {
            status: "done",
            output: { type: "text" as const, value: "x" },
          },
        ],
      ]),
    });
    const tool = getTool("clear_run")!;
    const out = (await tool.execute({}, {})) as { ok: boolean };
    expect(out.ok).toBe(true);
    expect(useExecutionStore.getState().records.size).toBe(0);
    // Second call: still ok, still empty.
    const again = (await tool.execute({}, {})) as { ok: boolean };
    expect(again.ok).toBe(true);
    expect(useExecutionStore.getState().records.size).toBe(0);
  });

  it("rejects unknown args (typo-proof contract)", async () => {
    const tool = getTool("clear_run")!;
    await expect(
      tool.execute({ unexpected: 1 }, {}),
    ).rejects.toThrow();
  });
});

/* ────────────────────────────────────────────────────────────────── */
/* clear_cache                                                        */
/* ────────────────────────────────────────────────────────────────── */

describe("clear_cache tool", () => {
  it("returns ok and is idempotent", async () => {
    const tool = getTool("clear_cache")!;
    const out = (await tool.execute({}, {})) as { ok: boolean };
    expect(out.ok).toBe(true);
    const again = (await tool.execute({}, {})) as { ok: boolean };
    expect(again.ok).toBe(true);
  });

  it("does NOT touch the records map (orthogonal to clear_run)", async () => {
    useExecutionStore.setState({
      records: new Map([
        ["n1", { status: "done", output: { type: "text" as const, value: "x" } }],
      ]),
    });
    const tool = getTool("clear_cache")!;
    await tool.execute({}, {});
    // records survived.
    expect(useExecutionStore.getState().records.size).toBe(1);
  });
});

/* ────────────────────────────────────────────────────────────────── */
/* set_history_cursor                                                 */
/* ────────────────────────────────────────────────────────────────── */

describe("set_history_cursor tool", () => {
  it("rejects when the node has no execution record yet", async () => {
    const tool = getTool("set_history_cursor")!;
    const out = (await tool.execute(
      { nodeId: "ghost", cursorIndex: 0 },
      {},
    )) as { ok: boolean; error: string };
    expect(out.ok).toBe(false);
    expect(out.error).toContain("ghost");
  });

  it("rejects when the node has a record but no history yet", async () => {
    useExecutionStore.setState({
      records: new Map([
        [
          "n1",
          {
            status: "done",
            output: { type: "text" as const, value: "x" },
          },
        ],
      ]),
    });
    const tool = getTool("set_history_cursor")!;
    const out = (await tool.execute(
      { nodeId: "n1", cursorIndex: 0 },
      {},
    )) as { ok: boolean; error: string };
    expect(out.ok).toBe(false);
    expect(out.error).toContain("history");
  });

  it("clamps out-of-range indices and reports the resolved index", async () => {
    const history = [
      {
        output: { type: "text" as const, value: "v1" },
        runId: 1,
        timestamp: 1,
      },
      {
        output: { type: "text" as const, value: "v2" },
        runId: 2,
        timestamp: 2,
      },
      {
        output: { type: "text" as const, value: "v3" },
        runId: 3,
        timestamp: 3,
      },
    ];
    useExecutionStore.setState({
      records: new Map([
        [
          "n1",
          {
            status: "done",
            output: history[history.length - 1]!.output,
            history,
            cursorIndex: 2,
          },
        ],
      ]),
    });
    const tool = getTool("set_history_cursor")!;
    // Out-of-range high → clamps to last.
    const high = (await tool.execute(
      { nodeId: "n1", cursorIndex: 99 },
      {},
    )) as { ok: boolean; resolvedIndex: number };
    expect(high.ok).toBe(true);
    expect(high.resolvedIndex).toBe(2);
    // Out-of-range low → clamps to 0.
    const low = (await tool.execute(
      { nodeId: "n1", cursorIndex: -5 },
      {},
    )) as { ok: boolean; resolvedIndex: number };
    expect(low.ok).toBe(true);
    expect(low.resolvedIndex).toBe(0);
    // Mid → exact.
    const mid = (await tool.execute(
      { nodeId: "n1", cursorIndex: 1 },
      {},
    )) as { ok: boolean; resolvedIndex: number; historyLength: number };
    expect(mid.ok).toBe(true);
    expect(mid.resolvedIndex).toBe(1);
    expect(mid.historyLength).toBe(3);
    // Active output mirrors the entry the cursor lands on.
    const after = useExecutionStore.getState().records.get("n1")!;
    expect((after.output as { value: string }).value).toBe("v2");
  });

  it("rejects unknown args (typo-proof contract)", async () => {
    const tool = getTool("set_history_cursor")!;
    await expect(
      tool.execute(
        { nodeId: "n1", cursorIndex: 0, weird: 1 },
        {},
      ),
    ).rejects.toThrow();
  });

  it("rejects non-integer cursorIndex via Zod", async () => {
    const tool = getTool("set_history_cursor")!;
    await expect(
      tool.execute({ nodeId: "n1", cursorIndex: 1.5 }, {}),
    ).rejects.toThrow();
  });
});
