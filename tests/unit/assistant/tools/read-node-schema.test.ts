import { beforeEach, describe, expect, it, vi } from "vitest";

import "@/lib/engine/all-nodes";

vi.mock("@/lib/repositories/supabase-recipe-repository", () => ({
  getRecipeRepository: () => ({
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn(),
    save: vi.fn(),
    remove: vi.fn(),
  }),
  SupabaseRecipeRepository: class {},
}));
vi.mock("@/lib/repositories/supabase-generation-repository", () => ({
  getGenerationRepository: () => ({
    list: vi.fn().mockResolvedValue([]),
    insert: vi.fn(),
    setPinned: vi.fn(),
    setTitle: vi.fn(),
    setTags: vi.fn(),
    remove: vi.fn(),
    listForNode: vi.fn().mockResolvedValue([]),
  }),
  SupabaseGenerationRepository: class {},
}));

const { getTool, getToolDefinitions } = await import("@/lib/assistant/tools");

beforeEach(() => {
  // No store reset needed; read_node_schema reads only from the
  // static node registry.
});

describe("read_node_schema tool — Slice 2", () => {
  it("is registered alongside the other read_* tools", () => {
    const names = getToolDefinitions().map((d) => d.function.name);
    expect(names).toContain("read_node_schema");
  });

  it("returns full schema for a known kind (text)", async () => {
    const tool = getTool("read_node_schema")!;
    const out = (await tool.execute({ kind: "text" }, {})) as {
      found: boolean;
      kind: string;
      title: string;
      category: string;
      reactive: boolean;
      iterator: boolean;
      inputs: Array<{ id: string; dataType: string }>;
      outputs: Array<{ id: string; dataType: string }>;
      defaultConfig: unknown;
    };
    expect(out.found).toBe(true);
    expect(out.kind).toBe("text");
    expect(typeof out.title).toBe("string");
    expect(out.title.length).toBeGreaterThan(0);
    expect(typeof out.reactive).toBe("boolean");
    expect(typeof out.iterator).toBe("boolean");
    expect(Array.isArray(out.inputs)).toBe(true);
    expect(Array.isArray(out.outputs)).toBe(true);
    expect(out.outputs.length).toBeGreaterThanOrEqual(1);
  });

  it("includes per-handle dataType + multiple flags", async () => {
    const tool = getTool("read_node_schema")!;
    const out = (await tool.execute({ kind: "llm-text" }, {})) as {
      found: boolean;
      inputs: Array<{ id: string; dataType: string; multiple?: boolean }>;
      outputs: Array<{ id: string; dataType: string }>;
    };
    expect(out.found).toBe(true);
    for (const handle of [...out.inputs, ...out.outputs]) {
      expect(typeof handle.id).toBe("string");
      expect(typeof handle.dataType).toBe("string");
    }
  });

  it("returns found:false on unknown kind without throwing", async () => {
    const tool = getTool("read_node_schema")!;
    const out = (await tool.execute({ kind: "definitely-not-a-kind" }, {})) as {
      found: boolean;
      error?: string;
    };
    expect(out.found).toBe(false);
    expect(out.error).toContain("definitely-not-a-kind");
  });

  it("strips non-serializable bits from defaultConfig (JSON-roundtrip)", async () => {
    const tool = getTool("read_node_schema")!;
    const out = (await tool.execute({ kind: "text" }, {})) as {
      found: boolean;
      defaultConfig: unknown;
    };
    expect(out.found).toBe(true);
    // The roundtrip should always yield a JSON-stringifiable value
    // (covers the failure mode where defaultConfig held a class
    // instance or function).
    expect(() => JSON.stringify(out.defaultConfig)).not.toThrow();
  });

  it("rejects empty kind via the args schema", async () => {
    const tool = getTool("read_node_schema")!;
    await expect(tool.execute({ kind: "" }, {})).rejects.toBeDefined();
  });
});
