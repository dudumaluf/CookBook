/**
 * Hallucination / contradiction detection — ADR-0069 F22 + ADR-0071.
 *
 * Pure functions for deciding whether an assistant message's prose is
 * consistent with the tools it actually called. Two severity tiers:
 *
 *   - **hard** — the message contains a system-only format token
 *     (`<system-tool-trace>`, `[tools fired:`, `[plan emitted:`,
 *     `<system-plan>`, `[asked:`, `<system-ask>`, etc.). These are
 *     wrappers `buildConversationMessages` injects into PAST-turn
 *     context for the LLM; the model is explicitly forbidden from
 *     emitting them in its own response. If they show up in
 *     `message.content` it is a 100%-positive hallucination signal:
 *     the model is faking tool execution by echoing the system's own
 *     framing back at us.
 *   - **soft** — heuristic verb-vs-receipt mismatch. The text says
 *     "I patched / I ran / atualizei / regenerei …" but the matching
 *     tool category never appears in the receipts. Conservative
 *     pretérito-perfeito + present-progressive matching with negation
 *     suppression. Useful but lossy.
 *
 * Hard contradictions trigger:
 *   - server-side, in the reasoner: a corrective auto-retry turn
 *     (one shot — fail closed if the model keeps lying).
 *   - client-side, in `chat-sheet.tsx`: a red banner + a default-
 *     hidden "show original (incorrect) response" toggle so the lying
 *     prose doesn't masquerade as truth.
 *
 * Soft contradictions keep the existing yellow "verifique antes de
 * confiar" banner and don't gate the message body — false positives
 * are tolerable.
 */

export type ContradictionSeverity = "hard" | "soft";

export interface ContradictionReason {
  severity: ContradictionSeverity;
  reason: string;
}

/**
 * Tokens that ONLY the system injects into the LLM's CONTEXT. If the
 * model emits any of these in its own response it's faking past-turn
 * receipts. Keep these in sync with `buildConversationMessages`.
 *
 * The new ADR-0071 format (`<system-…>` XML tags) is the canonical
 * shape going forward, but we keep the legacy bracket markers in the
 * detector forever — older models trained on the pre-0071 prompts may
 * still try to LARP the old format, and assistant messages persisted
 * before the format switch may include them too.
 */
const SYSTEM_FORMAT_ECHO_RE =
  /<system-(?:tool-trace|plan|ask|error)\b|\[tools fired:|\[plan emitted:|\[asked:\s*"|\[run summary:/i;

const RUN_CLAIM_RE =
  /\b(ran|running|executed|regenerated|kicked off|rodei|rodando|executei|gerei|regenerei|comecei|iniciei|started)\b/i;
const CHANGE_CLAIM_RE =
  /\b(changed|updated|modified|patched|set to|connected|wired|alterei|mudei|atualizei|modifiquei|coloquei|defini|conectei|liguei)\b/i;
const NEGATION_RE =
  /\b(didn'?t|didnt|did not|won'?t|will not|no longer|não|nao|sem)\s+(\w+\s+)?(run|change|update|patch|connect|rodei|mudei|alterei|atualizei|conectei|liguei)\b/i;

const RUN_TOOLS = new Set(["run_workflow", "run_from", "regenerate"]);
const MUTATION_TOOLS = new Set([
  "update_node_config",
  "add_node",
  "remove_node",
  "add_edge",
  "remove_edge",
  "move_node",
  "instantiate_recipe",
  "regenerate",
  "diff_config",
]);

/**
 * Inputs the detector needs. Decoupled from `AssistantMessage` so the
 * reasoner can call it with a freshly-built turn snapshot before the
 * message is persisted.
 */
export interface ContradictionInput {
  /** The model's emitted final text for this turn. */
  text: string | null | undefined;
  /** Tool names that fired during this turn. */
  toolsFired: ReadonlySet<string>;
  /**
   * If true, the message has a non-prose payload (plan card / question
   * card / explicit error block) and the prose contradiction check is
   * skipped — those payloads carry their own structured truth.
   */
  hasNonProsePayload?: boolean;
}

/**
 * Run all detectors and return every contradiction reason. Empty array
 * means the message is consistent with its receipts.
 */
export function detectContradictions(
  input: ContradictionInput,
): ContradictionReason[] {
  if (input.hasNonProsePayload) return [];
  const text = (input.text ?? "").trim();
  if (text.length === 0) return [];

  const reasons: ContradictionReason[] = [];

  // HARD — system-format echo. Always fires regardless of negation /
  // verb tense; the format itself is the smoking gun.
  if (SYSTEM_FORMAT_ECHO_RE.test(text)) {
    reasons.push({
      severity: "hard",
      reason:
        "Resposta contém um token de formato exclusivo do sistema (<system-…> ou [tools fired: …]). O modelo está fingindo que chamou ferramentas — esses marcadores só são injetados pelo sistema no histórico, nunca devem aparecer numa resposta nova.",
    });
  }

  // SOFT — heuristic verb / receipt mismatch.
  if (NEGATION_RE.test(text)) {
    return reasons;
  }
  if (RUN_CLAIM_RE.test(text)) {
    const ranSomething = setHasAny(input.toolsFired, RUN_TOOLS);
    if (!ranSomething) {
      reasons.push({
        severity: "soft",
        reason:
          "Mensagem afirma execução, mas nenhum run_workflow / run_from / regenerate foi chamado neste turno.",
      });
    }
  }
  if (CHANGE_CLAIM_RE.test(text)) {
    const mutated = setHasAny(input.toolsFired, MUTATION_TOOLS);
    if (!mutated) {
      reasons.push({
        severity: "soft",
        reason:
          "Mensagem afirma alteração, mas nenhum tool de escrita (update_node_config, add_node, add_edge, …) foi chamado neste turno.",
      });
    }
  }

  return reasons;
}

/** Convenience — true if the input has at least one hard contradiction. */
export function hasHardContradiction(reasons: ContradictionReason[]): boolean {
  return reasons.some((r) => r.severity === "hard");
}

function setHasAny(
  set: ReadonlySet<string>,
  candidates: ReadonlySet<string>,
): boolean {
  for (const c of candidates) {
    if (set.has(c)) return true;
  }
  return false;
}
