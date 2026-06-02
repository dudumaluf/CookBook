"use client";

import { Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PROMPT_KEYS } from "@/lib/prompts/registry";
import { useLayoutStore } from "@/lib/stores/layout-store";
import { useHasPromptOverride } from "@/lib/stores/assistant-prompt-overrides-store";

/**
 * Cookbook Library Phase C — chat-sheet "Custom prompt" badge.
 *
 * Renders an emerald chip in the chat-sheet header when the active
 * user has an override on the assistant's reasoner instructions.
 * Click → opens the Library on the Prompts tab so the user can
 * review / edit / reset.
 *
 * Returns null when no override is active so the header stays clean
 * for the common case (default prompt). Mounted next to the role
 * picker + model selector so the user has a single "what's
 * configured for this conversation" zone.
 */
export function PromptOverrideBadge() {
  const hasOverride = useHasPromptOverride(PROMPT_KEYS.ASSISTANT_REASONER);
  const setCookbookOpen = useLayoutStore((s) => s.setCookbookOpen);
  const setCookbookTab = useLayoutStore((s) => s.setCookbookTab);

  if (!hasOverride) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setCookbookTab("prompts");
            setCookbookOpen(true);
          }}
          data-testid="chat-sheet-prompt-override-badge"
          className="h-6 gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 text-[10.5px] uppercase tracking-wider text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-400"
        >
          <Sparkles className="h-3 w-3" />
          Custom prompt
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p className="max-w-[260px] text-[11px] leading-relaxed">
          The assistant is running your custom version of the base operating
          instructions. Click to review or reset in the Library.
        </p>
      </TooltipContent>
    </Tooltip>
  );
}
