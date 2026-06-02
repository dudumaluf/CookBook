"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { CanvasArea } from "./canvas-area";
import { LibraryPanel } from "./library-panel";
import { QueuePanel } from "./queue-panel";
import { PromptBar } from "./prompt-bar";
import { AddNodeButton } from "./add-node-button";
import { CookbookButton } from "./cookbook-button";
import { GalleryButton } from "./gallery-button";
import { RunButton } from "./run-button";
import { CommandPalette } from "./command-palette";
import { LogsPanel } from "./logs-panel";
import { GalleryDrawer } from "./gallery-drawer";
import { LibraryDrawer } from "./library-drawer";
import { ProjectMenu } from "./project-menu";
import { EditableTitle } from "./editable-title";
import { SaveIndicator } from "./save-indicator";
import { CookbookOverlay } from "@/components/cookbook/cookbook-overlay";
import { useSession } from "@/lib/auth/use-session";
import { useLayoutShortcuts } from "@/lib/hooks/use-layout-shortcuts";
import { closeProject, openProject } from "@/lib/project/session";
import { useRecipeWatcherHydration } from "@/lib/stores/recipe-watcher-store";

/**
 * AppShell — refactor v3 (ADR-0013) + v4 (ADR-0015 polish)
 *
 * The top bar is gone. The canvas is full-bleed and every UI primitive
 * floats over it as an independent overlay:
 *
 *   top-left      ProjectMenu  (logo + chevron, opens DropdownMenu)
 *   top-center    EditableTitle pill
 *   top-right     GalleryButton + AddNodeButton (paired pills, also ⌘. /
 *                 right-click for add-node)
 *   side-left     LibraryPanel (vertically centered, ⌘1)
 *   side-right    QueuePanel   (vertically centered, ⌘2)
 *   bottom-left   React Flow Controls (zoom / fit / theme, owned by CanvasFlow)
 *   bottom-center PromptBar + ChatSheet (⌘J)
 *   bottom-right  React Flow MiniMap (md+ viewports, owned by CanvasFlow)
 *   overlays      LogsPanel (⌘⇧L), CommandPalette (⌘K), GalleryDrawer
 *
 * Same visual language everywhere: rounded-full pills + rounded-2xl cards,
 * border-border/70, bg-popover/95, backdrop-blur, soft shadow.
 */
export function AppShell({ projectId }: { projectId: string }) {
  useLayoutShortcuts();
  const { user } = useSession();
  // Depend on the stable user ID, NOT the `user` object. Supabase re-emits a
  // fresh session (new `user` reference) on token refresh / tab refocus; if
  // the open-project effect keyed on `user` it would tear down + re-open the
  // project every time you switch tabs and back — aborting any in-flight run
  // and wiping the canvas records. The id only changes on real sign-in/out.
  const userId = user?.id;
  // Phase B2: keep the recipe-version map fresh so composites on canvas
  // can show "Update available" badges. Hydrates on mount + on every
  // window focus (covers cross-tab + cross-device edits).
  useRecipeWatcherHydration({ userId });
  const router = useRouter();
  // Start in `loading` (not `idle`) so the canvas never flashes empty
  // before the project document is applied on mount.
  const [syncStatus, setSyncStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("loading");

  // Open the project named in the URL. The ProjectSession controller owns
  // all teardown / reset / load / rehydrate / re-subscribe ordering
  // (race-guarded), so navigating to a different /projetos/[id] is just a
  // new openProject call. Cloud is canonical per project — no localStorage
  // rehydrate here, which avoids one project's graph flashing while
  // another loads (the spinner below covers the load).
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void (async () => {
      setSyncStatus("loading");
      const result = await openProject({
        projectId,
        userId,
        onError: (err) => {
          console.error("[project-session] error:", err);
          toast.error("Failed to save project changes — will retry");
        },
      });
      if (cancelled) return;
      if (result.notFound) {
        toast.error("Project not found");
        router.replace("/projetos");
        return;
      }
      setSyncStatus(result.ok ? "ready" : "error");
    })();
    return () => {
      cancelled = true;
      closeProject();
    };
  }, [userId, projectId, router]);

  // While the cloud project is loading, show a tiny centered spinner so we
  // don't paint stale localStorage state for a flash before swapping it for
  // cloud state. Once `ready`, the canvas hydrates with the right data.
  if (syncStatus === "loading") {
    return (
      <div
        data-testid="shell-loading"
        className="flex h-screen w-screen items-center justify-center bg-background"
      >
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/60" />
      </div>
    );
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      <CanvasArea />

      {/* Top-left: logo + chevron menu */}
      <div className="pointer-events-auto absolute left-3 top-3 z-30">
        <ProjectMenu />
      </div>

      {/* Top-center: editable project title */}
      <div className="pointer-events-none absolute inset-x-0 top-3 z-30 flex flex-col items-center gap-1">
        <div className="pointer-events-auto">
          <EditableTitle />
        </div>
        <SaveIndicator />
      </div>

      {/* Top-right cluster: Cookbook (recipes + prompts hub) → Gallery
       *  (look at past work) → Run (kick off the current graph) → Add
       *  Node (extend the graph). Reads left-to-right as a workflow
       *  sentence: discover → review → execute → grow. Queue panel
       *  below is vertically centered → no collision; the add-node
       *  popover (z-50) overlays the queue when both are open. */}
      <div className="pointer-events-none absolute right-3 top-3 z-30 flex items-center gap-1.5">
        <CookbookButton />
        <GalleryButton />
        <RunButton />
        <AddNodeButton />
      </div>

      {/* Side floating panels (vertically centered) */}
      <LibraryPanel />
      <QueuePanel />

      {/* Bottom-center: prompt bar + chat sheet */}
      <PromptBar />

      {/* Edge / modal overlays */}
      <LogsPanel />
      <GalleryDrawer />
      <LibraryDrawer />
      <CookbookOverlay />
      <CommandPalette />
    </div>
  );
}
