"use client";

import { Clock, GitCompare, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Separator } from "@/components/ui/separator";
import { getRecipeRepository } from "@/lib/repositories/supabase-recipe-repository";
import type {
  RecipeRecord,
  RecipeVersionRecord,
} from "@/lib/repositories/recipe-repository";
import { cn } from "@/lib/utils";

import { RecipeVersionDiff } from "./recipe-version-diff";

interface RecipeVersionHistoryProps {
  recipe: RecipeRecord;
}

/**
 * `<RecipeVersionHistory />` — Cookbook Library Phase B2 (ADR-0060).
 *
 * Embedded section in `<RecipeDetail />` listing every saved version of
 * the recipe with a click-to-diff affordance. Hides itself entirely on
 * v1 recipes (no history to show).
 *
 * Lazy-loaded on first expand — most users won't expand the section so
 * we save a network call. Re-keyed on `recipe.id` so switching from
 * one recipe to another inside the same Cookbook overlay session fully
 * resets internal state (collapsed, no selection, fresh fetch).
 */
export function RecipeVersionHistory({ recipe }: RecipeVersionHistoryProps) {
  // v1 recipes never show this section — there's nothing to compare.
  if (recipe.version <= 1) return null;
  return <RecipeVersionHistoryInner key={recipe.id} recipe={recipe} />;
}

function RecipeVersionHistoryInner({ recipe }: RecipeVersionHistoryProps) {
  const [expanded, setExpanded] = useState(false);
  const [versions, setVersions] = useState<RecipeVersionRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);

  // Lazy load only when the section is opened the first time.
  useEffect(() => {
    if (!expanded || versions !== null) return;
    let cancelled = false;
    void (async () => {
      try {
        const list = await getRecipeRepository().listVersions(recipe.id);
        if (cancelled) return;
        setVersions(list);
        // Default selection: the immediately-prior version, if any.
        // Reads "what changed since last edit?" — the most common ask.
        if (list.length > 0) setSelectedVersion(list[0].version);
      } catch (err) {
        if (cancelled) return;
        console.warn("[recipe-version-history] load failed:", err);
        setError("Could not load history");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [expanded, versions, recipe.id]);

  const selectedVersionRecord = useMemo(
    () => versions?.find((v) => v.version === selectedVersion) ?? null,
    [versions, selectedVersion],
  );

  return (
    <>
      <Separator />
      <section className="flex flex-col gap-3" data-testid="recipe-version-history">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center justify-between text-xs font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground"
          data-testid="recipe-version-history-toggle"
        >
          <span className="flex items-center gap-2">
            <Clock className="h-3.5 w-3.5" />
            Version history
            <span className="rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium tabular-nums">
              v{recipe.version}
            </span>
          </span>
          <span className="text-[10px] text-muted-foreground/70">
            {expanded ? "▾" : "▸"}
          </span>
        </button>
        {expanded ? (
          versions === null && error === null ? (
            <div className="flex h-12 items-center justify-center">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground/60" />
            </div>
          ) : error ? (
            <p className="text-xs italic text-destructive">{error}</p>
          ) : versions && versions.length === 0 ? (
            // Edge: recipe.version > 1 but no rows in history. Means
            // someone deleted the history table rows manually OR the
            // version was bumped before B1 shipped (no history entry was
            // written). Show a friendly message rather than 0 rows.
            <p className="text-xs italic text-muted-foreground/60">
              No earlier versions stored. Edits made before history was
              tracked don&apos;t appear here.
            </p>
          ) : (
            <>
              <ul className="flex flex-col gap-1" data-testid="recipe-version-list">
                <li>
                  <span className="flex items-center justify-between gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-2.5 py-1.5 text-xs">
                    <span className="font-medium text-emerald-500">
                      v{recipe.version}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      Current
                    </span>
                  </span>
                </li>
                {versions!.map((v) => (
                  <li key={v.version}>
                    <button
                      type="button"
                      onClick={() => setSelectedVersion(v.version)}
                      data-testid={`recipe-version-row-${v.version}`}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors",
                        selectedVersion === v.version
                          ? "border-foreground/40 bg-foreground/5"
                          : "border-border/40 bg-muted/20 hover:bg-foreground/[0.04]",
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <span className="font-medium tabular-nums">
                          v{v.version}
                        </span>
                        {v.name && v.name !== recipe.name ? (
                          <span className="truncate text-[10px] text-muted-foreground/70">
                            &quot;{v.name}&quot;
                          </span>
                        ) : null}
                      </span>
                      <span className="text-[10px] tabular-nums text-muted-foreground/70">
                        {formatRelative(v.createdAt)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {selectedVersionRecord ? (
                <div className="flex flex-col gap-2 rounded-lg border border-border/50 bg-muted/10 p-3">
                  <div className="flex items-center gap-2 text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">
                    <GitCompare className="h-3 w-3" />
                    What changed: v{selectedVersionRecord.version} → v
                    {recipe.version}
                  </div>
                  <RecipeVersionDiff
                    prev={selectedVersionRecord.subgraph}
                    next={recipe.subgraph}
                  />
                </div>
              ) : null}
            </>
          )
        ) : null}
      </section>
    </>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  const y = Math.floor(mo / 12);
  return `${y}y ago`;
}
