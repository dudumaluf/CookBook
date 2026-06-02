"use client";

import { Check, ChevronDown, UserCog } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
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
import { ROLES } from "@/lib/assistant/roles";
import { useAssistantRoleStore } from "@/lib/stores/assistant-role-store";
import { cn } from "@/lib/utils";

/**
 * RolePicker — Cookbook Library Phase D1 (ADR-0061).
 *
 * Compact dropdown that lets the user pick the assistant's role. Lives
 * in the chat-sheet header next to the ModelSelector. The choice
 * persists in localStorage via `useAssistantRoleStore` and is read on
 * each `runReasoner` call so the next turn picks up the active
 * overlay.
 *
 * Design parity: trigger pill styled like ModelSelector — ~h-6,
 * text-[11px], rounded-md, ghost button — so the two pickers read as
 * a pair. Active role label shows in the trigger; the popover lists
 * every role with a one-line description and a check-mark on the
 * active one.
 *
 * General role gets a subdued "Default" label color in the popover so
 * it's visually distinct from specialists (signals "this turns off
 * specialization").
 */
export function RolePicker() {
  const roleId = useAssistantRoleStore((s) => s.roleId);
  const setRoleId = useAssistantRoleStore((s) => s.setRoleId);
  const [open, setOpen] = useState(false);
  const active = ROLES.find((r) => r.id === roleId) ?? ROLES[0]!;

  function pick(id: string) {
    setRoleId(id);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 max-w-[200px] gap-1 px-2 text-[11px] font-normal text-foreground/85"
              data-testid="role-picker-trigger"
              aria-label={`Assistant role: ${active.label}`}
            >
              <UserCog
                aria-hidden
                className="h-3 w-3 shrink-0 text-muted-foreground/80"
              />
              <span className="truncate">{active.label}</span>
              <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground/70" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">
          Assistant role — specializes the system prompt
        </TooltipContent>
      </Tooltip>

      <PopoverContent
        align="end"
        className="w-80 p-1"
        data-testid="role-picker-popover"
      >
        <div className="px-2 pb-1 pt-1.5">
          <p className="text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground/70">
            Assistant role
          </p>
        </div>
        <ul className="flex flex-col gap-px">
          {ROLES.map((r) => {
            const selected = r.id === active.id;
            const isDefault = r.id === "general";
            return (
              <li key={r.id}>
                <button
                  type="button"
                  data-testid={`role-option-${r.id}`}
                  data-selected={selected ? "true" : "false"}
                  onClick={() => pick(r.id)}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-foreground/[0.06]",
                    selected ? "bg-foreground/[0.04]" : "",
                  )}
                >
                  <Check
                    aria-hidden
                    className={cn(
                      "mt-0.5 h-3 w-3 shrink-0",
                      selected ? "text-foreground/80" : "text-transparent",
                    )}
                  />
                  <span className="flex flex-1 flex-col gap-0.5">
                    <span
                      className={cn(
                        "text-xs font-medium",
                        isDefault
                          ? "text-foreground/75"
                          : "text-foreground/95",
                      )}
                    >
                      {r.label}
                    </span>
                    <span className="text-[10.5px] leading-snug text-muted-foreground">
                      {r.description}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
