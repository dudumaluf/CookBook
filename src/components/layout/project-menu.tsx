"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  Download,
  FilePlus,
  FolderOpen,
  FolderInput,
  Package,
  Settings,
  Keyboard,
  ScrollText,
  Info,
  RotateCcw,
  ShieldCheck,
  LogOut,
} from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";

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
import { useSession } from "@/lib/auth/use-session";
import { emptyProjectDocument, serializeProject } from "@/lib/project/document";
import {
  exportProjectBundle,
  exportProjectJson,
  importProjectToCloud,
} from "@/lib/project/file";
import type { ProjectState } from "@/lib/repositories/project-repository";
import { getProjectRepository } from "@/lib/repositories/supabase-project-repository";
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
  const { user, signOut } = useSession();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file || !user) return;
    const toastId = toast.loading("Opening project file…");
    try {
      const id = await importProjectToCloud(file, user.id);
      toast.success("Project imported", { id: toastId });
      router.push(`/projetos/${id}`);
    } catch (err) {
      console.error("[project-menu] import failed:", err);
      toast.error("Could not open that file", { id: toastId });
    }
  }

  async function createProject() {
    if (!user) return;
    try {
      const rec = await getProjectRepository().save({
        ownerId: user.id,
        name: "Untitled Project",
        state: emptyProjectDocument(
          "Untitled Project",
        ) as unknown as ProjectState,
      });
      router.push(`/projetos/${rec.id}`);
    } catch (err) {
      console.error("[project-menu] create failed:", err);
      toast.error("Failed to create project");
    }
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".cookbook,.json,.zip,application/json,application/zip"
        className="hidden"
        onChange={(e) => void onPickFile(e)}
      />
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
          <DropdownMenuItem onClick={() => void createProject()}>
            <FilePlus className="h-3.5 w-3.5" />
            New project
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => router.push("/projetos")}>
            <FolderOpen className="h-3.5 w-3.5" />
            All projects…
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
            <FolderInput className="h-3.5 w-3.5" />
            Open file…
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => exportProjectJson(serializeProject())}>
            <Download className="h-3.5 w-3.5" />
            Export (.cookbook)
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              const id = toast.loading("Bundling project + media…");
              void exportProjectBundle(serializeProject())
                .then(() => toast.success("Exported with media", { id }))
                .catch((err) => {
                  console.error("[project-menu] bundle export failed:", err);
                  toast.error("Export failed", { id });
                });
            }}
          >
            <Package className="h-3.5 w-3.5" />
            Export with media (.zip)
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

        {user ? (
          <DropdownMenuGroup>
            <DropdownMenuLabel className="truncate text-[10.5px] font-normal text-muted-foreground/80">
              {user.email}
            </DropdownMenuLabel>
            <DropdownMenuItem
              data-testid="project-menu-signout"
              onClick={() => void signOut()}
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuGroup>
        ) : null}

        <DropdownMenuSeparator />

        <DropdownMenuItem disabled className="text-muted-foreground">
          <Info className="h-3.5 w-3.5" />
          About Cookbook
        </DropdownMenuItem>
      </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
