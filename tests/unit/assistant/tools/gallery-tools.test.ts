import { beforeEach, describe, expect, it, vi } from "vitest";

import "@/lib/engine/all-nodes";

const generationRepoMocks = {
  insert: vi.fn(),
  list: vi.fn().mockResolvedValue([]),
  get: vi.fn(),
  setPinned: vi.fn(),
  setTitle: vi.fn(),
  setTags: vi.fn(),
  remove: vi.fn(),
  listForNode: vi.fn().mockResolvedValue([]),
};
vi.mock("@/lib/repositories/supabase-generation-repository", () => ({
  getGenerationRepository: () => generationRepoMocks,
  SupabaseGenerationRepository: class {},
}));

const { getTool } = await import("@/lib/assistant/tools");

beforeEach(() => {
  Object.values(generationRepoMocks).forEach((m) => {
    if (typeof m.mockReset === "function") m.mockReset();
  });
});

describe("pin_generation", () => {
  it("calls setPinned(id, true) and returns ok", async () => {
    generationRepoMocks.setPinned.mockResolvedValue(undefined);
    const tool = getTool("pin_generation")!;
    const out = (await tool.execute(
      { generationId: "g1", pinned: true },
      {},
    )) as { ok: boolean; pinned?: boolean };
    expect(out.ok).toBe(true);
    expect(out.pinned).toBe(true);
    expect(generationRepoMocks.setPinned).toHaveBeenCalledWith("g1", true);
  });

  it("returns ok:false when repo throws (RLS deny)", async () => {
    generationRepoMocks.setPinned.mockRejectedValue(
      new Error("permission denied"),
    );
    const tool = getTool("pin_generation")!;
    const out = (await tool.execute(
      { generationId: "g1", pinned: false },
      {},
    )) as { ok: boolean; error?: string };
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/permission denied/i);
  });

  it("rejects when pinned isn't a boolean", async () => {
    const tool = getTool("pin_generation")!;
    await expect(
      tool.execute({ generationId: "g1", pinned: "yes" }, {}),
    ).rejects.toBeInstanceOf(Error);
  });
});

describe("delete_generation", () => {
  it("calls remove(id) and returns ok", async () => {
    generationRepoMocks.remove.mockResolvedValue(undefined);
    const tool = getTool("delete_generation")!;
    const out = (await tool.execute({ generationId: "g1" }, {})) as {
      ok: boolean;
    };
    expect(out.ok).toBe(true);
    expect(generationRepoMocks.remove).toHaveBeenCalledWith("g1");
  });

  it("returns ok:false on repo failure", async () => {
    generationRepoMocks.remove.mockRejectedValue(new Error("not found"));
    const tool = getTool("delete_generation")!;
    const out = (await tool.execute({ generationId: "missing" }, {})) as {
      ok: boolean;
      error?: string;
    };
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/not found/i);
  });

  it("rejects empty id (Zod min)", async () => {
    const tool = getTool("delete_generation")!;
    await expect(
      tool.execute({ generationId: "" }, {}),
    ).rejects.toBeInstanceOf(Error);
  });
});

describe("set_generation_title", () => {
  it("forwards a non-empty title to the repo", async () => {
    generationRepoMocks.setTitle.mockResolvedValue(undefined);
    const tool = getTool("set_generation_title")!;
    const out = (await tool.execute(
      { generationId: "g1", title: "Take 3" },
      {},
    )) as { ok: boolean; title?: string | null };
    expect(out.ok).toBe(true);
    expect(out.title).toBe("Take 3");
    expect(generationRepoMocks.setTitle).toHaveBeenCalledWith("g1", "Take 3");
  });

  it("forwards null to clear the title", async () => {
    generationRepoMocks.setTitle.mockResolvedValue(undefined);
    const tool = getTool("set_generation_title")!;
    const out = (await tool.execute(
      { generationId: "g1", title: null },
      {},
    )) as { ok: boolean; title?: string | null };
    expect(out.ok).toBe(true);
    expect(out.title).toBeNull();
    expect(generationRepoMocks.setTitle).toHaveBeenCalledWith("g1", null);
  });

  it("returns ok:false on repo failure", async () => {
    generationRepoMocks.setTitle.mockRejectedValue(
      new Error("invalid title"),
    );
    const tool = getTool("set_generation_title")!;
    const out = (await tool.execute(
      { generationId: "g1", title: "x" },
      {},
    )) as { ok: boolean; error?: string };
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/invalid title/i);
  });

  it("rejects when title is undefined (Zod required)", async () => {
    const tool = getTool("set_generation_title")!;
    await expect(
      tool.execute({ generationId: "g1" }, {}),
    ).rejects.toBeInstanceOf(Error);
  });
});
