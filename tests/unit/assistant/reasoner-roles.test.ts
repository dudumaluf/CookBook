import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { callOpenRouterMock } = vi.hoisted(() => ({
  callOpenRouterMock: vi.fn(),
}));

vi.mock("@/lib/llm/call-openrouter", () => ({
  callOpenRouter: callOpenRouterMock,
  LlmCallError: class extends Error {},
}));

import "@/lib/engine/all-nodes";

vi.mock("@/lib/repositories/supabase-recipe-repository", () => ({
  getRecipeRepository: () => ({
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue(null),
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

const { runReasoner } = await import("@/lib/assistant/reasoner");
const { useAssistantRoleStore } = await import(
  "@/lib/stores/assistant-role-store"
);
const { useAssetStore } = await import("@/lib/stores/asset-store");
const { useExecutionStore } = await import("@/lib/stores/execution-store");
const { useWorkflowStore } = await import("@/lib/stores/workflow-store");

beforeEach(() => {
  callOpenRouterMock.mockReset();
  callOpenRouterMock.mockResolvedValue({
    text: "ok",
    costUsd: 0.001,
    finishReason: "stop",
  });
  useAssistantRoleStore.getState().reset();
  useWorkflowStore.setState({
    nodes: [],
    edges: [],
    selectedNodeIds: [],
    selectedEdgeIds: [],
  });
  useAssetStore.setState({
    assets: [],
    selectedAssetIds: [],
    selectionAnchorId: null,
  });
  useExecutionStore.setState({
    runId: 0,
    isRunning: false,
    records: new Map(),
  });
});

afterEach(() => {
  callOpenRouterMock.mockReset();
});

/**
 * Phase D1 — verifies the role overlay actually lands in the system
 * prompt seen by the LLM call layer. We mock callOpenRouter and
 * inspect the outgoing `messages[0]` (the system message) for the
 * overlay's signature heading.
 */
describe("runReasoner — Phase D1 role overlay", () => {
  it("injects the General role's orchestrator overlay by default", async () => {
    await runReasoner({
      userMessage: "hi",
      ownerId: "u1",
      projectId: "p1",
      signal: new AbortController().signal,
    });
    expect(callOpenRouterMock).toHaveBeenCalled();
    const args = callOpenRouterMock.mock.calls[0]![0];
    const systemContent = systemTextFromArgs(args);
    expect(systemContent).toMatch(/ROLE OVERLAY: General/);
    expect(systemContent).toMatch(/suggest_recipes_for_intent/);
  });

  it("injects the Storyboard Director overlay when that role is active", async () => {
    useAssistantRoleStore.getState().setRoleId("storyboard-director");
    await runReasoner({
      userMessage: "hi",
      ownerId: "u1",
      projectId: "p1",
      signal: new AbortController().signal,
    });
    const args = callOpenRouterMock.mock.calls[0]![0];
    const systemContent = systemTextFromArgs(args);
    expect(systemContent).toMatch(/ROLE OVERLAY: Storyboard Director/);
    expect(systemContent).toMatch(/10 continuity rules/);
  });

  it("places the overlay AFTER the base reasoner instructions (specialization layer)", async () => {
    useAssistantRoleStore.getState().setRoleId("recipe-architect");
    await runReasoner({
      userMessage: "hi",
      ownerId: "u1",
      projectId: "p1",
      signal: new AbortController().signal,
    });
    const args = callOpenRouterMock.mock.calls[0]![0];
    const systemContent = systemTextFromArgs(args);
    const operatingIdx = systemContent.indexOf("## OPERATING INSTRUCTIONS");
    const overlayIdx = systemContent.indexOf("ROLE OVERLAY: Recipe Architect");
    expect(operatingIdx).toBeGreaterThanOrEqual(0);
    expect(overlayIdx).toBeGreaterThanOrEqual(0);
    expect(overlayIdx).toBeGreaterThan(operatingIdx);
  });

  it("falls back to General when an unknown role id is in the store (defensive)", async () => {
    useAssistantRoleStore.setState({ roleId: "the-deleted-role" });
    await runReasoner({
      userMessage: "hi",
      ownerId: "u1",
      projectId: "p1",
      signal: new AbortController().signal,
    });
    const args = callOpenRouterMock.mock.calls[0]![0];
    const systemContent = systemTextFromArgs(args);
    // Falls back to General — General now ships an orchestrator
    // overlay (Phase E), so we look for that signature instead of
    // asserting the absence of any overlay.
    expect(systemContent).toMatch(/ROLE OVERLAY: General/);
    expect(systemContent).not.toMatch(/Storyboard Director|Timeline Director|Recipe Architect|Prompt Engineer/);
  });
});

/**
 * Regression guard for the "phantom tool name in role overlay" bug
 * class (2026-06-03). Three role overlays used to reference
 * `save_recipe_from_selection`, a tool that never existed — the actual
 * tool is `save_selection_as_recipe`. The LLM faithfully called the
 * fake name and silently failed (no error UI; the user just thought
 * "save as recipe" didn't work in those roles).
 *
 * The fix is in the overlay text itself; this test pins it forever.
 * For each role overlay, every backtick-quoted snake_case identifier
 * must be either:
 *   1. The name of a registered assistant tool, OR
 *   2. In `NON_TOOL_SNAKECASE_ALLOWLIST` (config keys, table names,
 *      input handle names, etc. that legitimately appear in prose).
 *
 * Keep the allowlist tight. New entries should be obvious-on-sight
 * non-tool identifiers; if a token is ambiguous, prefer to register
 * the tool or rephrase the overlay.
 */
describe("role overlays — every backticked snake_case identifier resolves", async () => {
  const { ROLES } = await import("@/lib/assistant/roles");
  const { _internalToolList } = await import("@/lib/assistant/tools");

  const registeredToolNames = new Set(
    _internalToolList().map((t) => t.name),
  );

  /**
   * Snake_case identifiers that legitimately appear in role overlay
   * prose without being tool names. Anything else must be a tool.
   */
  const NON_TOOL_SNAKECASE_ALLOWLIST = new Set<string>([
    // Recipe-architect: input handle name examples in prose.
    "reference_image",
    // Recipe-architect: Supabase table name reference.
    "cookbook_recipes",
  ]);

  /**
   * Strict snake_case: lowercase letters / digits with at least one
   * underscore separator. Single-word lowercase tokens like `briefing`
   * are excluded (they're never tool names, and snake_case requires
   * the underscore by convention).
   */
  const SNAKECASE_RE = /`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`/g;

  for (const role of ROLES) {
    it(`${role.id}: every snake_case backtick is a registered tool or allowlisted`, () => {
      const overlay = role.systemPromptOverlay;
      const matches = new Set<string>();
      for (const m of overlay.matchAll(SNAKECASE_RE)) {
        matches.add(m[1]!);
      }
      const unresolved: string[] = [];
      for (const ident of matches) {
        if (registeredToolNames.has(ident)) continue;
        if (NON_TOOL_SNAKECASE_ALLOWLIST.has(ident)) continue;
        unresolved.push(ident);
      }
      // Concrete error message lists offenders so a future role-edit
      // typo is debugged in seconds, not by reading the haystack.
      expect(
        unresolved,
        `Role overlay "${role.id}" references snake_case identifier(s) that are neither registered tools nor allowlisted: [${unresolved.join(", ")}]. Either fix the typo, register the tool, or add the identifier to NON_TOOL_SNAKECASE_ALLOWLIST in this test.`,
      ).toEqual([]);
    });
  }

  it("the allowlist itself doesn't accidentally shadow a registered tool name", () => {
    const conflicts = [...NON_TOOL_SNAKECASE_ALLOWLIST].filter((id) =>
      registeredToolNames.has(id),
    );
    expect(conflicts, `Allowlist entries collide with registered tools: ${conflicts.join(", ")}`).toEqual([]);
  });
});

/**
 * Per-role coverage smoke (2026-06-03 P0.3). After the Mega-capable
 * arc landed 17 new tools, each role overlay was rewritten to teach
 * the relevant trigger phrases for the subset that role uses. These
 * tests pin the coverage so a future overlay refactor can't silently
 * drop those tools out of the LLM's context window.
 */
describe("role overlays — per-role new-tool coverage (2026-06-03)", async () => {
  const { ROLES } = await import("@/lib/assistant/roles");
  const overlayOf = (id: string) =>
    ROLES.find((r) => r.id === id)?.systemPromptOverlay ?? "";

  describe("general overlay", () => {
    const t = overlayOf("general");

    it("teaches read_recent_chat for memory triggers", () => {
      expect(t).toContain("read_recent_chat");
      expect(t).toMatch(/lembra|memory|conversa|window/i);
    });

    it("teaches library mutations (create_group, add_to_group, rename_group, remove_asset)", () => {
      expect(t).toContain("create_group");
      expect(t).toContain("add_to_group");
      expect(t).toContain("rename_group");
      expect(t).toContain("remove_asset");
    });

    it("teaches gallery curation (pin_generation, set_generation_title, delete_generation)", () => {
      expect(t).toContain("pin_generation");
      expect(t).toContain("set_generation_title");
      expect(t).toContain("delete_generation");
    });

    it("teaches recipe lifecycle (delete_recipe, fork_recipe, list_recipe_versions, update_composite_to_latest)", () => {
      expect(t).toContain("delete_recipe");
      expect(t).toContain("fork_recipe");
      expect(t).toContain("list_recipe_versions");
      expect(t).toContain("update_composite_to_latest");
    });

    it("teaches hygiene tools (repair_workflow, clear_run, clear_cache)", () => {
      expect(t).toContain("repair_workflow");
      expect(t).toContain("clear_run");
      expect(t).toContain("clear_cache");
    });
  });

  describe("recipe-architect overlay", () => {
    const t = overlayOf("recipe-architect");

    it("teaches the four recipe-lifecycle tools the role specializes in", () => {
      expect(t).toContain("fork_recipe");
      expect(t).toContain("list_recipe_versions");
      expect(t).toContain("update_composite_to_latest");
      expect(t).toContain("delete_recipe");
    });
  });

  describe("storyboard-director overlay", () => {
    const t = overlayOf("storyboard-director");

    it("teaches gallery curation tools for picking winning panels", () => {
      expect(t).toContain("pin_generation");
      expect(t).toContain("set_generation_title");
      expect(t).toContain("compare_results");
    });
  });

  describe("timeline-director overlay", () => {
    const t = overlayOf("timeline-director");

    it("teaches gallery curation tools for picking winning takes", () => {
      expect(t).toContain("pin_generation");
      expect(t).toContain("set_generation_title");
      expect(t).toContain("compare_results");
    });
  });
});

/**
 * Pull the system text from the outgoing call args, regardless of
 * whether it landed as a string (caching-incapable path) or as
 * cache_control content blocks (Anthropic / Gemini path). Same
 * semantic content either way; tests can grep without branching.
 */
function systemTextFromArgs(args: { messages?: unknown[] }): string {
  const msgs = (args.messages ?? []) as Array<{ role: string; content: unknown }>;
  const sys = msgs.find((m) => m.role === "system");
  if (!sys) return "";
  if (typeof sys.content === "string") return sys.content;
  if (Array.isArray(sys.content)) {
    return (sys.content as Array<{ text?: string }>)
      .map((b) => b.text ?? "")
      .join("\n\n");
  }
  return "";
}
