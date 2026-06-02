"use client";

import { ChevronDown, RotateCcw, Sparkles } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { defineNode } from "@/lib/engine/define-node";
import { extractInputByType } from "@/lib/engine/extract-input";
import { callOpenRouter } from "@/lib/llm/call-openrouter";
import { useExecutionStore } from "@/lib/stores/execution-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import { cn } from "@/lib/utils";
import type {
  ImageRef,
  NodeBodyProps,
  NodeIO,
  StandardizedOutput,
} from "@/types/node";

import { IteratorCursor } from "./iterator-cursor";
import { useNodeHistoryCursor } from "./use-node-history-cursor";

/**
 * LLM Text — Slice 3.2 (real Fal OpenRouter wiring, ADR-0024).
 *
 * Surface (ADR-0023 + ADR-0027):
 *   - Body: a tiny model picker chip at the top (always visible, no
 *     panel) + the output area below it. Output area renders the
 *     executed text on `done` / `cached`, or a one-line placeholder
 *     otherwise. Nothing else — no inline prompts, no settings sprawl.
 *   - Three input handles wired through external Text / Image nodes:
 *       • `user`   — text, single. The user prompt. Wire a single Text
 *         node (use Text Concat upstream if you want to combine many).
 *       • `system` — text, single.
 *       • `image-N` — image, auto-growing numbered sockets. The body
 *         monitors connected `image-N` edges and bumps the count to
 *         `connectedCount + 1` so there's always one empty trailing
 *         slot to wire next, capped by `MAX_IMAGE_PORTS`. When ≥1
 *         image is wired the server routes to `openrouter/router/vision`
 *         automatically.
 *   - Settings (temperature / max tokens / reasoning) live behind the
 *     standardized `⋯` trigger BaseNode renders in the top-right of the
 *     header (ADR-0027). This file owns the *content* of that popover
 *     (`SettingsContent`); the trigger + popover wrapper are BaseNode's
 *     responsibility so every settings-capable node parks the trigger
 *     in the same pixel-stable spot.
 *
 * Execution (Slice 3.2):
 *   - `execute()` calls `callOpenRouter()` which POSTs to
 *     `/api/fal/openrouter`. Server holds `FAL_KEY`, dispatches to the
 *     text or vision endpoint, returns `{ text, model, costUsd? }`.
 *   - The engine's hash-cache key already covers `config.model` +
 *     upstream-output hashes, so identical inputs hit the cache and
 *     never re-call Fal.
 *   - Cancellation is honored end-to-end: the engine's AbortSignal is
 *     forwarded through fetch; cancelled runs reject with `AbortError`
 *     and the node settles into `cancelled` status.
 */
export interface LLMTextNodeConfig {
  /**
   * Fal forwards any OpenRouter model id. Default matches the Prism env
   * default so behaviour is predictable. Override via the in-node chip.
   */
  model: string;
  /**
   * Sampling temperature. Omitted ⇒ provider default. Range 0–2 enforced
   * by the server's Zod schema; the settings popover steps in 0.1 increments.
   */
  temperature?: number;
  /**
   * Max output tokens. Omitted ⇒ provider default. Integer > 0; the popover
   * uses a `number` input with min=1.
   */
  maxTokens?: number;
  /**
   * Whether to enable the model's chain-of-thought reasoning. Required by
   * a handful of Fal-router models (Gemini 2.5 Pro as of Slice 3.4). Most
   * other models work either way — leaving this `undefined` defers to the
   * provider default.
   */
  reasoning?: boolean;
  /**
   * Image port count (auto-grow). The body bumps this to `connectedCount
   * + 1` so the user always has one empty trailing image socket to wire
   * next, capped by `MAX_IMAGE_PORTS`. Schema-default is `1` (one empty
   * image socket).
   *
   * `user` and `system` stay single ports — combining many user prompts
   * is what the Text Concat node is for.
   */
  imagePorts?: number;
}

/**
 * Cap for the smart-input image pattern. Nine images mirrors the
 * Seedance reference cap (and Anthropic / OpenAI vision payloads handle
 * that many fine); stops the node from growing into a forest if the user
 * wires every image output on the canvas.
 */
export const MAX_IMAGE_PORTS = 9;

/**
 * Build the dynamic input list. `user` and `system` are single sockets;
 * only the image slots auto-grow. Order matches the visual stack:
 * user → system → image-0..N.
 */
function smartInputs(config: LLMTextNodeConfig): NodeIO[] {
  const imageN = Math.min(MAX_IMAGE_PORTS, Math.max(1, config.imagePorts ?? 1));
  const inputs: NodeIO[] = [
    { id: "user", label: "user", dataType: "text" },
    { id: "system", label: "system", dataType: "text" },
  ];
  for (let i = 0; i < imageN; i++) {
    inputs.push({
      id: `image-${i}`,
      label: `image ${i + 1}`,
      dataType: "image",
    });
  }
  return inputs;
}

/**
 * Curated list of OpenRouter model ids that Fal's OpenAI-compat router
 * actively routes today. Order = priority (the most commonly useful pick
 * first). Custom ids still round-trip via the dropdown's "(custom)" row.
 *
 * 2026-06-02 refresh — OpenRouter migrated Anthropic ids from hyphen to
 * dot notation around April 2026 (`claude-opus-4-1` → `claude-opus-4.6`).
 * The old hyphen-suffixed ids now return "not a valid model ID" errors
 * upstream, surfacing as `fal-openai-compat HTTP 404` in the node body.
 * The list below tracks Fal's published example set
 * (https://fal.ai/models/openrouter/router) plus the OpenAI / Google /
 * xAI ids known to be live on OpenRouter as of this date.
 *
 * `google/gemini-2.5-pro` keeps `reasoningRequired: true` because Fal
 * rejects it without `reasoning: true` in the body; the settings popover
 * surfaces a hint when the user has Pro selected but reasoning unchecked
 * so the run doesn't fail mid-flight with "Reasoning is mandatory".
 */
const MODEL_OPTIONS: Array<{
  id: string;
  label: string;
  reasoningRequired?: boolean;
}> = [
  // Anthropic — flagship + fallbacks. 4.6 is the current dot-notation
  // generation (Sonnet 4.6 + Opus 4.6); 4.5 stays as a known-good
  // fallback. The hyphen-notation 4.1 ids were retired upstream.
  { id: "anthropic/claude-sonnet-4.6", label: "Claude Sonnet 4.6" },
  { id: "anthropic/claude-opus-4.6", label: "Claude Opus 4.6" },
  { id: "anthropic/claude-sonnet-4.5", label: "Claude Sonnet 4.5" },
  { id: "anthropic/claude-haiku-4.5", label: "Claude Haiku 4.5 (cheap)" },
  // OpenAI
  { id: "openai/gpt-5", label: "GPT-5" },
  { id: "openai/gpt-5-mini", label: "GPT-5 mini" },
  { id: "openai/gpt-4.1", label: "GPT-4.1" },
  // Google
  {
    id: "google/gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    reasoningRequired: true,
  },
  { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  // xAI — Fal's published example list shows Grok 4 Fast as the
  // currently routable id (the bare `x-ai/grok-4` is intermittently
  // missing).
  { id: "x-ai/grok-4-fast", label: "Grok 4 Fast" },
  // Open-source / value-tier
  { id: "meta-llama/llama-4-maverick", label: "Llama 4 Maverick" },
  { id: "moonshotai/kimi-k2.5", label: "Kimi K2.5" },
];

/**
 * Whether the given model id is in our curated reasoning-required set.
 * Conservative — only the models we've actually observed rejecting calls
 * without `reasoning: true` are flagged.
 */
function modelRequiresReasoning(modelId: string): boolean {
  return MODEL_OPTIONS.some(
    (m) => m.id === modelId && m.reasoningRequired === true,
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Body — model chip + output                                                 */
/* ────────────────────────────────────────────────────────────────────────── */

function LLMTextNodeBody({
  nodeId,
  config,
  updateConfig,
}: NodeBodyProps<LLMTextNodeConfig>) {
  // Subscribe to just this node's record so unrelated runs don't re-render.
  const record = useExecutionStore((s) => s.records.get(nodeId));
  const history = record?.history ?? [];

  // Auto-grow image smart-input sockets. Track the highest connected
  // `image-N` index as a STABLE primitive so the workflow selector's
  // equality check stays stable (returning a fresh object would loop,
  // React #185). Then keep one empty trailing socket up to `MAX_IMAGE_PORTS`
  // so the user always has somewhere to wire the next image. `user` and
  // `system` are single sockets and don't auto-grow.
  const connectedImageMax = useWorkflowStore((s) => {
    let max = -1;
    for (const e of s.edges) {
      if (e.target !== nodeId || !e.targetHandle) continue;
      if (e.targetHandle.startsWith("image-")) {
        const idx = Number(e.targetHandle.slice("image-".length));
        if (Number.isFinite(idx)) max = Math.max(max, idx);
      }
    }
    return max;
  });
  useEffect(() => {
    const wantImagePorts = Math.min(
      MAX_IMAGE_PORTS,
      Math.max(1, connectedImageMax + 2),
    );
    const haveImagePorts = Math.min(
      MAX_IMAGE_PORTS,
      Math.max(1, config.imagePorts ?? 1),
    );
    if (haveImagePorts !== wantImagePorts) {
      updateConfig({ imagePorts: wantImagePorts });
    }
  }, [connectedImageMax, config.imagePorts, updateConfig]);

  // Slice 5.8 — history cursor (view-only). Defaults to the latest
  // entry; user navigates with the cursor chip below the model chip.
  const { cursor, setCursor } = useNodeHistoryCursor(nodeId, history.length);

  const activeOutput =
    history.length > 0
      ? history[cursor]?.output
      : record?.output;

  const output =
    record?.status === "done" || record?.status === "cached"
      ? recordTextOutput(activeOutput)
      : null;
  const errorMessage =
    record?.status === "error" && record.error ? record.error : null;

  return (
    // `flex-1 min-h-0` so the body fills the card when the user has
    // resized it (BaseNode wraps us in a `flex-1` slot when height is
    // explicit — ADR-0028). Without `min-h-0` the scrollable output
    // wouldn't actually scroll; it would just push the card taller.
    <div className="flex w-full min-w-[260px] flex-1 flex-col gap-1.5 overflow-hidden px-3 py-1.5">
      <ModelChip config={config} updateConfig={updateConfig} />

      {/* Slice 5.8 — history cursor (view-only). Hidden until there's
          something to navigate (2+ past responses). */}
      {history.length > 1 ? (
        <div
          data-testid="llm-text-history-cursor"
          className="flex items-center justify-between gap-2 text-[10.5px] text-muted-foreground"
        >
          <IteratorCursor
            count={history.length}
            cursor={cursor}
            onCursorChange={setCursor}
            ariaLabelPrefix="Response"
          />
          <span className="text-muted-foreground/60">past responses</span>
        </div>
      ) : null}

      {output !== null ? (
        // Output rendered as the primary content. `flex-1 min-h-0
        // overflow-y-auto` makes the output area the scrollable region
        // inside the card so a long LLM response can't stretch the
        // silhouette past the schema's `maxHeight` (ADR-0028). The card
        // stays compact; the *user* decides when to drag-resize bigger.
        // `nowheel` lets the canvas keep zooming when the cursor is over
        // the panel but inside-panel wheel events still scroll the text.
        <div
          className="nowheel flex-1 overflow-y-auto rounded-md bg-foreground/5"
          // Don't let inner-scroll wheel events bubble up into React
          // Flow's pan/zoom — without this, scrolling a long response
          // zooms the canvas instead of scrolling the text.
          onWheelCapture={(e) => e.stopPropagation()}
        >
          <p className="select-text whitespace-pre-wrap break-words px-2.5 py-2 text-[12px] leading-relaxed text-foreground/90">
            {output}
          </p>
        </div>
      ) : errorMessage !== null ? (
        // Errored runs render the message inline rather than only via the
        // status-chip tooltip — the chip is 12 px and easy to miss, and
        // hovering "to find out what went wrong" is friction the user
        // shouldn't pay. Destructive tint keeps the semantic obvious;
        // selectable so it can be copy-pasted into a bug report.
        <div
          role="alert"
          className="nowheel flex-1 overflow-y-auto rounded-md bg-destructive/10"
          onWheelCapture={(e) => e.stopPropagation()}
        >
          <p className="select-text whitespace-pre-wrap break-words px-2.5 py-2 text-[11.5px] leading-relaxed text-destructive">
            {errorMessage}
          </p>
        </div>
      ) : (
        // Idle / pending / running / cancelled placeholder.
        <p className="text-[11.5px] leading-relaxed text-muted-foreground/80">
          Connect <span className="text-foreground/75">user</span> on the left
          then click{" "}
          <span className="rounded bg-foreground/5 px-1 py-0.5 font-mono text-[10.5px] text-foreground/70">
            Run
          </span>
          .
        </p>
      )}
    </div>
  );
}

/**
 * Compact model picker — a native `<select>` styled as a tiny pill chip
 * so it reads as "the only knob on this node" without a panel. Always
 * visible (idle + post-run) so changing the model and re-running stays
 * one click away no matter the node state.
 *
 * Why native: zero async lifecycle, opens instantly, OS-native dropdown
 * polish for free, and the `<option>` list serializes any custom config
 * id with a "(custom)" suffix without us having to maintain a separate
 * "show typed value" branch.
 */
function ModelChip({
  config,
  updateConfig,
}: {
  config: LLMTextNodeConfig;
  updateConfig: (partial: Partial<LLMTextNodeConfig>) => void;
}) {
  const isCustomModel = !MODEL_OPTIONS.some((m) => m.id === config.model);
  const currentLabel =
    MODEL_OPTIONS.find((m) => m.id === config.model)?.label ?? config.model;

  return (
    <label className="relative inline-flex cursor-pointer items-center self-start rounded-md bg-foreground/[0.06] px-2 py-1 transition-colors hover:bg-foreground/[0.09]">
      <span className="sr-only">Model</span>
      {/*
       * Native select sits invisibly on top of the visible label so the
       * OS-native popup positions correctly relative to the visible
       * trigger. Click-anywhere-on-the-chip opens the picker.
       */}
      <select
        value={config.model}
        onChange={(e) => updateConfig({ model: e.target.value })}
        aria-label="Model"
        // Native <select> wants opt-out from React Flow drag/pan.
        onPointerDown={(e) => e.stopPropagation()}
        className="absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent text-transparent outline-none"
      >
        {MODEL_OPTIONS.map((m) => (
          <option key={m.id} value={m.id} className="bg-popover text-foreground">
            {m.label} · {m.id}
          </option>
        ))}
        {isCustomModel && (
          <option value={config.model} className="bg-popover text-foreground">
            {config.model} (custom)
          </option>
        )}
      </select>
      <span className="pointer-events-none flex items-center gap-1 text-[10.5px] font-medium text-foreground/85">
        {currentLabel}
        <ChevronDown className="h-3 w-3 text-muted-foreground/70" />
      </span>
    </label>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Settings popover content (temperature / max tokens / reasoning)            */
/*                                                                            */
/* The standardized `⋯` trigger + popover wrapper live on BaseNode            */
/* (ADR-0027). This file only ships the popover *content* — three             */
/* controls + an `hasOverrides` predicate the schema points at so the         */
/* trigger's accent dot reflects "this node has non-default settings."        */
/* ────────────────────────────────────────────────────────────────────────── */

/** Drives the accent dot on the BaseNode settings trigger. */
function hasSettingsOverrides(config: LLMTextNodeConfig): boolean {
  return (
    config.temperature !== undefined ||
    config.maxTokens !== undefined ||
    config.reasoning === true
  );
}

export function LLMTextSettingsContent({
  config,
  updateConfig,
}: NodeBodyProps<LLMTextNodeConfig>) {
  const tempInputId = useId();
  const maxTokensId = useId();
  const reasoningId = useId();

  const tempIsExplicit = config.temperature !== undefined;
  // When undefined we still need a value for the slider thumb — pick 0.7
  // as a sensible centre so the slider doesn't slam to 0 if the user
  // grabs it for the first time.
  const tempDisplayValue = config.temperature ?? 0.7;

  // Surface a hint when the model requires reasoning but the user hasn't
  // ticked the checkbox. The call would fail mid-run otherwise; the user
  // would see the "Reasoning is mandatory" error in the queue and have
  // to back-track. We catch it at config time.
  const showReasoningHint =
    modelRequiresReasoning(config.model) && config.reasoning !== true;

  return (
    <div className="flex flex-col gap-3.5 text-xs">
      {/* Temperature ------------------------------------------------- */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label htmlFor={tempInputId} className="font-medium text-foreground/90">
            Temperature
          </label>
          <span className="font-mono text-[11px] text-muted-foreground">
            {tempIsExplicit ? tempDisplayValue.toFixed(1) : "default"}
          </span>
        </div>
        <input
          id={tempInputId}
          type="range"
          min={0}
          max={2}
          step={0.1}
          value={tempDisplayValue}
          onChange={(e) => updateConfig({ temperature: Number(e.target.value) })}
          // While the slider is at default, render it muted so it reads
          // as "not set" — the explicit-vs-default distinction matters
          // (provider default differs per model).
          className={cn(
            "w-full accent-accent",
            !tempIsExplicit && "opacity-50",
          )}
        />
        {tempIsExplicit && (
          <button
            type="button"
            onClick={() => updateConfig({ temperature: undefined })}
            className="inline-flex w-fit items-center gap-1 self-start text-[10.5px] text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="h-2.5 w-2.5" /> Reset to default
          </button>
        )}
      </div>

      {/* Max tokens ------------------------------------------------- */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label htmlFor={maxTokensId} className="font-medium text-foreground/90">
            Max output tokens
          </label>
          {config.maxTokens !== undefined && (
            <button
              type="button"
              onClick={() => updateConfig({ maxTokens: undefined })}
              className="inline-flex items-center gap-1 text-[10.5px] text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="h-2.5 w-2.5" /> Reset
            </button>
          )}
        </div>
        {/*
         * `key` on the input forces a fresh DOM node whenever the config
         * value resets externally (Reset button), wiping any in-progress
         * keystroke draft without us having to roll our own sync effect
         * — React 19 strict-mode forbids setState in effects, which the
         * naive sync would do.
         */}
        <MaxTokensInput
          key={config.maxTokens ?? "default"}
          id={maxTokensId}
          initialValue={config.maxTokens}
          onChange={(next) => updateConfig({ maxTokens: next })}
        />
      </div>

      {/* Reasoning -------------------------------------------------- */}
      <div className="flex flex-col gap-1">
        <label
          htmlFor={reasoningId}
          className="flex cursor-pointer items-center gap-2"
        >
          <input
            id={reasoningId}
            type="checkbox"
            checked={config.reasoning === true}
            onChange={(e) =>
              updateConfig({
                reasoning: e.target.checked ? true : undefined,
              })
            }
            className="h-3.5 w-3.5 cursor-pointer accent-accent"
          />
          <span className="font-medium text-foreground/90">Reasoning</span>
        </label>
        {showReasoningHint ? (
          <p className="text-[10.5px] leading-relaxed text-accent">
            This model requires reasoning to be on. Tick the box or the run
            will fail.
          </p>
        ) : (
          <p className="text-[10.5px] leading-relaxed text-muted-foreground/80">
            Enable for models that need explicit reasoning (Gemini 2.5 Pro,
            o-series). Adds cost.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Local-state number input for max tokens. Keeps the typed string in
 * component-local state so partial digits aren't lost between keystrokes;
 * commits to the parent on every change that parses to a positive integer
 * (or on empty → undefined). Invalid intermediate strings (e.g. "0", "1.5")
 * stay in the visible draft but are not committed — the parent keeps its
 * last valid value until the input lands on something parseable.
 *
 * External resets are handled by the parent passing a fresh `key` so the
 * component remounts with the new `initialValue`; we never need a sync
 * effect (which React 19 forbids in strict mode).
 */
function MaxTokensInput({
  id,
  initialValue,
  onChange,
}: {
  id: string;
  initialValue: number | undefined;
  onChange: (next: number | undefined) => void;
}) {
  const [draft, setDraft] = useState(() =>
    initialValue !== undefined ? String(initialValue) : "",
  );

  return (
    <input
      id={id}
      type="number"
      min={1}
      step={1}
      placeholder="Provider default"
      value={draft}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        if (raw === "") {
          onChange(undefined);
          return;
        }
        const parsed = Number(raw);
        if (Number.isInteger(parsed) && parsed >= 1) onChange(parsed);
      }}
      className="h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-border focus:outline-none"
    />
  );
}

function recordTextOutput(
  output: StandardizedOutput | StandardizedOutput[] | undefined,
): string | null {
  if (!output) return null;
  const value = Array.isArray(output) ? output[0] : output;
  if (!value || value.type !== "text") return null;
  return value.value;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Schema                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

export const llmTextNodeSchema = defineNode<LLMTextNodeConfig>({
  kind: "llm-text",
  category: "ai-text",
  title: "LLM Text",
  description:
    "Send prompts (and optional images) to an LLM via Fal OpenRouter. Wire upstream Text / Image nodes; pick the model from the chip on the node.",
  icon: Sparkles,
  // Static inputs cover the initial port counts (one user + one image) so
  // a fresh node renders with `user 1` / `system` / `image 1`. The dynamic
  // shape — and its auto-grow bookkeeping — lives on `getInputs` / the
  // body's connect-watching effect.
  inputs: smartInputs({ model: "" }),
  getInputs: (config) => smartInputs(config),
  outputs: [{ id: "out", label: "out", dataType: "text" }],
  defaultConfig: {
    model: "anthropic/claude-sonnet-4.6",
  },
  // Executable (not reactive) — only runs when the user clicks Run.
  reactive: false,
  execute: async ({ config, inputs, signal }) => {
    // user / system: single text inputs. The original multi-edge
    // concatenation lived in this node before the smart-input rollback
    // — it's now Text Concat's job upstream if the user wants to combine
    // multiple text sources into one prompt.
    const user = (
      extractInputByType(inputs, "user", "text") ?? ""
    ).trim();
    const system = (
      extractInputByType(inputs, "system", "text") ?? ""
    ).trim();

    // image-0..N: collect each wired image in port order. The server
    // routes to the vision endpoint automatically when ≥1 image is
    // present; we just hand it an ordered URL list.
    const imageRefs: ImageRef[] = [];
    for (let i = 0; i < MAX_IMAGE_PORTS; i++) {
      const ref = extractInputByType(inputs, `image-${i}`, "image");
      if (ref) imageRefs.push(ref);
    }

    if (user.length === 0) {
      throw new Error(
        "User prompt is empty — wire a Text node into the `user` socket.",
      );
    }

    const result = await callOpenRouter({
      model: config.model,
      user,
      system: system.length > 0 ? system : undefined,
      // Server picks vision endpoint when images are present. Only the
      // URL travels over the wire; the engine already verified the
      // upstream Image node is a valid `image` output.
      images:
        imageRefs.length > 0 ? imageRefs.map((r) => r.url) : undefined,
      // Optional generation settings. Undefined values are stripped by the
      // client wrapper before POST so the server's Zod schema sees them
      // as absent, deferring to provider defaults.
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      reasoning: config.reasoning,
      signal,
    });

    // Rich return shape: the runner extracts `usage` into ExecutionRecord
    // so the Queue panel can surface cost / tokens / actual model without
    // each node hand-rolling its own side channel. The `model` echoed
    // back may differ from `config.model` if Fal re-routed.
    return {
      output: { type: "text", value: result.text },
      usage: {
        costUsd: result.costUsd,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        model: result.model,
      },
    };
  },
  Body: LLMTextNodeBody,
  // The standardized `⋯` trigger in BaseNode's header (ADR-0027) opens a
  // popover with this content. `hasOverrides` lights the accent dot when
  // any of the three optional knobs are set so users see "this node has
  // overrides" at a glance without opening the popover.
  settings: {
    Content: LLMTextSettingsContent,
    hasOverrides: hasSettingsOverrides,
  },
  // Size contract (ADR-0028). `defaultWidth: 380` so a fresh node reads
  // like a comfortable text card from drop-in, *not* like a tiny chip; the
  // body's `flex-1 overflow-y-auto` keeps the silhouette honest when a
  // multi-paragraph response lands (no more 5,000-px-wide canvas blowouts
  // like in the user's screenshot pre-ADR-0028). `defaultHeight` stays
  // undefined so an empty / short-output node still hugs the model chip
  // tightly. `maxHeight: 520` caps the height after which the output
  // starts scrolling; `resizable: "both"` opts in to the standardized
  // bottom-right drag handle so the user can pop the card open for a
  // long response without scrolling.
  size: {
    defaultWidth: 380,
    minWidth: 280,
    maxWidth: 720,
    minHeight: 100,
    maxHeight: 520,
    resizable: "both",
  },
});
