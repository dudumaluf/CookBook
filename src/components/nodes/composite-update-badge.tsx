"use client";

import { ArrowUp, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  countCompositesByRecipe,
  updateAllCompositesByRecipe,
  updateCompositeInstance,
} from "@/lib/recipes/update-composite";
import { useRecipeWatcherStore } from "@/lib/stores/recipe-watcher-store";

interface CompositeUpdateBadgeProps {
  /** The composite's `nodeId` on canvas. */
  nodeId: string;
  /** The recipe id this composite was instantiated from. */
  recipeId: string;
  /** The version stamped on the composite at drop time. */
  instanceVersion: number;
  /** The recipe's current version (from the watcher store). */
  currentVersion: number;
}

/**
 * `<CompositeUpdateBadge />` — Cookbook Library Phase B2 (ADR-0060).
 *
 * Inline pill rendered on a composite node whose embedded
 * `recipeVersion` is below the recipe's current version. Click opens a
 * popover with two actions:
 *   - **Update this instance** — re-fetch the recipe, replace the
 *     embedded subgraph, bump `recipeVersion` on this node only.
 *   - **Update all instances of this recipe in this project** — same
 *     but applied to every composite in the workflow that points at
 *     the same recipe.
 *
 * Override preservation: per-instance edits to `exposedParams` controls
 * are captured, the new subgraph replaces the old, then captured
 * overrides are re-applied where the matching `internalNodeId` still
 * exists in the new shape. Dropped overrides toast a warning so the
 * user knows to re-tune.
 *
 * Hidden when:
 *   - `recipeVersion === null` (pre-B1 instance — we don't know its
 *     version, can't compare).
 *   - `recipeId === null` (composite saved without a cloud row).
 *   - `instanceVersion >= currentVersion` (up to date).
 *   - The watcher hasn't hydrated yet (avoids a flash on first paint).
 */
export function CompositeUpdateBadge({
  nodeId,
  recipeId,
  instanceVersion,
  currentVersion,
}: CompositeUpdateBadgeProps) {
  const [busy, setBusy] = useState<"idle" | "this" | "all">("idle");
  const [open, setOpen] = useState(false);
  const totalInstances = countCompositesByRecipe(recipeId);
  const refresh = useRecipeWatcherStore((s) => s.refresh);

  // Stop pointer events from reaching React Flow so clicking the badge
  // doesn't drag the node.
  const stopDrag = (e: React.PointerEvent) => e.stopPropagation();

  function toastResult(result: {
    preservedOverrides: number;
    droppedOverrides: number;
  }) {
    if (result.droppedOverrides > 0) {
      toast.warning(
        `Updated. ${result.droppedOverrides} custom value${
          result.droppedOverrides === 1 ? "" : "s"
        } dropped (the recipe's structure changed).`,
      );
    } else if (result.preservedOverrides > 0) {
      toast.success(
        `Updated. ${result.preservedOverrides} custom value${
          result.preservedOverrides === 1 ? "" : "s"
        } preserved.`,
      );
    } else {
      toast.success("Updated to latest version.");
    }
  }

  async function handleUpdateThis() {
    setBusy("this");
    try {
      const result = await updateCompositeInstance({ nodeId });
      if (!result.ok) {
        toast.error("Could not update — recipe not found or no longer yours.");
      } else {
        toastResult(result);
      }
    } catch (err) {
      console.warn("[composite-update-badge] update this failed:", err);
      toast.error("Update failed — please retry.");
    } finally {
      setBusy("idle");
      setOpen(false);
    }
  }

  async function handleUpdateAll() {
    setBusy("all");
    try {
      const result = await updateAllCompositesByRecipe({ recipeId });
      if (!result.ok) {
        toast.error("Could not update — recipe not found or no longer yours.");
      } else if (result.updatedCount === 0) {
        // Race: between the badge render + click, all instances got
        // updated some other way (e.g. another badge already fired).
        toast.success("Already up to date.");
      } else {
        toastResult({
          preservedOverrides: result.preservedOverrides,
          droppedOverrides: result.droppedOverrides,
        });
      }
    } catch (err) {
      console.warn("[composite-update-badge] update all failed:", err);
      toast.error("Update failed — please retry.");
    } finally {
      setBusy("idle");
      setOpen(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        data-testid="composite-update-badge"
        title={`Recipe is now v${currentVersion} (this instance is v${instanceVersion})`}
        onPointerDown={stopDrag}
        className="pointer-events-auto inline-flex h-5 items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 text-[10px] font-medium uppercase tracking-wider text-amber-600 transition-colors hover:bg-amber-500/20"
      >
        <ArrowUp className="h-2.5 w-2.5" aria-hidden />
        v{currentVersion} available
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-[260px] gap-1 p-1"
        onPointerDown={stopDrag}
      >
        <button
          type="button"
          data-testid="composite-update-this"
          onClick={() => void handleUpdateThis()}
          disabled={busy !== "idle"}
          className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-foreground/5 disabled:opacity-50"
        >
          <span>
            Update this instance
            <span className="ml-1 text-[10px] text-muted-foreground">
              v{instanceVersion} → v{currentVersion}
            </span>
          </span>
          {busy === "this" ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
        </button>
        {totalInstances > 1 ? (
          <button
            type="button"
            data-testid="composite-update-all"
            onClick={() => void handleUpdateAll()}
            disabled={busy !== "idle"}
            className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-foreground/5 disabled:opacity-50"
          >
            <span>
              Update all {totalInstances} instances
              <span className="ml-1 text-[10px] text-muted-foreground">
                of this recipe in this project
              </span>
            </span>
            {busy === "all" ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => {
            void refresh({ ownerId: null, includeSystem: true });
            setOpen(false);
          }}
          disabled={busy !== "idle"}
          className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[10.5px] text-muted-foreground hover:bg-foreground/5 disabled:opacity-50"
          title="Re-fetch recipe versions from the cloud"
        >
          Refresh
        </button>
      </PopoverContent>
    </Popover>
  );
}
