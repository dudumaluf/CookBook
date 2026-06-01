"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { CanvasArea } from "./canvas-area";
import { LibraryPanel } from "./library-panel";
import { QueuePanel } from "./queue-panel";
import { AddNodeButton } from "./add-node-button";
import { RunButton } from "./run-button";
import { CommandPalette } from "./command-palette";
import { LogsPanel } from "./logs-panel";
import { LibraryDrawer } from "./library-drawer";
import { EditModeBanner } from "@/components/recipe-edit/edit-mode-banner";
import { useSession } from "@/lib/auth/use-session";
import { useLayoutShortcuts } from "@/lib/hooks/use-layout-shortcuts";
import {
  closeRecipeEdit,
  openRecipeForEdit,
} from "@/lib/project/recipe-edit-session";

/**
 * RecipeEditShell — Cookbook Library Phase B1 (ADR-0051).
 *
 * Mirror of `AppShell` for the recipe edit route. Differences from
 * `AppShell`:
 *   - Mounts `RecipeEditSession.openRecipeForEdit` (not `openProject`)
 *     to hydrate the workflow store with the recipe's saved subgraph.
 *   - Cookbook + Gallery buttons are gone (no nested cookbook / gallery
 *     in edit mode — keeps the surface focused on the subgraph).
 *   - Project title cluster is replaced by `<EditModeBanner />` —
 *     "Editing: <name> v<n>" + Save / Discard.
 *   - PromptBar is gone (the assistant has no recipe-edit role yet;
 *     Phase C/D bring it back behind a role overlay).
 *   - On unmount the session is closed; the destination route (likely
 *     a project page) re-hydrates its own canvas via `openProject`.
 *
 * The `?from=<path>` query param threads through so Save / Discard can
 * land the user back where they came from (typically `/projetos/<id>`)
 * instead of bouncing to `/projetos`.
 */
export function RecipeEditShell({ recipeId }: { recipeId: string }) {
  useLayoutShortcuts();
  const { user } = useSession();
  // Same stable-id rule as AppShell — avoid tearing down on token refresh.
  const userId = user?.id;
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromUrl = searchParams.get("from");
  // Start in `loading` so the canvas never flashes whatever was last in
  // workflow-store (the previous project's nodes, or v stale recipe).
  const [syncStatus, setSyncStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("loading");

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void (async () => {
      setSyncStatus("loading");
      const result = await openRecipeForEdit({
        recipeId,
        userId,
        onError: (err) => {
          console.error("[recipe-edit-session] error:", err);
          toast.error("Failed to load recipe — try again");
        },
      });
      if (cancelled) return;
      if (result.notFound) {
        toast.error("Recipe not found or not yours");
        router.replace(fromUrl ?? "/projetos");
        return;
      }
      if (result.redirectTo) {
        // System recipe was forked silently — replace the URL so the
        // back-button history doesn't keep the system id, and so a
        // refresh keeps editing the fork instead of re-forking.
        const fromSuffix = fromUrl
          ? `?from=${encodeURIComponent(fromUrl)}`
          : "";
        router.replace(
          `/recipes/${result.redirectTo}/edit${fromSuffix}`,
        );
        return;
      }
      setSyncStatus(result.ok ? "ready" : "error");
    })();
    return () => {
      cancelled = true;
      closeRecipeEdit();
    };
  }, [userId, recipeId, router, fromUrl]);

  if (syncStatus === "loading") {
    return (
      <div
        data-testid="recipe-edit-loading"
        className="flex h-screen w-screen items-center justify-center bg-background"
      >
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/60" />
      </div>
    );
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      <CanvasArea />

      {/* Top-center: edit-mode banner (replaces ProjectMenu + EditableTitle) */}
      <EditModeBanner returnTo={fromUrl} />

      {/* Top-right cluster: Run + Add Node. No Cookbook / Gallery —
       *  recursion / cross-context confusion isn't worth the convenience. */}
      <div className="pointer-events-none absolute right-3 top-3 z-30 flex items-center gap-1.5">
        <RunButton />
        <AddNodeButton />
      </div>

      {/* Side floating panels (assets + queue still useful here) */}
      <LibraryPanel />
      <QueuePanel />

      {/* Edge / modal overlays. CookbookOverlay is intentionally absent. */}
      <LogsPanel />
      <LibraryDrawer />
      <CommandPalette />
    </div>
  );
}
