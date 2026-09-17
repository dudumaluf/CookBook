import { describe, expect, it, vi } from "vitest";

const { callOpenRouter } = vi.hoisted(() => ({ callOpenRouter: vi.fn() }));
vi.mock("@/lib/llm/call-openrouter", () => ({ callOpenRouter }));

import { runBlockingAgent } from "@/lib/blocking/agent";
import { createDefaultDocument } from "@/types/blocking";

describe("blocking agent", () => {
  it("applies tool-call ops onto the document", async () => {
    callOpenRouter.mockResolvedValueOnce({
      text: "",
      model: "google/gemini-2.5-flash",
      toolCalls: [
        {
          id: "c1",
          type: "function",
          function: {
            name: "add_primitive",
            arguments: JSON.stringify({ kind: "capsule", id: "hero", name: "Hero" }),
          },
        },
      ],
    });
    callOpenRouter.mockResolvedValueOnce({
      text: "Added a capsule.",
      model: "google/gemini-2.5-flash",
      toolCalls: [],
    });

    const result = await runBlockingAgent(
      createDefaultDocument(),
      "add a person",
      new AbortController().signal,
    );
    expect(result.doc.objects.some((o) => o.id === "hero")).toBe(true);
    expect(result.trace[0]?.name).toBe("add_primitive");
    expect(result.text).toMatch(/capsule/i);
  });
});
