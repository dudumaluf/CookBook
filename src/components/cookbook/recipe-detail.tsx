"use client";

import {
  Boxes,
  Copy as CopyIcon,
  Cpu,
  GitFork,
  Globe,
  Lock,
  PackagePlus,
  Pencil,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { CopyButton } from "@/components/cookbook/copy-button";
import { RecipeVersionHistory } from "@/components/cookbook/recipe-version-history";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getSpawnPosition } from "@/lib/canvas/spawn-position";
import { extractRecipePrompts } from "@/lib/prompts/extract-from-recipe";
import { forkRecipe } from "@/lib/recipes/fork-recipe";
import { getRecipeRepository } from "@/lib/repositories/supabase-recipe-repository";
import type { RecipeRecord } from "@/lib/repositories/recipe-repository";
import { useLayoutStore } from "@/lib/stores/layout-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import { cn } from "@/lib/utils";

interface RecipeDetailProps {
  recipe: RecipeRecord;
  /** Stable user id for ownership checks; null when not signed in. */
  userId: string | null;
  /** Called after destructive actions so the parent can refresh the list. */
  onChanged: () => Promise<void> | void;
}

/**
 * RecipeDetail — right-pane view in the Cookbook Recipes tab.
 *
 * Shows everything the user needs to understand a recipe without
 * unpacking it onto the canvas:
 *   - Header (name, version, owner badge, description).
 *   - Action row (Drop on Canvas, Duplicate, Delete).
 *   - Exposed I/O — inputs / outputs / parameters with types.
 *   - Internal structure — node kinds, labels, edge count.
 *   - Internal prompts — extracted Text-node bodies + LLM-call meta,
 *     each with a copy button (premium-UI principle: copy-paste first).
 *
 * Phase A is read-only. Edit lives in Phase B; the action row already
 * reserves the right slot so adding it later doesn't shift layout.
 */
export function RecipeDetail({ recipe, userId, onChanged }: RecipeDetailProps) {
  const setCookbookOpen = useLayoutStore((s) => s.setCookbookOpen);
  const addWorkflowNode = useWorkflowStore((s) => s.addNode);
  const nodeCount = useWorkflowStore((s) => s.nodes.length);
  const router = useRouter();
  const [busy, setBusy] = useState<
    "idle" | "drop" | "duplicate" | "delete" | "edit"
  >("idle");

  const isSystem = recipe.ownerId === null;
  const isYours = userId !== null && recipe.ownerId === userId;

  const internalPrompts = useMemo(
    () => extractRecipePrompts(recipe, { includeLlmCalls: true }),
    [recipe],
  );

  const subgraph = recipe.subgraph;
  const nodes = useMemo(() => subgraph.nodes ?? [], [subgraph]);
  const edges = useMemo(() => subgraph.edges ?? [], [subgraph]);

  const nodesByKind = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of nodes) counts.set(n.kind, (counts.get(n.kind) ?? 0) + 1);
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [nodes]);

  /* ──────────── Actions ──────────── */

  function handleDrop() {
    setBusy("drop");
    try {
      const center = getSpawnPosition();
      const jitter = (nodeCount % 5) * 24;
      addWorkflowNode(
        "composite",
        { x: center.x + jitter, y: center.y + jitter },
        {
          recipeId: recipe.id,
          recipeName: recipe.name,
          recipeVersion: recipe.version,
          subgraph: recipe.subgraph,
          exposedInputs: recipe.subgraph.exposedInputs ?? [],
          exposedOutputs: recipe.subgraph.exposedOutputs ?? [],
          exposedParams: recipe.subgraph.exposedParams ?? [],
        },
      );
      setCookbookOpen(false);
      toast.success(`Dropped "${recipe.name}" on canvas`);
    } catch (err) {
      console.warn("[cookbook] drop failed:", err);
      toast.error("Could not drop recipe on canvas");
    } finally {
      setBusy("idle");
    }
  }

  async function handleDuplicate() {
    if (!userId) {
      toast.error("Sign in to duplicate recipes");
      return;
    }
    setBusy("duplicate");
    try {
      await forkRecipe({ source: recipe, ownerId: userId });
      await onChanged();
      toast.success(`Duplicated "${recipe.name}"`);
    } catch (err) {
      console.warn("[cookbook] duplicate failed:", err);
      toast.error("Could not duplicate recipe");
    } finally {
      setBusy("idle");
    }
  }

  async function handleEdit() {
    if (!userId) {
      toast.error("Sign in to edit recipes");
      return;
    }
    setBusy("edit");
    try {
      // System recipes need a user-owned fork before editing — RLS won't
      // let `saveAsNewVersion` touch a system row directly. Phase B1
      // does the fork silently (matches the duplicate-and-edit user
      // expectation) and routes the user to the fork's edit page.
      const targetId = isSystem
        ? (await forkRecipe({
            source: recipe,
            ownerId: userId,
            nameSuffix: " (your copy)",
          })).id
        : recipe.id;

      // Preserve return URL so the edit page's Save / Discard land the
      // user back where they came from (typically the project canvas
      // they opened the Cookbook overlay over).
      const from =
        typeof window !== "undefined"
          ? `?from=${encodeURIComponent(window.location.pathname)}`
          : "";

      // Refresh the Library list so a fresh fork is visible when the
      // user navigates back later. Awaited so the user sees the fork
      // in any "open in Library" pivot.
      if (isSystem) {
        await onChanged();
      }

      setCookbookOpen(false);
      router.push(`/recipes/${targetId}/edit${from}`);
    } catch (err) {
      console.warn("[cookbook] edit open failed:", err);
      toast.error("Could not open recipe for edit");
    } finally {
      setBusy("idle");
    }
  }

  async function handleDelete() {
    if (!isYours) return;
    if (!window.confirm(`Delete recipe "${recipe.name}"? This can't be undone.`))
      return;
    setBusy("delete");
    try {
      await getRecipeRepository().remove(recipe.id);
      await onChanged();
      toast.success(`Deleted "${recipe.name}"`);
    } catch (err) {
      console.warn("[cookbook] delete failed:", err);
      toast.error("Could not delete recipe");
    } finally {
      setBusy("idle");
    }
  }

  /* ──────────── Render ──────────── */

  return (
    <div
      data-testid="cookbook-recipe-detail-scroll"
      className="h-full overflow-y-auto"
    >
      <div className="flex flex-col gap-6 p-6">
        {/* Header */}
        <header className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-base font-medium text-foreground">
                  {recipe.name}
                </h2>
                <OwnerBadge isSystem={isSystem} isYours={isYours} />
                {recipe.version > 1 ? (
                  <span
                    className="rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground"
                    title="Recipe version"
                  >
                    v{recipe.version}
                  </span>
                ) : null}
              </div>
              {recipe.description ? (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {recipe.description}
                </p>
              ) : (
                <p className="text-xs italic text-muted-foreground/60">
                  No description.
                </p>
              )}
            </div>
          </div>

          {/* Action row */}
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              size="sm"
              onClick={handleDrop}
              disabled={busy !== "idle"}
              className="gap-1.5"
              data-testid="cookbook-recipe-drop"
            >
              <PackagePlus className="h-3.5 w-3.5" />
              Drop on canvas
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleEdit()}
              disabled={busy !== "idle" || !userId}
              className="gap-1.5"
              data-testid="cookbook-recipe-edit"
              title={
                isSystem
                  ? "Forks the system recipe to your library, then opens it for edit"
                  : undefined
              }
            >
              <Pencil className="h-3.5 w-3.5" />
              {isSystem ? "Fork & edit" : "Edit"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void handleDuplicate()}
              disabled={busy !== "idle" || !userId}
              className="gap-1.5"
              data-testid="cookbook-recipe-duplicate"
            >
              <GitFork className="h-3.5 w-3.5" />
              {isSystem ? "Duplicate to your library" : "Duplicate"}
            </Button>
            {/* Delete is destructive — always visible so the affordance is
             *  discoverable, but disabled (with an explanatory tooltip) on
             *  system recipes (RLS would reject) and on anonymous users. */}
            {isYours ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void handleDelete()}
                disabled={busy !== "idle"}
                className="gap-1.5 text-destructive hover:text-destructive"
                data-testid="cookbook-recipe-delete"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </Button>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0}>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled
                      className="gap-1.5 text-muted-foreground/60"
                      data-testid="cookbook-recipe-delete-disabled"
                      aria-label={
                        isSystem
                          ? "System recipes can't be deleted directly. Duplicate to your library and delete the duplicate."
                          : "Sign in to delete recipes."
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[240px]">
                  {isSystem
                    ? "System recipes are bundled with the app and can't be deleted directly. Click Duplicate to copy this recipe to your library, then delete the duplicate."
                    : "Sign in to delete recipes you own."}
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </header>

        <Separator />

        {/* Quick stats */}
        <section className="grid grid-cols-3 gap-3 text-xs">
          <Stat label="Internal nodes" value={String(nodes.length)} />
          <Stat label="Connections" value={String(edges.length)} />
          <Stat
            label="Category"
            value={recipe.category ?? "—"}
          />
        </section>

        {/* Exposed I/O */}
        <section className="flex flex-col gap-3">
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            What this recipe exposes
          </h3>

          <ExposedList
            title="Inputs"
            items={(subgraph.exposedInputs ?? []).map((h) => ({
              label: h.label,
              meta: h.dataType,
            }))}
            empty="No inputs exposed."
          />
          <ExposedList
            title="Outputs"
            items={(subgraph.exposedOutputs ?? []).map((h) => ({
              label: h.label,
              meta: h.dataType,
            }))}
            empty="No outputs exposed."
          />
          <ExposedList
            title="Parameters"
            items={(subgraph.exposedParams ?? []).map((p) => ({
              label: p.label,
              meta: p.control,
            }))}
            empty="No tweakable parameters."
          />
        </section>

        <Separator />

        {/* Internal structure */}
        <section className="flex flex-col gap-3">
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Internal structure
          </h3>
          {nodesByKind.length === 0 ? (
            <p className="text-xs italic text-muted-foreground/60">
              Empty subgraph.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {nodesByKind.map(([kind, count]) => (
                <li
                  key={kind}
                  className="flex items-center justify-between rounded-md border border-border/40 bg-muted/20 px-2.5 py-1.5 text-xs"
                >
                  <span className="flex items-center gap-2">
                    <Boxes className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="font-medium text-foreground">{kind}</span>
                  </span>
                  <span className="text-[10px] tabular-nums text-muted-foreground">
                    {count} {count === 1 ? "node" : "nodes"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Internal prompts */}
        {internalPrompts.length > 0 ? (
          <>
            <Separator />
            <section className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-col">
                  <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Instructions inside this recipe
                  </h3>
                  <p className="text-[10.5px] text-muted-foreground/70">
                    Plain text — copy and paste into any LLM to discuss or
                    refine.
                  </p>
                </div>
                <CopyButton
                  size="sm"
                  text={internalPrompts
                    .filter((p) => p.internalNodeKind === "text")
                    .map(
                      (p) =>
                        `### ${p.title}${p.purpose ? ` (${p.purpose})` : ""}\n\n${p.content}`,
                    )
                    .join("\n\n---\n\n")}
                  label="Copy all prompts as plain text"
                />
              </div>
              <ul className="flex flex-col gap-2">
                {internalPrompts.map((prompt) => (
                  <PromptBlock key={prompt.key} prompt={prompt} />
                ))}
              </ul>
            </section>
          </>
        ) : null}

        {/* Phase B2: version history (only renders for v > 1 recipes). */}
        <RecipeVersionHistory recipe={recipe} />
      </div>
    </div>
  );
}

/* ──────────── Sub-components ──────────── */

function OwnerBadge({
  isSystem,
  isYours,
}: {
  isSystem: boolean;
  isYours: boolean;
}) {
  if (isSystem) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
        title="Built into the app, visible to everyone"
      >
        <Globe className="h-2.5 w-2.5" />
        System
      </span>
    );
  }
  if (isYours) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-500"
        title="Your private recipe"
      >
        <Lock className="h-2.5 w-2.5" />
        Yours
      </span>
    );
  }
  return null;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/40 bg-muted/20 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
        {label}
      </p>
      <p className="mt-0.5 truncate text-xs font-medium text-foreground">
        {value}
      </p>
    </div>
  );
}

function ExposedList({
  title,
  items,
  empty,
}: {
  title: string;
  items: { label: string; meta: string }[];
  empty: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground/70">
        {title}
      </p>
      {items.length === 0 ? (
        <p className="text-[11px] italic text-muted-foreground/60">{empty}</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {items.map((item) => (
            <li
              key={`${title}-${item.label}`}
              className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/30 px-2 py-1 text-[11px]"
            >
              <span className="text-foreground">{item.label}</span>
              <span className="text-muted-foreground/70">·</span>
              <span className="text-muted-foreground">{item.meta}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PromptBlock({
  prompt,
}: {
  prompt: ReturnType<typeof extractRecipePrompts>[number];
}) {
  const [expanded, setExpanded] = useState(false);
  const isLlm = prompt.internalNodeKind === "llm-text";
  const Icon = isLlm ? Cpu : CopyIcon;

  return (
    <li
      className={cn(
        "flex flex-col gap-2 rounded-lg border border-border/50 bg-muted/15 p-3",
        isLlm && "bg-muted/5",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <Icon className="h-3 w-3 shrink-0 text-muted-foreground" />
            <p className="truncate text-xs font-medium text-foreground">
              {prompt.title.replace(/^.*? → /, "")}
            </p>
            {prompt.purpose ? (
              <span className="rounded-sm border border-border/40 bg-background px-1 py-px text-[9px] uppercase tracking-wider text-muted-foreground">
                {prompt.purpose}
              </span>
            ) : null}
          </div>
          {prompt.description ? (
            <p className="text-[10.5px] leading-relaxed text-muted-foreground/80">
              {prompt.description}
            </p>
          ) : null}
        </div>
        <CopyButton size="sm" text={prompt.content} />
      </div>
      <div className="flex flex-col gap-1">
        <pre
          className={cn(
            "overflow-x-auto whitespace-pre-wrap break-words rounded-md border border-border/40 bg-background/50 p-2.5 font-mono text-[10.5px] leading-relaxed text-foreground/90",
            !expanded && "max-h-[8rem] overflow-y-hidden",
          )}
        >
          {prompt.content}
        </pre>
        {prompt.content.length > 280 ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="self-start text-[10.5px] text-muted-foreground hover:text-foreground"
          >
            {expanded ? "Show less" : "Show full text"}
          </button>
        ) : null}
      </div>
    </li>
  );
}
