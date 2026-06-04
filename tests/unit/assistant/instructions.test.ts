import { describe, expect, it } from "vitest";

import { REASONER_INSTRUCTIONS } from "@/lib/assistant/instructions";

/**
 * 2026-06-03 — Smoke tests pinning the canonical sections of
 * `REASONER_INSTRUCTIONS`. The instructions are a long markdown
 * blob that the LLM sees verbatim; small text-level regressions
 * (a deleted heading, a typo in a tool name) silently degrade
 * assistant behavior. These tests catch those regressions early.
 *
 * Each test checks for a STRUCTURAL anchor (heading) and one
 * concrete behavioral instruction underneath it.
 */

describe("REASONER_INSTRUCTIONS — section anchors", () => {
  it("declares the OPERATING INSTRUCTIONS header", () => {
    expect(REASONER_INSTRUCTIONS).toMatch(/##\s+OPERATING INSTRUCTIONS/);
  });

  it("declares the POST-WRITE RECEIPTS section (anti-confabulation)", () => {
    expect(REASONER_INSTRUCTIONS).toMatch(/##\s+POST-WRITE RECEIPTS/);
    expect(REASONER_INSTRUCTIONS).toContain("changed");
    expect(REASONER_INSTRUCTIONS).toContain("no-op");
    expect(REASONER_INSTRUCTIONS).toContain("attemptedPatch");
  });

  it("declares the VERIFICATION section", () => {
    expect(REASONER_INSTRUCTIONS).toMatch(/##\s+VERIFICATION/);
    expect(REASONER_INSTRUCTIONS).toContain("check_workflow_health");
  });

  it("declares the PRE-FLIGHT section that teaches __preflightHealth surfacing", () => {
    expect(REASONER_INSTRUCTIONS).toMatch(/##\s+PRE-FLIGHT/);
    expect(REASONER_INSTRUCTIONS).toContain("__preflightHealth");
    expect(REASONER_INSTRUCTIONS).toContain("repair_workflow");
    expect(REASONER_INSTRUCTIONS).toContain("propose_refactor");
  });

  it("declares the BATCHING section that explains propose_refactor", () => {
    expect(REASONER_INSTRUCTIONS).toMatch(/##\s+BATCHING/);
    expect(REASONER_INSTRUCTIONS).toContain("propose_refactor");
  });

  it("declares the PENDING PROPOSALS section that teaches apply_pending_refactor", () => {
    expect(REASONER_INSTRUCTIONS).toMatch(/##\s+PENDING PROPOSALS/);
    expect(REASONER_INSTRUCTIONS).toContain("apply_pending_refactor");
  });

  it("declares the ANALYSIS / OPTIMIZATION FLOW section", () => {
    expect(REASONER_INSTRUCTIONS).toMatch(/##\s+ANALYSIS \/ OPTIMIZATION FLOW/);
    expect(REASONER_INSTRUCTIONS).toContain("UNDERSTAND");
    expect(REASONER_INSTRUCTIONS).toContain("CRITIQUE");
    expect(REASONER_INSTRUCTIONS).toContain("PROPOSE");
  });
});

describe("REASONER_INSTRUCTIONS — anti-confabulation guarantees", () => {
  it("forbids 'feito' / 'atualizei' / 'done' / 'updated' without the receipt", () => {
    const t = REASONER_INSTRUCTIONS;
    expect(t).toMatch(/feito|atualizei|done|pronto/);
    expect(t).toMatch(/changed|receipt|verbatim/);
  });

  it("teaches what to do on no-op patches", () => {
    expect(REASONER_INSTRUCTIONS).toContain("read_node_state");
    expect(REASONER_INSTRUCTIONS).toContain("no-op");
  });

  it("calls out the three concrete confabulation patterns the runtime catches", () => {
    expect(REASONER_INSTRUCTIONS).toContain("array.separator");
    expect(REASONER_INSTRUCTIONS).toContain("delimiter");
    expect(REASONER_INSTRUCTIONS).toContain("fal-image");
    expect(REASONER_INSTRUCTIONS).toContain("dangling_target_handle");
  });
});

describe("REASONER_INSTRUCTIONS — cost discipline", () => {
  it("ties the four costClass labels to a dispatch policy", () => {
    const t = REASONER_INSTRUCTIONS;
    expect(t).toContain("costClass");
    expect(t).toMatch(/free.*dispatch directly/i);
    expect(t).toMatch(/small.*dispatch directly/i);
    expect(t).toMatch(/medium.*dispatch directly/i);
  });

  it("requires ask_user before large spends unless the user said run/go/executa", () => {
    const t = REASONER_INSTRUCTIONS;
    expect(t).toContain("large");
    expect(t).toMatch(/ask_user/);
    expect(t).toMatch(/(run it|run-intent|executa|roda|render)/i);
  });
});

describe("REASONER_INSTRUCTIONS — precision pass (2026-06-04)", () => {
  it("declares the PLAN-FIRST PROTOCOL section for compound asks", () => {
    expect(REASONER_INSTRUCTIONS).toMatch(/##\s+PLAN-FIRST PROTOCOL/);
    expect(REASONER_INSTRUCTIONS).toContain("3+ distinct sub-tasks");
    expect(REASONER_INSTRUCTIONS).toContain("narrate({");
    expect(REASONER_INSTRUCTIONS).toMatch(/Plan: 1\)/);
  });

  it("PLAN-FIRST hooks back into VERIFICATION's multi-step rule", () => {
    const t = REASONER_INSTRUCTIONS;
    /* The plan section MUST instruct the LLM to verify after the
     * last step, otherwise compound writes can drift silently. */
    expect(t).toMatch(/check_workflow_health/);
    expect(t).toMatch(/3\+ structural mutations|multi-step writes/i);
  });

  it("declares the ERROR RECOVERY section with at least 8 ok:false patterns", () => {
    const t = REASONER_INSTRUCTIONS;
    expect(t).toMatch(/##\s+ERROR RECOVERY/);
    /* Sample patterns the LLM must know how to recover from. */
    expect(t).toContain("no-op patch");
    expect(t).toContain("Unknown node kind");
    expect(t).toContain("duplicate");
    expect(t).toContain("Capacity violation");
    expect(t).toContain("Self-loop");
    expect(t).toContain("Canvas is empty");
    expect(t).toContain("RLS");
    expect(t).toContain("Validation failed");
  });

  it("ERROR RECOVERY forbids claiming success after ok:false", () => {
    const t = REASONER_INSTRUCTIONS;
    expect(t).toMatch(/NEVER write[\s\S]*feito[\s\S]*ok: false/);
  });

  it("declares the INTENT VOCABULARY section mapping common phrases to tools", () => {
    const t = REASONER_INSTRUCTIONS;
    expect(t).toMatch(/##\s+INTENT VOCABULARY/);
    /* Spot-check a few row pairs the user will absolutely hit. */
    expect(t).toMatch(/salva|save these|agrupa.*create_group/);
    expect(t).toMatch(/fixa|pin.*pin_generation/);
    expect(t).toMatch(/conserta|fix this.*repair_workflow/);
    expect(t).toMatch(/forka|duplicate the recipe.*fork_recipe/);
    expect(t).toMatch(/experimenta varia|regenerate|more options.*regenerate/);
    expect(t).toMatch(/junta esses nodes|save as recipe.*save_selection_as_recipe/);
  });

  it("declares the CANONICAL EXAMPLES section with at least 6 few-shots", () => {
    const t = REASONER_INSTRUCTIONS;
    expect(t).toMatch(/##\s+CANONICAL EXAMPLES/);
    /* Each headline MUST appear so the LLM can pattern-match. */
    expect(t).toContain("### Example 1");
    expect(t).toContain("### Example 2");
    expect(t).toContain("### Example 3");
    expect(t).toContain("### Example 4");
    expect(t).toContain("### Example 5");
    expect(t).toContain("### Example 6");
  });

  it("CANONICAL EXAMPLES cover patch / no-op / compound / analyze / ambiguity / duplicate-disambiguation", () => {
    const t = REASONER_INSTRUCTIONS;
    /* Headline themes — fragile if someone renames an example, by
     * design (the renaming should be deliberate, not silent). */
    expect(t).toMatch(/Example 1.*patch the focused.*node, real change/);
    expect(t).toMatch(/Example 2.*no-op reconciliation/);
    expect(t).toMatch(/Example 3.*compound ask with plan-first/);
    expect(t).toMatch(/Example 4.*analyze.*refactor on confirmation/);
    expect(t).toMatch(/Example 5.*ambiguity.*ask_user/);
    expect(t).toMatch(/Example 6.*duplicate-text disambiguation/);
  });

  it("DEICTIC EDITS section is present (ADR-0069 F3)", () => {
    const t = REASONER_INSTRUCTIONS;
    expect(t).toMatch(/##\s+DEICTIC EDITS/);
    expect(t).toMatch(/this\s*\/\s*that\s*\/\s*it\s*\/\s*isso/i);
    expect(t).toMatch(/FOCUSED NODE/);
    expect(t).toMatch(/SELECTED/);
    expect(t).toMatch(/never pick a node by matching its config text/i);
  });

  it("VERIFICATION section now teaches self-verification after multi-step writes", () => {
    const t = REASONER_INSTRUCTIONS;
    expect(t).toMatch(/Self-verification after multi-step writes/i);
    expect(t).toMatch(/3\+ structural mutations/);
    expect(t).toMatch(/even if the user didn't ask/i);
  });
});
