import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 2026-06-03 — chat-sheet receipt rendering.
 *
 * The ToolCallRow inside ChatSheet renders a second-line receipt
 * when the tool's result includes the new structured shape:
 *   - `changed: ['<key>']` + `before` + `after` → patch line.
 *   - `changed: ['__create']` + `entity` → create line.
 *   - `changed: ['__delete']` + `entity` → delete line.
 *   - `changed: ['__bulk']` + `bulk` → bulk counters.
 *   - `ok: false` + `error: 'no-op patch ...'` → amber no-op line.
 *
 * These tests exercise the ChatSheet by seeding `useAssistantStore`
 * with synthetic events and asserting the rendered DOM. We intentionally
 * use the public store API (no internal exports) so the test breaks
 * if the receipt contract drifts.
 */

vi.mock("@/lib/sync/chat-sync", () => ({
  clearChatForProject: vi.fn(),
}));
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

const { ChatSheet } = await import("@/components/layout/chat-sheet");
const { useAssistantStore } = await import(
  "@/lib/stores/assistant-store"
);
const { useLayoutStore } = await import("@/lib/stores/layout-store");

import type { ReasonerEvent } from "@/lib/assistant/reasoner";

function seed(events: ReasonerEvent[]): void {
  useLayoutStore.setState({ chatSheetOpen: true });
  useAssistantStore.setState({
    messages: [],
    isThinking: false,
    abortController: null,
    liveEvents: events,
    pendingQuestion: null,
    pendingRefactor: null,
  });
}

function callEvent(callId: string, toolName: string): ReasonerEvent {
  return {
    type: "tool_call",
    callId,
    toolName,
    arguments: {},
  } as ReasonerEvent;
}

function resultEvent(
  callId: string,
  result: Record<string, unknown>,
): ReasonerEvent {
  return {
    type: "tool_result",
    callId,
    durationMs: 12,
    result,
  } as ReasonerEvent;
}

beforeEach(() => {
  useLayoutStore.setState({ chatSheetOpen: false });
  useAssistantStore.setState({
    messages: [],
    isThinking: false,
    abortController: null,
    liveEvents: [],
    pendingQuestion: null,
    pendingRefactor: null,
  });
});

afterEach(() => {
  useLayoutStore.setState({ chatSheetOpen: false });
});

describe("ChatSheet — post-write receipts", () => {
  it("renders a patch receipt with changed key + truncated value", () => {
    seed([
      callEvent("c1", "update_node_config"),
      resultEvent("c1", {
        ok: true,
        nodeId: "n5",
        changed: ["text"],
        before: { text: "old" },
        after: {
          text: "Separate each of the 10 environment description prompts.",
        },
      }),
    ]);
    render(<ChatSheet />);
    const receipt = screen.getByTestId("tool-call-receipt");
    expect(receipt).toHaveAttribute("data-receipt-kind", "patch");
    expect(receipt.textContent).toContain("text");
    expect(receipt.textContent).toContain(
      "Separate each of the 10 environment description prom",
    );
  });

  it("renders a create receipt with entity id + kind", () => {
    seed([
      callEvent("c2", "add_node"),
      resultEvent("c2", {
        ok: true,
        nodeId: "n7",
        changed: ["__create"],
        entity: { id: "n7", kind: "text", config: {} },
      }),
    ]);
    render(<ChatSheet />);
    const receipt = screen.getByTestId("tool-call-receipt");
    expect(receipt).toHaveAttribute("data-receipt-kind", "create");
    expect(receipt.textContent).toContain("+n7");
    expect(receipt.textContent).toContain("text");
  });

  it("renders a delete receipt with entity id", () => {
    seed([
      callEvent("c3", "remove_node"),
      resultEvent("c3", {
        ok: true,
        changed: ["__delete"],
        entity: { id: "n3", kind: "llm-text", config: {} },
      }),
    ]);
    render(<ChatSheet />);
    const receipt = screen.getByTestId("tool-call-receipt");
    expect(receipt).toHaveAttribute("data-receipt-kind", "delete");
    expect(receipt.textContent).toContain("−n3");
    expect(receipt.textContent).toContain("llm-text");
  });

  it("renders a bulk receipt with counters", () => {
    seed([
      callEvent("c4", "instantiate_recipe"),
      resultEvent("c4", {
        ok: true,
        mode: "expand",
        changed: ["__bulk"],
        bulk: {
          recipeName: "Performance Video",
          spawnedNodeCount: 5,
        },
      }),
    ]);
    render(<ChatSheet />);
    const receipt = screen.getByTestId("tool-call-receipt");
    expect(receipt).toHaveAttribute("data-receipt-kind", "bulk");
    expect(receipt.textContent).toContain("Performance Video");
    expect(receipt.textContent).toContain("5");
  });

  it("renders a no-op receipt when patch produced no diff", () => {
    seed([
      callEvent("c5", "update_node_config"),
      resultEvent("c5", {
        ok: false,
        error:
          "no-op patch — config did not change. The keys you provided either matched the existing values or are not honored by this node kind.",
        attemptedPatch: { text: "same" },
        nodeId: "n5",
      }),
    ]);
    render(<ChatSheet />);
    const receipt = screen.getByTestId("tool-call-receipt");
    expect(receipt).toHaveAttribute("data-receipt-kind", "noop");
    expect(receipt.textContent).toContain("no-op");
  });

  it("renders nothing when the tool returned plain ok:true (legacy / read tool)", () => {
    seed([
      callEvent("c6", "read_canvas"),
      resultEvent("c6", { ok: true, nodes: [], edges: [] }),
    ]);
    render(<ChatSheet />);
    expect(screen.queryByTestId("tool-call-receipt")).toBeNull();
  });
});

describe("ChatSheet — __preflightHealth", () => {
  it("renders the chip + accordion when __preflightHealth is attached", () => {
    seed([
      callEvent("c10", "update_node_config"),
      resultEvent("c10", {
        ok: true,
        nodeId: "n5",
        changed: ["text"],
        after: { text: "new" },
        before: { text: "old" },
        __preflightHealth: {
          note: "Pre-flight check_workflow_health found errors at the moment this tool fired. Surface them and decide whether to keep going or repair first.",
          issueCount: 2,
          errorCount: 2,
          issues: [
            {
              severity: "error",
              code: "dangling_target_handle",
              edgeId: "e1",
              message: "edge e1 targets handle 'in' which is not in n5.getInputs(config)",
              hint: "rewire the edge to a real handle (run check_workflow_health for the list).",
            },
            {
              severity: "error",
              code: "missing_required_input",
              nodeId: "n5",
              message: "n5 requires `prompt` but no edge feeds it.",
            },
          ],
        },
      }),
    ]);
    render(<ChatSheet />);
    const chip = screen.getByTestId("tool-call-preflight");
    expect(chip).toBeInTheDocument();
    expect(chip.textContent).toContain("2 errors");
    expect(chip.textContent).toContain("preflight");
    const issues = screen.getAllByTestId("tool-call-preflight-issue");
    expect(issues).toHaveLength(2);
    expect(issues[0]!.textContent).toContain("dangling_target_handle");
    expect(issues[0]!.textContent).toContain("e1");
    expect(issues[1]!.textContent).toContain("missing_required_input");
    expect(issues[1]!.textContent).toContain("n5");
  });

  it("does not render the chip when __preflightHealth is absent", () => {
    seed([
      callEvent("c11", "update_node_config"),
      resultEvent("c11", {
        ok: true,
        nodeId: "n5",
        changed: ["text"],
        after: { text: "new" },
        before: { text: "old" },
      }),
    ]);
    render(<ChatSheet />);
    expect(screen.queryByTestId("tool-call-preflight")).toBeNull();
  });
});

describe("ChatSheet — contradiction banner (ADR-0069 F22)", () => {
  it("flags a run claim when no run_* tool fired this turn", () => {
    useLayoutStore.setState({ chatSheetOpen: true });
    useAssistantStore.setState({
      messages: [
        {
          id: "m1",
          role: "assistant",
          content: "Pronto, executei tudo e o run terminou.",
          timestamp: Date.now(),
          toolReceipts: [
            {
              callId: "c1",
              tool: "read_canvas",
              durationMs: 4,
              result: { ok: true, nodes: [], edges: [] },
            },
          ],
        },
      ],
      isThinking: false,
      abortController: null,
      liveEvents: [],
      pendingQuestion: null,
      pendingRefactor: null,
    });
    render(<ChatSheet />);
    const banner = screen.getByTestId("contradiction-banner");
    expect(banner).toBeInTheDocument();
    expect(banner.textContent).toContain("execução");
  });

  it("flags a change claim when no mutation tool fired", () => {
    useLayoutStore.setState({ chatSheetOpen: true });
    useAssistantStore.setState({
      messages: [
        {
          id: "m2",
          role: "assistant",
          content: "Atualizei o node de texto pra 'novo prompt'.",
          timestamp: Date.now(),
          toolReceipts: [
            {
              callId: "c1",
              tool: "read_canvas",
              durationMs: 4,
              result: { ok: true },
            },
          ],
        },
      ],
      isThinking: false,
      abortController: null,
      liveEvents: [],
      pendingQuestion: null,
      pendingRefactor: null,
    });
    render(<ChatSheet />);
    const banner = screen.getByTestId("contradiction-banner");
    expect(banner).toBeInTheDocument();
    expect(banner.textContent).toContain("alteração");
  });

  it("does NOT flag when the matching tool actually fired", () => {
    useLayoutStore.setState({ chatSheetOpen: true });
    useAssistantStore.setState({
      messages: [
        {
          id: "m3",
          role: "assistant",
          content: "Atualizei o node n5 — agora o texto é 'novo'.",
          timestamp: Date.now(),
          toolReceipts: [
            {
              callId: "c1",
              tool: "update_node_config",
              durationMs: 4,
              result: {
                ok: true,
                nodeId: "n5",
                changed: ["text"],
                before: { text: "old" },
                after: { text: "novo" },
              },
            },
          ],
        },
      ],
      isThinking: false,
      abortController: null,
      liveEvents: [],
      pendingQuestion: null,
      pendingRefactor: null,
    });
    render(<ChatSheet />);
    expect(screen.queryByTestId("contradiction-banner")).toBeNull();
  });

  it("respects negation — 'não rodei' should not raise the run banner", () => {
    useLayoutStore.setState({ chatSheetOpen: true });
    useAssistantStore.setState({
      messages: [
        {
          id: "m4",
          role: "assistant",
          content:
            "Não rodei nada — apenas verifiquei o estado e te chamei aqui.",
          timestamp: Date.now(),
          toolReceipts: [
            {
              callId: "c1",
              tool: "read_canvas",
              durationMs: 4,
              result: { ok: true },
            },
          ],
        },
      ],
      isThinking: false,
      abortController: null,
      liveEvents: [],
      pendingQuestion: null,
      pendingRefactor: null,
    });
    render(<ChatSheet />);
    expect(screen.queryByTestId("contradiction-banner")).toBeNull();
  });
});
