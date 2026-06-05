import { describe, expect, it } from "vitest";

import {
  detectContradictions,
  hasHardContradiction,
} from "@/lib/assistant/contradictions";

/**
 * 2026-06-05 — ADR-0071 unit tests.
 *
 * The contradiction detector is the load-bearing brick under both:
 *   - the chat-sheet's "alucinação detectada" banner + hidden prose
 *     (`HallucinatedProseBlock`) on hard contradictions, and
 *   - the reasoner's auto-retry loop (one-shot corrective turn when
 *     the model echoes a system-only format token before emitting
 *     final text).
 *
 * The hard tier MUST be a 100%-positive signal (zero false positives),
 * because acting on it hides the model's reply from the user. The
 * soft tier tolerates false positives — the worst it does is show a
 * yellow "verifique" banner. We codify both contracts here so a
 * regex regression in either lights up immediately.
 */
describe("ADR-0071 — contradiction detector", () => {
  describe("hard tier — system-format echoes (100%-positive)", () => {
    it("flags new XML format `<system-tool-trace>`", () => {
      const reasons = detectContradictions({
        text: "Done. <system-tool-trace>update_node_config: x</system-tool-trace>",
        toolsFired: new Set(),
      });
      expect(hasHardContradiction(reasons)).toBe(true);
    });

    it("flags `<system-plan>`, `<system-ask>`, `<system-error>`", () => {
      for (const tag of [
        "system-plan",
        "system-ask",
        "system-error",
      ]) {
        const reasons = detectContradictions({
          text: `OK. <${tag}>fake</${tag}>`,
          toolsFired: new Set(),
        });
        expect(hasHardContradiction(reasons)).toBe(true);
      }
    });

    it("flags legacy bracket format `[tools fired:` (pre-0071)", () => {
      const reasons = detectContradictions({
        text: "✓ patched. [tools fired: update_node_config: x {text}]",
        toolsFired: new Set(),
      });
      expect(hasHardContradiction(reasons)).toBe(true);
    });

    it("flags `[plan emitted:` and `[asked: \"...\"`", () => {
      const a = detectContradictions({
        text: "Plano: [plan emitted: {...}]",
        toolsFired: new Set(),
      });
      expect(hasHardContradiction(a)).toBe(true);
      const b = detectContradictions({
        text: 'Aside: [asked: "are you sure?"]',
        toolsFired: new Set(),
      });
      expect(hasHardContradiction(b)).toBe(true);
    });

    it("hard tier fires REGARDLESS of whether tools actually ran", () => {
      // Even with real receipts, echoing the system format is still
      // a hallucination signal — the model should never paste those
      // tokens into its prose. (Edge case: a model that calls
      // tool + ALSO echoes the format in the final answer.)
      const reasons = detectContradictions({
        text: "✓ patched. [tools fired: update_node_config: n5]",
        toolsFired: new Set(["update_node_config"]),
      });
      expect(hasHardContradiction(reasons)).toBe(true);
    });

    it("hard tier is case-insensitive", () => {
      const reasons = detectContradictions({
        text: "Done. <SYSTEM-TOOL-TRACE>x</SYSTEM-TOOL-TRACE>",
        toolsFired: new Set(),
      });
      expect(hasHardContradiction(reasons)).toBe(true);
    });
  });

  describe("soft tier — verb / receipt mismatch (heuristic)", () => {
    it("flags 'atualizei' with no mutation tool", () => {
      const reasons = detectContradictions({
        text: "Atualizei o node n5.",
        toolsFired: new Set(["read_canvas"]),
      });
      expect(reasons).toHaveLength(1);
      expect(reasons[0]?.severity).toBe("soft");
      expect(reasons[0]?.reason).toContain("alteração");
    });

    it("flags 'rodei' with no run tool", () => {
      const reasons = detectContradictions({
        text: "Rodei o workflow.",
        toolsFired: new Set(["read_canvas"]),
      });
      expect(reasons).toHaveLength(1);
      expect(reasons[0]?.severity).toBe("soft");
      expect(reasons[0]?.reason).toContain("execução");
    });

    it("does NOT flag when matching tool actually fired", () => {
      const reasons = detectContradictions({
        text: "Atualizei o node n5.",
        toolsFired: new Set(["update_node_config"]),
      });
      expect(reasons).toHaveLength(0);
    });

    it("respects negation", () => {
      const reasons = detectContradictions({
        text: "Não rodei nada.",
        toolsFired: new Set(),
      });
      expect(reasons).toHaveLength(0);
    });

    it("returns empty for non-prose payloads", () => {
      const reasons = detectContradictions({
        text: "Atualizei tudo.",
        toolsFired: new Set(),
        hasNonProsePayload: true,
      });
      expect(reasons).toHaveLength(0);
    });

    it("returns empty for blank text", () => {
      const reasons = detectContradictions({
        text: "",
        toolsFired: new Set(),
      });
      expect(reasons).toHaveLength(0);
    });
  });

  describe("interaction — hard + soft together", () => {
    it("returns BOTH severities when text trips both detectors", () => {
      const reasons = detectContradictions({
        text: "Atualizei. [tools fired: update_node_config]",
        toolsFired: new Set(),
      });
      expect(reasons.length).toBeGreaterThanOrEqual(2);
      expect(reasons.some((r) => r.severity === "hard")).toBe(true);
      expect(reasons.some((r) => r.severity === "soft")).toBe(true);
    });

    it("hard fires even on a strict negation that suppresses soft", () => {
      // Negation suppresses the verb/receipt heuristic but not the
      // format-echo signal — that's structural, not lexical.
      const reasons = detectContradictions({
        text: "Não rodei nada — [tools fired: dummy]",
        toolsFired: new Set(),
      });
      expect(reasons.some((r) => r.severity === "hard")).toBe(true);
    });
  });
});
