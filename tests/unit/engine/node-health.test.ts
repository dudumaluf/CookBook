import { describe, expect, it } from "vitest";

import { kindPitfalls, runKindHealth } from "@/lib/engine/node-health";
import type { NodeInstance } from "@/types/node";

const at = { x: 0, y: 0 };

describe("runKindHealth — array", () => {
  it("flags a phantom `separator` field as a warn", () => {
    const node: NodeInstance = {
      id: "a1",
      kind: "array",
      position: at,
      config: { delimiter: ",", separator: "**" },
    };
    const issues = runKindHealth(node);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("warn");
    expect(issues[0]!.code).toBe("phantom_config_field");
    expect(issues[0]!.nodeId).toBe("a1");
    expect(issues[0]!.message).toMatch(/separator/);
    expect(issues[0]!.hint).toMatch(/delimiter/);
  });

  it("flags `separator` even when delimiter is also set correctly", () => {
    // Even if the user sets a real delimiter, a lingering phantom
    // `separator` field in the JSON is a confusion hazard — flag it
    // until the next migration scrubs it.
    const node: NodeInstance = {
      id: "a1",
      kind: "array",
      position: at,
      config: { delimiter: "**", separator: "**" },
    };
    expect(runKindHealth(node)).toHaveLength(1);
  });

  it("returns no issues for a clean array config", () => {
    const node: NodeInstance = {
      id: "a1",
      kind: "array",
      position: at,
      config: { delimiter: "**", trim: true },
    };
    expect(runKindHealth(node)).toHaveLength(0);
  });
});

describe("runKindHealth — fal-image", () => {
  it("flags an endpoint-id model with the right code", () => {
    const node: NodeInstance = {
      id: "f1",
      kind: "fal-image",
      position: at,
      config: { model: "fal-ai/nano-banana-2" },
    };
    const issues = runKindHealth(node);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe("fal_image_endpoint_id_in_model");
    expect(issues[0]!.severity).toBe("warn");
    expect(issues[0]!.message).toContain("fal-ai/nano-banana-2");
    expect(issues[0]!.hint).toMatch(/literal/);
  });

  it("flags an unknown non-prefixed model", () => {
    const node: NodeInstance = {
      id: "f1",
      kind: "fal-image",
      position: at,
      config: { model: "totally-not-real" },
    };
    const issues = runKindHealth(node);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe("fal_image_unknown_model");
  });

  it("returns no issues for a known model", () => {
    const node: NodeInstance = {
      id: "f1",
      kind: "fal-image",
      position: at,
      config: { model: "nano-banana-2" },
    };
    expect(runKindHealth(node)).toHaveLength(0);
  });

  it("does not crash on missing/empty model — defaults are fine", () => {
    const empty: NodeInstance = {
      id: "f1",
      kind: "fal-image",
      position: at,
      config: {},
    };
    const blank: NodeInstance = { ...empty, config: { model: "" } };
    expect(runKindHealth(empty)).toHaveLength(0);
    expect(runKindHealth(blank)).toHaveLength(0);
  });
});

describe("runKindHealth — llm-text", () => {
  it("flags a stale `userPorts` field", () => {
    const node: NodeInstance = {
      id: "l1",
      kind: "llm-text",
      position: at,
      config: { model: "anthropic/claude-sonnet-4.5", userPorts: 3 },
    };
    const issues = runKindHealth(node);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe("phantom_config_field");
    expect(issues[0]!.message).toMatch(/userPorts/);
  });

  it("returns no issues for a clean llm-text config", () => {
    const node: NodeInstance = {
      id: "l1",
      kind: "llm-text",
      position: at,
      config: { model: "anthropic/claude-sonnet-4.5", imagePorts: 2 },
    };
    expect(runKindHealth(node)).toHaveLength(0);
  });
});

describe("runKindHealth — unrecognized kinds", () => {
  it("returns an empty array for kinds without a registered checker", () => {
    const node: NodeInstance = {
      id: "x1",
      kind: "text",
      position: at,
      config: { text: "hi" },
    };
    expect(runKindHealth(node)).toEqual([]);
  });
});

describe("kindPitfalls", () => {
  it("returns the array pitfall mentioning delimiter vs separator", () => {
    const tips = kindPitfalls("array");
    expect(tips.length).toBeGreaterThan(0);
    expect(tips.join(" ")).toMatch(/delimiter/);
    expect(tips.join(" ")).toMatch(/separator/);
  });

  it("returns the fal-image pitfall mentioning the literal vs endpoint id", () => {
    const tips = kindPitfalls("fal-image");
    expect(tips.length).toBeGreaterThan(0);
    expect(tips.join(" ")).toMatch(/literal/);
    expect(tips.join(" ")).toMatch(/fal-ai/);
  });

  it("returns the llm-text pitfalls mentioning user single socket + auto-growing image", () => {
    const tips = kindPitfalls("llm-text");
    expect(tips.length).toBeGreaterThanOrEqual(2);
    const joined = tips.join(" ");
    expect(joined).toMatch(/Text Concat/);
    expect(joined).toMatch(/auto-grow/);
  });

  it("returns an empty array for kinds without recorded pitfalls", () => {
    expect(kindPitfalls("text")).toEqual([]);
    expect(kindPitfalls("totally-fake-kind")).toEqual([]);
  });
});
