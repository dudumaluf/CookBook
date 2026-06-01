import { beforeEach, describe, expect, it } from "vitest";

import {
  ASSISTANT_MODELS,
  DEFAULT_ASSISTANT_MODEL,
  isKnownModel,
  resolveModel,
} from "@/lib/assistant/models";
import {
  getActiveModel,
  useAssistantSettingsStore,
} from "@/lib/stores/assistant-settings-store";

beforeEach(() => {
  // Reset to default before every test so persisted state from a
  // prior test doesn't leak across cases.
  useAssistantSettingsStore.getState().reset();
  localStorage.clear();
});

describe("assistant-settings-store — Slice 0", () => {
  describe("models catalog", () => {
    it("ships at least 3 distinct providers", () => {
      const providers = new Set(ASSISTANT_MODELS.map((m) => m.provider));
      expect(providers.size).toBeGreaterThanOrEqual(3);
    });

    it("every curated entry has tools enabled (the reasoner requires it)", () => {
      for (const m of ASSISTANT_MODELS) {
        expect(m.tools).toBe(true);
      }
    });

    it("default model is the first curated entry", () => {
      expect(DEFAULT_ASSISTANT_MODEL).toBe(ASSISTANT_MODELS[0]?.id);
    });

    it("isKnownModel returns true for curated ids only", () => {
      expect(isKnownModel(ASSISTANT_MODELS[0]!.id)).toBe(true);
      expect(isKnownModel("openai/some-future-model")).toBe(false);
      expect(isKnownModel("")).toBe(false);
    });

    it("resolveModel returns the curated entry for known ids", () => {
      const sonnet = resolveModel("anthropic/claude-sonnet-4.5");
      expect(sonnet.label).toBe("Claude Sonnet 4.5");
      expect(sonnet.caching).toBe(true);
      expect(sonnet.tools).toBe(true);
    });

    it("resolveModel falls through to a permissive custom entry on unknown ids", () => {
      const custom = resolveModel("openai/some-future-model");
      expect(custom.id).toBe("openai/some-future-model");
      expect(custom.provider).toBe("custom");
      expect(custom.tools).toBe(true);
      expect(custom.caching).toBe(false);
    });

    it("resolveModel returns the default entry for empty / whitespace ids", () => {
      const empty = resolveModel("");
      expect(empty.id).toBe(DEFAULT_ASSISTANT_MODEL);
      const space = resolveModel("   ");
      expect(space.id).toBe(DEFAULT_ASSISTANT_MODEL);
    });
  });

  describe("settings store defaults", () => {
    it("starts with the default model", () => {
      expect(useAssistantSettingsStore.getState().model).toBe(
        DEFAULT_ASSISTANT_MODEL,
      );
    });

    it("getModel falls back to the default when persisted value is empty", () => {
      useAssistantSettingsStore.setState({ model: "" });
      expect(useAssistantSettingsStore.getState().getModel()).toBe(
        DEFAULT_ASSISTANT_MODEL,
      );
    });

    it("getModel returns the persisted value when it is non-empty", () => {
      useAssistantSettingsStore.setState({ model: "openai/gpt-5" });
      expect(useAssistantSettingsStore.getState().getModel()).toBe(
        "openai/gpt-5",
      );
    });
  });

  describe("setModel", () => {
    it("trims surrounding whitespace before storing", () => {
      useAssistantSettingsStore.getState().setModel("  openai/gpt-4o  ");
      expect(useAssistantSettingsStore.getState().model).toBe("openai/gpt-4o");
    });

    it("accepts a custom OpenRouter id verbatim (no provider gating)", () => {
      useAssistantSettingsStore.getState().setModel("vendor/some-model");
      expect(useAssistantSettingsStore.getState().model).toBe(
        "vendor/some-model",
      );
    });

    it("reset returns to the default", () => {
      useAssistantSettingsStore.getState().setModel("openai/gpt-4o");
      useAssistantSettingsStore.getState().reset();
      expect(useAssistantSettingsStore.getState().model).toBe(
        DEFAULT_ASSISTANT_MODEL,
      );
    });
  });

  describe("persistence", () => {
    it("writes the selected model to localStorage", async () => {
      useAssistantSettingsStore.getState().setModel("anthropic/claude-opus-4");
      // Persist middleware writes synchronously after `setState`.
      const raw = localStorage.getItem("cookbook.assistant-settings");
      expect(raw).toBeTruthy();
      const parsed = JSON.parse(raw!) as { state: { model: string } };
      expect(parsed.state.model).toBe("anthropic/claude-opus-4");
    });
  });

  describe("getActiveModel convenience", () => {
    it("returns the resolved metadata for the currently selected model", () => {
      useAssistantSettingsStore
        .getState()
        .setModel("google/gemini-2.5-flash");
      const active = getActiveModel();
      expect(active.id).toBe("google/gemini-2.5-flash");
      expect(active.tier).toBe("fast");
      expect(active.caching).toBe(true);
    });

    it("falls through to default metadata when model is empty", () => {
      useAssistantSettingsStore.setState({ model: "" });
      const active = getActiveModel();
      expect(active.id).toBe(DEFAULT_ASSISTANT_MODEL);
    });
  });
});
