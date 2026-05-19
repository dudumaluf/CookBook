"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  FilePlus,
  FolderOpen,
  Settings,
  Keyboard,
  ScrollText,
  Info,
} from "lucide-react";

import {
  DropdownMenu,
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
 * Top-left cluster: company logo + chevron triggering a dropdown for
 * project-level actions. Day 1: the destinations are stubs (most land in
 * M0a/d). The shortcuts are wired so muscle memory builds before the panels
 * exist.
 */
export function ProjectMenu() {
  const router = useRouter();
  const { setLogsPanelOpen, setCommandPaletteOpen } = useLayoutStore();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Project menu"
        className="inline-flex h-8 items-center gap-1 rounded-full pl-0.5 pr-1.5 transition-colors hover:bg-muted/40 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
      >
        <span className="relative inline-flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-foreground">
          <Image
            src="/logo.png"
            alt="Brand logo"
            width={28}
            height={28}
            priority
            className="object-cover"
          />
        </span>
        <ChevronDown className="h-3 w-3 text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" sideOffset={8} className="w-56">
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

        <DropdownMenuItem
          onClick={() => router.refresh()}
          className="text-muted-foreground"
        >
          <Info className="h-3.5 w-3.5" />
          About Cookbook
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
