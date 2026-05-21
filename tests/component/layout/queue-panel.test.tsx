import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import {
  QueuePanel,
  buildRows,
  computeSummary,
  formatCost,
  formatElapsed,
} from "@/components/layout/queue-panel";
import { TooltipProvider } from "@/components/ui/tooltip";
import "@/lib/engine/all-nodes";
import {
  _resetExecutionForTests,
  useExecutionStore,
} from "@/lib/stores/execution-store";
import { useLayoutStore } from "@/lib/stores/layout-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import type { ExecutionRecord, NodeInstance } from "@/types/node";

function withTooltip(node: React.ReactNode) {
  return <TooltipProvider>{node}</TooltipProvider>;
}

function seedRecords(records: Record<string, ExecutionRecord>) {
  useExecutionStore.setState({ records: new Map(Object.entries(records)) });
}

function seedNodes(nodes: NodeInstance[]) {
  useWorkflowStore.setState({ nodes, edges: [] });
}

function openQueue() {
  useLayoutStore.setState({ queueOpen: true });
}

beforeEach(() => {
  _resetExecutionForTests();
  seedNodes([]);
  openQueue();
});

afterEach(() => {
  _resetExecutionForTests();
  seedNodes([]);
});

/* ────────────────────────────────────────────────────────────────────────── */
/* Pure helpers                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

describe("formatCost", () => {
  it("returns $0 for exact zero (free runs / reactive nodes)", () => {
    expect(formatCost(0)).toBe("$0");
  });
  it("returns <$0.0001 for sub-precision costs (don't lie with $0.0000)", () => {
    expect(formatCost(0.00001)).toBe("<$0.0001");
  });
  it("uses 4 decimals for sub-cent costs (typical single LLM call)", () => {
    expect(formatCost(0.0012)).toBe("$0.0012");
  });
  it("uses 3 decimals for sub-dollar costs", () => {
    expect(formatCost(0.123)).toBe("$0.123");
  });
  it("uses 2 decimals at the dollar level", () => {
    expect(formatCost(2.5)).toBe("$2.50");
  });
});

describe("formatElapsed", () => {
  it("returns ms below 1 second", () => {
    expect(formatElapsed(850)).toBe("850 ms");
  });
  it("returns seconds with one decimal below 10 s", () => {
    expect(formatElapsed(1860)).toBe("1.9 s");
  });
  it("returns whole seconds above 10 s", () => {
    expect(formatElapsed(12_400)).toBe("12 s");
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* computeSummary                                                             */
/* ────────────────────────────────────────────────────────────────────────── */

describe("computeSummary", () => {
  it("returns the idle label when no records", () => {
    const s = computeSummary(new Map());
    expect(s.isActive).toBe(false);
    expect(s.label).toBe("idle");
    expect(s.totalCostUsd).toBe(0);
  });

  it("flags isActive when at least one node is running or pending", () => {
    const s = computeSummary(
      new Map([
        ["n1", { status: "running" } as ExecutionRecord],
        ["n2", { status: "done" } as ExecutionRecord],
      ]),
    );
    expect(s.isActive).toBe(true);
  });

  it("does NOT flag isActive when only done / cached nodes are present", () => {
    const s = computeSummary(
      new Map([
        ["n1", { status: "done" } as ExecutionRecord],
        ["n2", { status: "cached" } as ExecutionRecord],
      ]),
    );
    expect(s.isActive).toBe(false);
  });

  it("sums costUsd across records (ignores missing usage)", () => {
    const s = computeSummary(
      new Map<string, ExecutionRecord>([
        [
          "n1",
          { status: "done", usage: { costUsd: 0.001 } },
        ],
        [
          "n2",
          { status: "done", usage: { costUsd: 0.0042 } },
        ],
        ["n3", { status: "done" }], // no usage — reactive node
      ]),
    );
    expect(s.totalCostUsd).toBeCloseTo(0.0052, 6);
  });

  it("renders up to two leading non-zero status counts in the label", () => {
    const s = computeSummary(
      new Map<string, ExecutionRecord>([
        ["a", { status: "running" }],
        ["b", { status: "done" }],
        ["c", { status: "done" }],
        ["d", { status: "cached" }],
        ["e", { status: "error" }],
      ]),
    );
    expect(s.label).toBe("1 running · 2 done");
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* buildRows                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

function n(id: string, kind: string, label?: string): NodeInstance {
  return { id, kind, position: { x: 0, y: 0 }, config: {}, label };
}

describe("buildRows", () => {
  it("preserves record insertion order (matches the engine's topo order)", () => {
    const records = new Map<string, ExecutionRecord>([
      ["a", { status: "done" }],
      ["b", { status: "done" }],
      ["c", { status: "done" }],
    ]);
    const rows = buildRows(records, [
      n("c", "text"),
      n("b", "text"),
      n("a", "text"),
    ]);
    expect(rows.map((r) => r.nodeId)).toEqual(["a", "b", "c"]);
  });

  it("uses the per-instance label when present, schema title otherwise", () => {
    const records = new Map<string, ExecutionRecord>([
      ["a", { status: "done" }],
      ["b", { status: "done" }],
    ]);
    const rows = buildRows(records, [
      n("a", "text", "Subject prompt"),
      n("b", "text"),
    ]);
    expect(rows[0]!.label).toBe("Subject prompt");
    expect(rows[1]!.label).toBe("Text"); // schema title fallback
  });

  it("falls back to '(deleted)' when the node was removed mid-run", () => {
    const records = new Map<string, ExecutionRecord>([
      ["a", { status: "done" }],
    ]);
    const rows = buildRows(records, []); // no nodes
    expect(rows[0]!.label).toBe("(deleted)");
    expect(rows[0]!.IconComponent).toBeNull();
  });

  it("extracts a text preview from done/cached text outputs", () => {
    const records = new Map<string, ExecutionRecord>([
      [
        "a",
        {
          status: "done",
          output: { type: "text", value: "hello world" },
        },
      ],
      [
        "b",
        {
          status: "cached",
          output: { type: "text", value: "from cache" },
        },
      ],
      ["c", { status: "running" }],
    ]);
    const rows = buildRows(records, [
      n("a", "text"),
      n("b", "text"),
      n("c", "text"),
    ]);
    expect(rows[0]!.preview).toBe("hello world");
    expect(rows[1]!.preview).toBe("from cache");
    expect(rows[2]!.preview).toBeNull();
  });

  it("truncates text previews longer than 120 chars with an ellipsis", () => {
    const longText = "x".repeat(200);
    const records = new Map<string, ExecutionRecord>([
      [
        "a",
        { status: "done", output: { type: "text", value: longText } },
      ],
    ]);
    const rows = buildRows(records, [n("a", "text")]);
    expect(rows[0]!.preview).toHaveLength(118); // 117 chars + "…"
    expect(rows[0]!.preview!.endsWith("…")).toBe(true);
  });

  it("returns null preview for non-text outputs (images, etc.)", () => {
    const records = new Map<string, ExecutionRecord>([
      [
        "a",
        {
          status: "done",
          output: {
            type: "image",
            value: { url: "https://example.com/x.png" },
          },
        },
      ],
    ]);
    const rows = buildRows(records, [n("a", "image")]);
    expect(rows[0]!.preview).toBeNull();
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* QueuePanel rendering                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

describe("QueuePanel", () => {
  it("renders a circular pill (not the expanded card) when closed", () => {
    useLayoutStore.setState({ queueOpen: false });
    render(withTooltip(<QueuePanel />));
    expect(screen.getByRole("button", { name: /open queue/i })).toBeInTheDocument();
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("renders the empty state when there are no records", () => {
    render(withTooltip(<QueuePanel />));
    expect(screen.getByText(/no executions yet/i)).toBeInTheDocument();
  });

  it("renders one row per record with the node label and status", () => {
    seedNodes([n("a", "text"), n("b", "llm-text")]);
    seedRecords({
      a: {
        status: "done",
        output: { type: "text", value: "upstream" },
      },
      b: {
        status: "done",
        elapsedMs: 1860,
        output: { type: "text", value: "real LLM response" },
        usage: {
          costUsd: 0.000147,
          inputTokens: 19,
          outputTokens: 6,
          model: "anthropic/claude-sonnet-4.5",
        },
      },
    });
    render(withTooltip(<QueuePanel />));
    expect(screen.getByText("Text")).toBeInTheDocument(); // schema title
    expect(screen.getByText("LLM Text")).toBeInTheDocument();
    expect(screen.getByText("real LLM response")).toBeInTheDocument();
  });

  it("renders the meta line with truncated model + elapsed + cost", () => {
    seedNodes([n("b", "llm-text")]);
    seedRecords({
      b: {
        status: "done",
        elapsedMs: 1860,
        output: { type: "text", value: "hi" },
        usage: {
          costUsd: 0.000147,
          model: "anthropic/claude-sonnet-4.5",
        },
      },
    });
    render(withTooltip(<QueuePanel />));
    // Provider prefix stripped; elapsed in seconds; sub-cent in 4 decimals.
    expect(
      screen.getByText("claude-sonnet-4.5 · 1.9 s · $0.0001"),
    ).toBeInTheDocument();
  });

  it("renders the error message inline (role='alert') for errored nodes", () => {
    seedNodes([n("b", "llm-text")]);
    seedRecords({
      b: {
        status: "error",
        error: "Fal OpenRouter error: rate limited",
      },
    });
    render(withTooltip(<QueuePanel />));
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/rate limited/);
  });

  it("renders a footer with the running cost total when > 0", () => {
    seedNodes([n("b", "llm-text")]);
    seedRecords({
      b: {
        status: "done",
        usage: { costUsd: 0.000147 },
      },
    });
    render(withTooltip(<QueuePanel />));
    // Footer carries "this run" copy; cost appears both in the row meta line
    // and the footer, so scope the dollar assertion to the footer.
    const footerText = screen.getByText(/this run/);
    expect(footerText).toBeInTheDocument();
    expect(footerText.parentElement?.textContent).toContain("$0.0001");
  });

  it("omits the footer when total cost is zero (pure-reactive runs)", () => {
    seedNodes([n("a", "text")]);
    seedRecords({
      a: { status: "done", output: { type: "text", value: "x" } },
    });
    render(withTooltip(<QueuePanel />));
    expect(screen.queryByText(/this run/)).toBeNull();
  });

  /* ──────────────────── Slice 5.2: image thumbs ──────────────────── */

  it("renders a 1-up thumbnail for a single image output", () => {
    seedNodes([n("g", "image")]);
    seedRecords({
      g: {
        status: "done",
        output: { type: "image", value: { url: "https://x/solo.png" } },
      },
    });
    render(withTooltip(<QueuePanel />));
    const grid = screen.getByTestId("queue-row-thumbs");
    expect(grid.children).toHaveLength(1);
    expect(grid.className).toContain("grid-cols-1");
    const link = grid.querySelector("a") as HTMLAnchorElement;
    expect(link.href).toContain("https://x/solo.png");
  });

  it("renders a 2×2 grid for a 4-image batch", () => {
    seedNodes([n("g", "higgsfield-image-gen")]);
    seedRecords({
      g: {
        status: "done",
        output: [
          { type: "image", value: { url: "https://x/a.png" } },
          { type: "image", value: { url: "https://x/b.png" } },
          { type: "image", value: { url: "https://x/c.png" } },
          { type: "image", value: { url: "https://x/d.png" } },
        ],
      },
    });
    render(withTooltip(<QueuePanel />));
    const grid = screen.getByTestId("queue-row-thumbs");
    expect(grid.children).toHaveLength(4);
    expect(grid.className).toContain("grid-cols-2");
  });

  it("caps the visible thumbs at MAX_THUMBS and shows a `+N more` chip", () => {
    seedNodes([n("g", "higgsfield-image-gen")]);
    seedRecords({
      g: {
        status: "done",
        output: Array.from({ length: 9 }, (_, i) => ({
          type: "image" as const,
          value: { url: `https://x/${i}.png` },
        })),
      },
    });
    render(withTooltip(<QueuePanel />));
    const grid = screen.getByTestId("queue-row-thumbs");
    // 6 thumbs + 1 overflow chip = 7 children
    expect(grid.children).toHaveLength(7);
    const overflow = screen.getByTestId("queue-row-thumbs-overflow");
    expect(overflow.textContent).toMatch(/\+3 more/);
  });

  it("prefers the image thumb grid over the text preview when both are present (image wins)", () => {
    // Defensive: a node that mixed types; the grid should win and the
    // text preview shouldn't render.
    seedNodes([n("g", "image")]);
    seedRecords({
      g: {
        status: "done",
        output: [
          { type: "image", value: { url: "https://x/a.png" } },
          { type: "text", value: "should not render" },
        ],
      },
    });
    render(withTooltip(<QueuePanel />));
    expect(screen.getByTestId("queue-row-thumbs")).toBeTruthy();
    expect(screen.queryByText(/should not render/)).toBeNull();
  });

  it("renders the image thumbs on `cached` records too", () => {
    seedNodes([n("g", "image")]);
    seedRecords({
      g: {
        status: "cached",
        output: { type: "image", value: { url: "https://x/cached.png" } },
      },
    });
    render(withTooltip(<QueuePanel />));
    expect(screen.getByTestId("queue-row-thumbs")).toBeTruthy();
  });

  it("does NOT render thumbs on running / pending / error", () => {
    seedNodes([n("g", "higgsfield-image-gen")]);
    // running: no output yet
    seedRecords({
      g: { status: "running" },
    });
    render(withTooltip(<QueuePanel />));
    expect(screen.queryByTestId("queue-row-thumbs")).toBeNull();
  });
});
