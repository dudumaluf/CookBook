"use client";

import { Check, ChevronDown, Sparkles, Wrench, Zap } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ASSISTANT_MODELS,
  resolveModel,
  type AssistantModel,
} from "@/lib/assistant/models";
import { useAssistantSettingsStore } from "@/lib/stores/assistant-settings-store";
import { cn } from "@/lib/utils";

/**
 * ModelSelector — Slice 0 of "Smarter assistant".
 *
 * Compact dropdown that lets the user pick which LLM drives the
 * assistant. Mounted in the chat-sheet header.
 *
 * Trigger: pill showing the active model's label + tier badge color +
 * chevron. Roughly 140px wide; designed to fit next to the existing
 * Clear / Close buttons inside the 640px chat sheet.
 *
 * Menu: one row per curated model with label, tier badge, cost hint
 * dots, and capability dots (`tools`, `cache`). Selected row gets a
 * check. Footer entry "Custom OpenRouter ID..." reveals an inline
 * input that accepts any `provider/model-name` and applies it on
 * Enter (capabilities default to permissive — see `resolveModel`).
 *
 * Persistence is via `useAssistantSettingsStore`; the store handles
 * localStorage. Model id flows into `runReasoner` via `prompt-bar`
 * (Slice 0 step 5).
 */

const TIER_BADGE_CLASS: Record<AssistantModel["tier"], string> = {
  fast: "bg-emerald-500/15 text-emerald-500/90",
  balanced: "bg-sky-500/15 text-sky-500/90",
  premium: "bg-violet-500/15 text-violet-500/90",
};

const TIER_LABEL: Record<AssistantModel["tier"], string> = {
  fast: "fast",
  balanced: "balanced",
  premium: "premium",
};

export function ModelSelector() {
  const modelId = useAssistantSettingsStore((s) => s.model);
  const setModel = useAssistantSettingsStore((s) => s.setModel);
  const active = resolveModel(modelId);
  const [open, setOpen] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [customValue, setCustomValue] = useState("");

  function pick(id: string) {
    setModel(id);
    setOpen(false);
    setCustomMode(false);
    setCustomValue("");
  }

  function applyCustom() {
    const next = customValue.trim();
    if (!next) return;
    pick(next);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setCustomMode(false);
          setCustomValue("");
        }
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 max-w-[180px] gap-1 px-2 text-[11px] font-normal text-foreground/85"
              data-testid="model-selector-trigger"
              aria-label={`Assistant model: ${active.label}`}
            >
              <span
                aria-hidden
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  TIER_BADGE_CLASS[active.tier].split(" ")[0],
                )}
              />
              <span className="truncate">{active.label}</span>
              <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground/70" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">
          Assistant model — click to switch
        </TooltipContent>
      </Tooltip>

      <PopoverContent
        align="end"
        className="w-72 p-1"
        data-testid="model-selector-popover"
      >
        <div className="px-2 pb-1 pt-1.5">
          <p className="text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground/70">
            Assistant model
          </p>
        </div>
        <ul className="flex flex-col gap-px">
          {ASSISTANT_MODELS.map((m) => {
            const selected = m.id === active.id;
            return (
              <li key={m.id}>
                <button
                  type="button"
                  data-testid={`model-option-${m.id}`}
                  data-selected={selected ? "true" : "false"}
                  onClick={() => pick(m.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-foreground/[0.06]",
                    selected ? "bg-foreground/[0.04]" : "",
                  )}
                >
                  <Check
                    aria-hidden
                    className={cn(
                      "h-3 w-3 shrink-0",
                      selected
                        ? "text-foreground/80"
                        : "text-transparent",
                    )}
                  />
                  <span className="flex-1 truncate text-foreground/90">
                    {m.label}
                  </span>
                  <span
                    className={cn(
                      "rounded-md px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-wide",
                      TIER_BADGE_CLASS[m.tier],
                    )}
                  >
                    {TIER_LABEL[m.tier]}
                  </span>
                  <span
                    aria-label={`Cost: ${m.costHint}`}
                    className="font-mono text-[10px] text-muted-foreground/80"
                  >
                    {m.costHint}
                  </span>
                  <span className="flex items-center gap-0.5">
                    {m.tools ? (
                      <Wrench
                        aria-label="supports tools"
                        className="h-2.5 w-2.5 text-muted-foreground/60"
                      />
                    ) : null}
                    {m.caching ? (
                      <Zap
                        aria-label="supports prompt caching"
                        className="h-2.5 w-2.5 text-amber-500/70"
                      />
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="mt-1 border-t border-border/50 pt-1">
          {customMode ? (
            <div className="flex items-center gap-1 px-1.5 py-1">
              <Sparkles
                aria-hidden
                className="h-3 w-3 shrink-0 text-muted-foreground/70"
              />
              <Input
                autoFocus
                value={customValue}
                placeholder="provider/model-name"
                onChange={(e) => setCustomValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    applyCustom();
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setCustomMode(false);
                    setCustomValue("");
                  }
                }}
                data-testid="model-selector-custom-input"
                className="h-6 px-1.5 text-[11px]"
              />
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[10.5px]"
                onClick={applyCustom}
                disabled={!customValue.trim()}
                data-testid="model-selector-custom-apply"
              >
                Use
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setCustomMode(true);
                setCustomValue(
                  ASSISTANT_MODELS.some((m) => m.id === modelId) ? "" : modelId,
                );
              }}
              data-testid="model-selector-custom-button"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground/85"
            >
              <Sparkles className="h-3 w-3 shrink-0" />
              <span>Custom OpenRouter ID...</span>
              {active.provider === "custom" ? (
                <span className="ml-auto truncate text-[10px] text-foreground/60">
                  {active.id}
                </span>
              ) : null}
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
