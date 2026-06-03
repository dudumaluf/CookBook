import { beforeEach, describe, expect, it } from "vitest";

import "@/lib/engine/all-nodes";

import type { AssistantMessage } from "@/lib/assistant/types";
import { useAssistantStore } from "@/lib/stores/assistant-store";

const { getTool } = await import("@/lib/assistant/tools");

interface ReadResult {
  ok: true;
  totalChatLength: number;
  returned: number;
  oldestTimestamp: number | null;
  messages: Array<{
    role: "user" | "assistant" | "system";
    content: string;
    timestamp: number;
    costUsd?: number;
    error?: string;
    hadPlan?: true;
  }>;
}

function msg(
  role: AssistantMessage["role"],
  content: string,
  timestamp: number,
  extras: Partial<AssistantMessage> = {},
): AssistantMessage {
  return { role, content, timestamp, ...extras };
}

beforeEach(() => {
  useAssistantStore.setState({ messages: [] });
});

describe("read_recent_chat tool", () => {
  it("returns the most recent N in chronological order by default", async () => {
    const seed: AssistantMessage[] = [];
    for (let i = 0; i < 30; i++) {
      seed.push(
        msg(i % 2 === 0 ? "user" : "assistant", `msg-${i}`, 1000 + i),
      );
    }
    useAssistantStore.setState({ messages: seed });
    const tool = getTool("read_recent_chat")!;
    const out = (await tool.execute({}, {})) as ReadResult;
    expect(out.ok).toBe(true);
    expect(out.totalChatLength).toBe(30);
    expect(out.returned).toBe(10);
    expect(out.messages[0]!.timestamp).toBeLessThan(
      out.messages[out.messages.length - 1]!.timestamp,
    );
    expect(out.messages[0]!.content).toBe("msg-20");
    expect(out.messages[9]!.content).toBe("msg-29");
  });

  it("paginates backwards via the `before` cursor", async () => {
    const seed: AssistantMessage[] = [];
    for (let i = 0; i < 25; i++) {
      seed.push(msg("user", `m${i}`, 1000 + i));
    }
    useAssistantStore.setState({ messages: seed });
    const tool = getTool("read_recent_chat")!;
    const first = (await tool.execute({ limit: 5 }, {})) as ReadResult;
    expect(first.messages.map((m) => m.content)).toEqual([
      "m20",
      "m21",
      "m22",
      "m23",
      "m24",
    ]);
    const cursor = first.messages[0]!.timestamp;
    const next = (await tool.execute(
      { before: cursor, limit: 5 },
      {},
    )) as ReadResult;
    expect(next.messages.map((m) => m.content)).toEqual([
      "m15",
      "m16",
      "m17",
      "m18",
      "m19",
    ]);
  });

  it("filters by substring with `query` (case-insensitive)", async () => {
    useAssistantStore.setState({
      messages: [
        msg("user", "Coffee with the moodboard please", 1),
        msg("assistant", "Sure, here's a plan", 2),
        msg("user", "Try a darker COFFEE tone", 3),
        msg("assistant", "Roger", 4),
        msg("user", "Switch to tea", 5),
      ],
    });
    const tool = getTool("read_recent_chat")!;
    const out = (await tool.execute({ query: "coffee" }, {})) as ReadResult;
    expect(out.returned).toBe(2);
    expect(out.messages[0]!.content).toContain("Coffee");
    expect(out.messages[1]!.content).toContain("COFFEE");
  });

  it("strips plan body but preserves hadPlan + error + costUsd markers", async () => {
    useAssistantStore.setState({
      messages: [
        msg("assistant", "ok", 1, {
          plan: {
            reasoning: "x",
            steps: [],
            estimatedCostUsd: 0,
          },
          costUsd: 0.012,
        }),
        msg("assistant", "fail", 2, { error: "upstream blew up" }),
      ],
    });
    const tool = getTool("read_recent_chat")!;
    const out = (await tool.execute({}, {})) as ReadResult;
    expect(out.messages[0]!.hadPlan).toBe(true);
    expect(out.messages[0]!.costUsd).toBe(0.012);
    expect(out.messages[1]!.error).toBe("upstream blew up");
    // Plan body itself is NOT in the wire format.
    expect(out.messages[0] as unknown as { plan?: unknown }).not.toHaveProperty("plan");
  });

  it("caps `limit` at 50 even if the LLM asks for 1000", async () => {
    const tool = getTool("read_recent_chat")!;
    await expect(
      tool.execute({ limit: 1000 }, {}),
    ).rejects.toThrow();
  });

  it("returns empty cleanly when chat is empty", async () => {
    const tool = getTool("read_recent_chat")!;
    const out = (await tool.execute({}, {})) as ReadResult;
    expect(out.totalChatLength).toBe(0);
    expect(out.returned).toBe(0);
    expect(out.oldestTimestamp).toBeNull();
    expect(out.messages).toEqual([]);
  });

  it("rejects unknown args via strict Zod (typo-proof contract)", async () => {
    const tool = getTool("read_recent_chat")!;
    await expect(
      tool.execute({ unexpected: "field" }, {}),
    ).rejects.toThrow();
  });
});
