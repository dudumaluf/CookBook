import { describe, expect, it } from "vitest";

import {
  diffShallow,
  snapshotEdge,
  snapshotNode,
  summarizeChanges,
  truncateValue,
} from "@/lib/assistant/tools/construct/diff-config";
import type { NodeInstance, WorkflowEdge } from "@/types/node";

/**
 * Unit tests for the post-write receipt helpers (2026-06-03).
 *
 * The helpers are pure — given a before/after snapshot they return
 * the diff. The "anti-confabulation" guarantee depends on this
 * primitive being correct: false positives mean the LLM claims
 * changes that didn't happen; false negatives mean it doesn't claim
 * changes that did.
 */

describe("diffShallow", () => {
  it("returns empty changed array when before and after are identical", () => {
    const r = diffShallow({ a: 1, b: "x" }, { a: 1, b: "x" });
    expect(r.changed).toEqual([]);
    expect(r.pickedBefore).toEqual({});
    expect(r.pickedAfter).toEqual({});
  });

  it("detects a single field change", () => {
    const r = diffShallow({ a: 1, b: "x" }, { a: 2, b: "x" });
    expect(r.changed).toEqual(["a"]);
    expect(r.pickedBefore).toEqual({ a: 1 });
    expect(r.pickedAfter).toEqual({ a: 2 });
  });

  it("treats added keys as changes", () => {
    const r = diffShallow({ a: 1 } as Record<string, unknown>, {
      a: 1,
      b: 2,
    } as Record<string, unknown>);
    expect(r.changed).toEqual(["b"]);
  });

  it("treats removed keys as changes", () => {
    const r = diffShallow({ a: 1, b: 2 } as Record<string, unknown>, {
      a: 1,
    } as Record<string, unknown>);
    expect(r.changed).toEqual(["b"]);
  });

  it("uses stable encoding for objects with reordered keys", () => {
    const r = diffShallow(
      { a: { x: 1, y: 2 } } as Record<string, unknown>,
      { a: { y: 2, x: 1 } } as Record<string, unknown>,
    );
    expect(r.changed).toEqual([]);
  });

  it("detects array element changes", () => {
    const r = diffShallow({ list: [1, 2, 3] }, { list: [1, 2, 4] });
    expect(r.changed).toEqual(["list"]);
  });

  it("distinguishes undefined from null", () => {
    const r = diffShallow(
      { v: undefined } as Record<string, unknown>,
      { v: null } as Record<string, unknown>,
    );
    expect(r.changed).toEqual(["v"]);
  });

  it("reports multiple changes alphabetized", () => {
    const r = diffShallow(
      { z: 1, a: "old", m: false },
      { z: 2, a: "new", m: false },
    );
    expect(r.changed).toEqual(["a", "z"]);
  });

  it("regression — the user's screenshot bug: same value patch is no-op", () => {
    // Bug: user reports "muda pra 10". LLM patches `text:
    // "Separate each of the 10..."` but the node already had that
    // value. Old contract returned ok:true; the LLM said "atualizei!"
    // The new contract returns ok:false because diff is empty.
    const before = {
      text: "Separate each of the 5 environment description prompts.",
    };
    const after = {
      text: "Separate each of the 5 environment description prompts.",
    };
    const r = diffShallow(before, after);
    expect(r.changed).toEqual([]);
  });
});

describe("truncateValue", () => {
  it("quotes short strings", () => {
    expect(truncateValue("hi")).toBe('"hi"');
  });

  it("truncates long strings with an ellipsis", () => {
    const s = "a".repeat(100);
    expect(truncateValue(s, 60)).toMatch(/^"a+\.\.\."$/);
    expect(truncateValue(s, 60).length).toBe(62);
  });

  it("renders numbers + booleans + null + undefined explicitly", () => {
    expect(truncateValue(42)).toBe("42");
    expect(truncateValue(true)).toBe("true");
    expect(truncateValue(null)).toBe("null");
    expect(truncateValue(undefined)).toBe("—");
  });

  it("collapses arrays and objects", () => {
    expect(truncateValue([1, 2, 3])).toBe("[3]");
    expect(truncateValue({ a: 1 })).toBe("{…}");
  });
});

describe("summarizeChanges", () => {
  it("returns a one-liner with all changed fields", () => {
    const summary = summarizeChanges(["text", "delimiter"], {
      text: "hello world",
      delimiter: "**",
    });
    expect(summary).toBe('text: "hello world", delimiter: "**"');
  });

  it("handles no changes gracefully", () => {
    expect(summarizeChanges([], {})).toBe("(no changes)");
  });
});

describe("snapshotNode", () => {
  it("captures id, kind, position, and config", () => {
    const node: NodeInstance = {
      id: "n1",
      kind: "text",
      position: { x: 50, y: 100 },
      config: { text: "hello" },
      label: "Greeting",
    };
    const snap = snapshotNode(node);
    expect(snap.id).toBe("n1");
    expect(snap.kind).toBe("text");
    expect(snap.position).toEqual({ x: 50, y: 100 });
    expect(snap.config).toEqual({ text: "hello" });
  });
});

describe("snapshotEdge", () => {
  it("captures id, source/target, and handles", () => {
    const edge: WorkflowEdge = {
      id: "e1",
      source: "n1",
      sourceHandle: "out",
      target: "n2",
      targetHandle: "in",
    };
    const snap = snapshotEdge(edge);
    expect(snap).toEqual({
      id: "e1",
      source: "n1",
      sourceHandle: "out",
      target: "n2",
      targetHandle: "in",
    });
  });
});
