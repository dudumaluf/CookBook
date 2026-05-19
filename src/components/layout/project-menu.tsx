"use client";

import Image from "next/image";
import {
  ChevronDown,
  FilePlus,
  FolderOpen,
  Settings,
  Keyboard,
  ScrollText,
  Info,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLayoutStore } from "@/lib/stores/layout-store";

/**
 * ProjectMenu
 *
 * Floating top-left: bigger circular logo + small chevron. Click opens a
 * DropdownMenu with everything that used to clutter the top bar:
 *
 * - Project actions (New / Open recent — stubs until M0d)
 * - Workspace (Command palette, Show logs, Settings)
 * - Approval gate (checkbox — the user is in control of run friction)
 * - Reset workflow (M0a — currently disabled)
 * - About
 *
 * Removing the top bar entirely (ADR-0013) means there is no chrome strip
 * to look at: the canvas breathes edge-to-edge and the logo becomes one of
 * the floating overlays.
 */
export function ProjectMenu() {
  const {
    setLogsPanelOpen,
    setCommandPaletteOpen,
    approvalGateOn,
    setApprovalGate,
  } = useLayoutStore();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Project menu"
        className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-popover/95 p-1 pl-1 pr-2 shadow-lg shadow-black/30 backdrop-blur-md transition-colors hover:bg-popover focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
      >
        <span className="relative inline-flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-foreground">
          <Image
            src="/logo.png"
            alt="Brand logo"
            width={32}
            height={32}
            priority
            className="object-cover"
          />
        </span>
        <ChevronDown className="h-3 w-3 text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" sideOffset={8} className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Project</DropdownMenuLabel>
          <DropdownMenuItem disabled>
            <FilePlus className="h-3.5 w-3.5" />
            New project
          </DropdownMenuItem>
          <DropdownMenuItem disabled>
            <FolderOpen className="h-3.5 w-3.5" />
            Open recent…
          </DropdownMenuItem>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <DropdownMenuGroup>
          <DropdownMenuLabel>Workflow</DropdownMenuLabel>
          <DropdownMenuCheckboxItem
            checked={approvalGateOn}
            onCheckedChange={(checked) => setApprovalGate(Boolean(checked))}
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            Approval gate
          </DropdownMenuCheckboxItem>
          <DropdownMenuItem disabled>
            <RotateCcw className="h-3.5 w-3.5" />
            Reset workflow
          </DropdownMenuItem>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <DropdownMenuGroup>
          <DropdownMenuLabel>Workspace</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => setCommandPaletteOpen(true)}>
            <Keyboard className="h-3.5 w-3.5" />
            Command palette
            <DropdownMenuShortcut>⌘K</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setLogsPanelOpen(true)}>
            <ScrollText className="h-3.5 w-3.5" />
            Show logs
            <DropdownMenuShortcut>⌘⇧L</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem disabled>
            <Settings className="h-3.5 w-3.5" />
            Settings
          </DropdownMenuItem>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <DropdownMenuItem disabled className="text-muted-foreground">
          <Info className="h-3.5 w-3.5" />
          About Cookbook
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
