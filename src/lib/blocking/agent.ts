import { callOpenRouter } from "@/lib/llm/call-openrouter";
import type { ChatMessage } from "@/lib/llm/types";
import {
  sanitizeBlockingDocument,
  type BlockingDocument,
} from "@/types/blocking";

import { BLOCKING_AGENT_SYSTEM, BLOCKING_AGENT_TOOLS } from "./agent-tools";
import { applyBlockingOp } from "./ops";
import { parseBlockingOp } from "./parse-op";
import { listObjects, readScene, sampleAt } from "./query";

const DEFAULT_MODEL = "google/gemini-2.5-flash";
const MAX_TURNS = 12;

export interface AgentTraceStep {
  name: string;
  args: unknown;
  result: unknown;
}

export interface RunBlockingAgentResult {
  doc: BlockingDocument;
  text: string;
  trace: AgentTraceStep[];
  costUsd?: number;
  model: string;
}

function dispatchQuery(
  name: string,
  args: Record<string, unknown>,
  doc: BlockingDocument,
): unknown {
  if (name === "read_scene") {
    return readScene(doc, typeof args.tMs === "number" ? args.tMs : 0);
  }
  if (name === "sample_at") {
    if (typeof args.tMs !== "number") return { error: "sample_at needs tMs." };
    return sampleAt(
      doc,
      args.tMs,
      typeof args.id === "string" ? args.id : undefined,
    );
  }
  if (name === "list_objects") return listObjects(doc);
  return null;
}

/**
 * Mini reasoner scoped to one BlockingDocument. Mutates via applyBlockingOp.
 * Not execute() — the user still Runs to playblast.
 */
export async function runBlockingAgent(
  rawDoc: BlockingDocument,
  prompt: string,
  signal: AbortSignal,
  model = DEFAULT_MODEL,
): Promise<RunBlockingAgentResult> {
  let doc = sanitizeBlockingDocument(rawDoc);
  const trace: AgentTraceStep[] = [];
  let costUsd = 0;
  const messages: ChatMessage[] = [
    { role: "system", content: BLOCKING_AGENT_SYSTEM },
    {
      role: "user",
      content: `${prompt.trim()}\n\nCurrent scene:\n${JSON.stringify(readScene(doc, 0))}`,
    },
  ];

  let text = "";
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await callOpenRouter({
      model,
      messages,
      tools: BLOCKING_AGENT_TOOLS,
      toolChoice: "auto",
      signal,
      temperature: 0.2,
    });
    costUsd += res.costUsd ?? 0;
    text = res.text ?? "";
    const calls = res.toolCalls ?? [];
    if (calls.length === 0) break;

    messages.push({
      role: "assistant",
      content: res.text || null,
      tool_calls: calls,
    });

    for (const call of calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
      } catch {
        args = {};
      }
      const query = dispatchQuery(call.function.name, args, doc);
      let result: unknown;
      if (query !== null) {
        result = query;
      } else {
        const parsed = parseBlockingOp(call.function.name, args);
        if ("error" in parsed) {
          result = { error: parsed.error };
        } else {
          const applied = applyBlockingOp(doc, parsed);
          doc = applied.doc;
          result = applied.error
            ? { error: applied.error }
            : {
                ok: true,
                createdId: applied.createdId,
                scene: readScene(doc, typeof args.tMs === "number" ? args.tMs : 0),
              };
        }
      }
      trace.push({ name: call.function.name, args, result });
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result).slice(0, 8000),
      });
    }
  }

  return {
    doc: sanitizeBlockingDocument(doc),
    text,
    trace,
    costUsd: costUsd || undefined,
    model,
  };
}
