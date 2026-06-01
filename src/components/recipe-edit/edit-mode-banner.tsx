"use client";

import { ArrowLeft, Loader2, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  closeRecipeEdit,
  saveRecipeEdit,
} from "@/lib/project/recipe-edit-session";
import { useRecipeEditStore } from "@/lib/stores/recipe-edit-store";

interface EditModeBannerProps {
  /** Path the user arrived from (typically `/projetos/<id>`). null →
   *  fall back to `/projetos`. */
  returnTo: string | null;
}

const FALLBACK_RETURN = "/projetos";

/**
 * EditModeBanner — Cookbook Library Phase B1 (ADR-0051).
 *
 * The persistent top-center pill rendered by `RecipeEditShell`. Three
 * affordances:
 *   - **Discard / Close** (left arrow) — exit without saving. Confirms
 *     when there are unsaved changes; just closes when there aren't.
 *   - **Recipe identity** — name + current version pill + "Unsaved"
 *     chip when dirty.
 *   - **Save** (right) — calls `saveRecipeEdit()`, toasts the new
 *     version number, then navigates back. Disabled until the user has
 *     mutated something (`hasUnsavedChanges`).
 *
 * Also installs a `beforeunload` warning so the user doesn't lose
 * unsaved work to a tab close. Removed on unmount + cleared after a
 * successful save.
 */
export function EditModeBanner({ returnTo }: EditModeBannerProps) {
  const router = useRouter();
  const recipeName = useRecipeEditStore((s) => s.recipeName);
  const currentVersion = useRecipeEditStore((s) => s.currentVersion);
  const hasUnsavedChanges = useRecipeEditStore((s) => s.hasUnsavedChanges);
  const [busy, setBusy] = useState<"idle" | "saving">("idle");

  useEffect(() => {
    // Warn on tab close / page reload while there's unsaved work. Native
    // browser dialog only — no custom message in modern browsers, but the
    // confirm prompt itself is enough to prevent accidental loss.
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (!hasUnsavedChanges) return;
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasUnsavedChanges]);

  function navigateBack() {
    closeRecipeEdit();
    router.push(returnTo ?? FALLBACK_RETURN);
  }

  async function handleSave() {
    setBusy("saving");
    const result = await saveRecipeEdit({
      onError: (err) => {
        console.warn("[recipe-edit] save failed:", err);
      },
    });
    if (result.ok && result.record) {
      toast.success(
        `Saved "${result.record.name}" as v${result.record.version}`,
      );
      navigateBack();
    } else {
      toast.error("Could not save recipe — please retry");
      setBusy("idle");
    }
  }

  function handleDiscard() {
    if (hasUnsavedChanges) {
      const ok = window.confirm(
        "Discard changes? They can't be recovered.",
      );
      if (!ok) return;
    }
    navigateBack();
  }

  // Recipe-edit store hasn't been hydrated yet (the shell's `loading`
  // state already gates this, but be defensive in case the store gets
  // reset mid-render).
  if (recipeName === null) return null;

  return (
    <div
      data-testid="edit-mode-banner"
      className="pointer-events-none absolute inset-x-0 top-3 z-30 flex flex-col items-center gap-1"
    >
      <div className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-popover/95 px-2 py-1 shadow-lg shadow-black/30 backdrop-blur-md">
        <button
          type="button"
          onClick={handleDiscard}
          disabled={busy === "saving"}
          data-testid="edit-mode-discard"
          className="inline-flex h-7 items-center gap-1.5 rounded-full px-2 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          title={
            hasUnsavedChanges
              ? "Discard changes and close"
              : "Close edit mode"
          }
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {hasUnsavedChanges ? "Discard" : "Close"}
        </button>
        <Separator orientation="vertical" className="h-4" />
        <span className="flex items-center gap-1.5 px-1 text-xs">
          <span className="text-muted-foreground">Editing</span>
          <span className="max-w-[200px] truncate font-medium text-foreground">
            {recipeName}
          </span>
          {currentVersion !== null ? (
            <span
              className="rounded-md border border-border/60 bg-muted/40 px-1 py-px text-[10px] tabular-nums text-muted-foreground"
              title="Current saved version"
            >
              v{currentVersion}
            </span>
          ) : null}
        </span>
        {hasUnsavedChanges ? (
          <span
            data-testid="edit-mode-unsaved"
            className="rounded-md bg-amber-500/15 px-1.5 py-px text-[10px] font-medium uppercase tracking-wider text-amber-600"
            title="Unsaved changes"
          >
            Unsaved
          </span>
        ) : null}
        <Button
          size="sm"
          onClick={() => void handleSave()}
          disabled={busy === "saving" || !hasUnsavedChanges}
          data-testid="edit-mode-save"
          className="h-7 gap-1.5 rounded-full px-3 text-xs"
        >
          {busy === "saving" ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Save className="h-3 w-3" />
          )}
          Save
        </Button>
      </div>
    </div>
  );
}
