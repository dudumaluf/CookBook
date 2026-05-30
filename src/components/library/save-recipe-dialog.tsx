"use client";

import { Loader2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useSession } from "@/lib/auth/use-session";
import { nodeRegistry } from "@/lib/engine/registry";
import { autoDetectExposedIO } from "@/lib/recipes/auto-detect-io";
import { saveSelectionAsRecipe } from "@/lib/recipes/save-from-canvas";
import type {
  RecipeExposedHandle,
  RecipeExposedParam,
} from "@/lib/repositories/recipe-repository";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import type { NodeInstance } from "@/types/node";

/**
 * SaveRecipeDialog — Slice 6.6.
 *
 * Modal that captures everything we need to commit a "Save as recipe":
 *
 *   - **Name + description** for the recipe.
 *   - **Exposed I/O list**, auto-detected from the current selection.
 *     Each handle row has the inferred default label (matching the
 *     internal handle's label, with the source-node title prefixed on
 *     collisions) + an "X" to drop it from the public surface.
 *   - **Replace selection with composite node** checkbox (default ON).
 *
 * Rationale: 99% of the time the user just hits Enter and the smart
 * defaults are right. Tweaking is one click away.
 *
 * The dialog is controlled via `open` / `onOpenChange` so the parent
 * (canvas context menu) can drive it from the "Save as recipe…" item.
 */

export interface SaveRecipeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Ids of the nodes the user wants to save. */
  selectedNodeIds: string[];
}

export function SaveRecipeDialog({
  open,
  onOpenChange,
  selectedNodeIds,
}: SaveRecipeDialogProps) {
  const { user } = useSession();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [replaceWithComposite, setReplaceWithComposite] = useState(true);
  const [busy, setBusy] = useState(false);
  // We snapshot the auto-detected I/O at open time so the user can tweak
  // labels / drop entries without us re-detecting on every keystroke.
  const [exposedInputs, setExposedInputs] = useState<RecipeExposedHandle[]>(
    [],
  );
  const [exposedOutputs, setExposedOutputs] = useState<RecipeExposedHandle[]>(
    [],
  );
  // Inner config fields the user chose to surface as composite controls.
  const [exposedParams, setExposedParams] = useState<RecipeExposedParam[]>([]);
  // Select the STABLE `nodes` array ref (not a freshly-filtered array) — a
  // selector returning a new array every render makes useSyncExternalStore
  // think the store changed on every render, which is an infinite re-render
  // loop (React #185). Derive the filtered set with useMemo instead.
  const allNodes = useWorkflowStore((s) => s.nodes);
  const selectedNodes = useMemo(
    () => allNodes.filter((n) => selectedNodeIds.includes(n.id)),
    [allNodes, selectedNodeIds],
  );

  // Re-derive defaults whenever the dialog (re-)opens with a fresh
  // selection. We don't recompute on every render — that would clobber
  // user edits to labels. The set-state-in-effect lint rule is
  // deliberately disabled for this whole effect: it IS the case the
  // rule warns about, and it's the right shape here (sync local form
  // state to a transient prop change).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    const ws = useWorkflowStore.getState();
    const selectedNodes = ws.nodes.filter((n) =>
      selectedNodeIds.includes(n.id),
    );
    const detected = autoDetectExposedIO(selectedNodes, ws.edges);
    setExposedInputs(detected.inputs);
    setExposedOutputs(detected.outputs);
    setExposedParams([]);
    setName("");
    setDescription("");
    setReplaceWithComposite(true);
  }, [open, selectedNodeIds]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const canSubmit = useMemo(
    () => name.trim().length > 0 && selectedNodeIds.length > 0 && !busy,
    [name, selectedNodeIds.length, busy],
  );

  async function handleSave() {
    if (!user) {
      toast.error("Sign in to save recipes");
      return;
    }
    setBusy(true);
    try {
      const result = await saveSelectionAsRecipe({
        ownerId: user.id,
        selectedNodeIds,
        name: name.trim(),
        description: description.trim() || undefined,
        exposedInputs,
        exposedOutputs,
        exposedParams,
        replaceWithComposite,
      });
      toast.success(
        replaceWithComposite
          ? `Saved "${result.recipe.name}" — selection collapsed to a composite node`
          : `Saved "${result.recipe.name}" — find it in Library → Recipes`,
      );
      onOpenChange(false);
    } catch (err) {
      console.warn("[save-recipe] failed:", err);
      toast.error(
        err instanceof Error ? err.message : "Failed to save recipe",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="save-recipe-dialog"
        className="sm:max-w-[520px]"
      >
        <DialogHeader>
          <DialogTitle>Save selection as recipe</DialogTitle>
          <DialogDescription>
            Capture {selectedNodeIds.length}{" "}
            {selectedNodeIds.length === 1 ? "node" : "nodes"} as a reusable
            recipe. Drag it onto any canvas later to drop a single composite
            node that runs this exact subgraph.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="recipe-name" className="text-xs">
              Name
            </label>
            <Input
              id="recipe-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Image Describer"
              autoFocus
              data-testid="save-recipe-name"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="recipe-description" className="text-xs">
              Description (optional)
            </label>
            <Input
              id="recipe-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this recipe do?"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-xs">
              Inputs ({exposedInputs.length})
            </label>
            {exposedInputs.length === 0 ? (
              <p className="text-[11px] text-muted-foreground/70">
                No public inputs — every input handle is wired internally.
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {exposedInputs.map((h, i) => (
                  <HandleRow
                    key={`${h.internalNodeId}::${h.internalHandleId}`}
                    handle={h}
                    onLabelChange={(label) => {
                      setExposedInputs((curr) =>
                        curr.map((c, idx) => (idx === i ? { ...c, label } : c)),
                      );
                    }}
                    onRemove={() => {
                      setExposedInputs((curr) =>
                        curr.filter((_, idx) => idx !== i),
                      );
                    }}
                    testId={`save-recipe-input-${i}`}
                  />
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-xs">
              Outputs ({exposedOutputs.length})
            </label>
            {exposedOutputs.length === 0 ? (
              <p className="text-[11px] text-muted-foreground/70">
                No public outputs — every output handle is consumed internally.
                The composite will run side-effects but emit nothing.
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {exposedOutputs.map((h, i) => (
                  <HandleRow
                    key={`${h.internalNodeId}::${h.internalHandleId}`}
                    handle={h}
                    onLabelChange={(label) => {
                      setExposedOutputs((curr) =>
                        curr.map((c, idx) => (idx === i ? { ...c, label } : c)),
                      );
                    }}
                    onRemove={() => {
                      setExposedOutputs((curr) =>
                        curr.filter((_, idx) => idx !== i),
                      );
                    }}
                    testId={`save-recipe-output-${i}`}
                  />
                ))}
              </ul>
            )}
          </div>

          <RecipeParamsEditor
            nodes={selectedNodes}
            params={exposedParams}
            onChange={setExposedParams}
          />

          <label className="flex cursor-pointer items-center gap-2 text-xs text-foreground">
            <input
              type="checkbox"
              checked={replaceWithComposite}
              onChange={(e) => setReplaceWithComposite(e.target.checked)}
              data-testid="save-recipe-replace"
              className="h-3.5 w-3.5 rounded border border-border/60 bg-background/40"
            />
            Replace selection with composite node
          </label>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => void handleSave()}
            disabled={!canSubmit}
            data-testid="save-recipe-submit"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            Save recipe
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ───────────────────── Exposed-params editor ───────────────────────── */

interface ParamCandidate {
  nodeId: string;
  nodeTitle: string;
  key: string;
  inferred: RecipeExposedParam["control"];
  /** Dropdown options + label inherited from the node's schema, if declared. */
  options?: readonly string[];
  label?: string;
}

/**
 * Lets the recipe author pick which inner config fields become controls on
 * the composite (so the user tweaks the recipe without unpacking it). Each
 * primitive config field is a candidate; checking it exposes it with an
 * auto-inferred control + editable label. Text fields can be turned into a
 * dropdown by typing comma-separated choices.
 */
function RecipeParamsEditor({
  nodes,
  params,
  onChange,
}: {
  nodes: NodeInstance[];
  params: RecipeExposedParam[];
  onChange: (params: RecipeExposedParam[]) => void;
}) {
  const candidates = useMemo<ParamCandidate[]>(() => {
    const out: ParamCandidate[] = [];
    for (const n of nodes) {
      const schema = nodeRegistry.get(n.kind);
      const title = schema?.title ?? n.kind;
      const cfg = (n.config ?? {}) as Record<string, unknown>;
      for (const [key, value] of Object.entries(cfg)) {
        const t = typeof value;
        if (t !== "string" && t !== "number" && t !== "boolean") continue;
        // Prefer the node's declared control (keeps dropdowns/toggles) and
        // fall back to inferring from the JS type.
        const spec = schema?.configParams?.[key];
        out.push({
          nodeId: n.id,
          nodeTitle: title,
          key,
          inferred:
            spec?.control ??
            (t === "boolean" ? "toggle" : t === "number" ? "number" : "text"),
          ...(spec?.options ? { options: spec.options } : {}),
          ...(spec?.label ? { label: spec.label } : {}),
        });
      }
    }
    return out;
  }, [nodes]);

  if (candidates.length === 0) return null;

  function find(c: ParamCandidate) {
    return params.find(
      (p) => p.internalNodeId === c.nodeId && p.configKey === c.key,
    );
  }
  function toggle(c: ParamCandidate) {
    if (find(c)) {
      onChange(
        params.filter(
          (p) => !(p.internalNodeId === c.nodeId && p.configKey === c.key),
        ),
      );
    } else {
      onChange([
        ...params,
        {
          internalNodeId: c.nodeId,
          configKey: c.key,
          label: c.label ? `${c.nodeTitle} · ${c.label}` : `${c.nodeTitle} · ${c.key}`,
          control: c.inferred,
          ...(c.options ? { options: [...c.options] } : {}),
        },
      ]);
    }
  }
  function patch(c: ParamCandidate, next: Partial<RecipeExposedParam>) {
    onChange(
      params.map((p) =>
        p.internalNodeId === c.nodeId && p.configKey === c.key
          ? { ...p, ...next }
          : p,
      ),
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs">Controls ({params.length})</label>
      <p className="text-[11px] text-muted-foreground/70">
        Pick inner settings to surface on the recipe node, so they can be
        changed without opening it.
      </p>
      <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
        {candidates.map((c) => {
          const exposed = find(c);
          return (
            <li
              key={`${c.nodeId}::${c.key}`}
              data-testid={`save-recipe-param-${c.key}`}
              className="flex flex-col gap-1.5 rounded-md border border-border/60 bg-background/40 px-2 py-1.5"
            >
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={Boolean(exposed)}
                  onChange={() => toggle(c)}
                  className="h-3.5 w-3.5 rounded border border-border/60 bg-background/40"
                />
                <span className="font-medium text-foreground/85">{c.key}</span>
                <span className="text-[10px] text-muted-foreground/70">
                  {c.nodeTitle}
                </span>
              </label>
              {exposed ? (
                <div className="flex flex-wrap items-center gap-1.5 pl-5">
                  <Input
                    value={exposed.label}
                    onChange={(e) => patch(c, { label: e.target.value })}
                    aria-label={`Label for ${c.key}`}
                    className="h-7 flex-1 text-xs"
                  />
                  <select
                    value={exposed.control}
                    onChange={(e) =>
                      patch(c, {
                        control: e.target.value as RecipeExposedParam["control"],
                      })
                    }
                    aria-label={`Control type for ${c.key}`}
                    className="h-7 rounded-md border border-border/60 bg-background/40 px-1.5 text-xs"
                  >
                    <option value="text">text</option>
                    <option value="number">number</option>
                    <option value="toggle">toggle</option>
                    <option value="select">dropdown</option>
                  </select>
                  {exposed.control === "select" ? (
                    <Input
                      value={(exposed.options ?? []).join(", ")}
                      onChange={(e) =>
                        patch(c, {
                          options: e.target.value
                            .split(",")
                            .map((s) => s.trim())
                            .filter(Boolean),
                        })
                      }
                      placeholder="option1, option2, …"
                      aria-label={`Dropdown options for ${c.key}`}
                      className="h-7 w-full text-xs"
                    />
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function HandleRow({
  handle,
  onLabelChange,
  onRemove,
  testId,
}: {
  handle: RecipeExposedHandle;
  onLabelChange: (label: string) => void;
  onRemove: () => void;
  testId?: string;
}) {
  return (
    <li
      className="flex items-center gap-2 rounded-md border border-border/60 bg-background/40 px-2 py-1.5"
      data-testid={testId}
    >
      <Input
        value={handle.label}
        onChange={(e) => onLabelChange(e.target.value)}
        className="h-7 flex-1 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0"
      />
      <span className="rounded-md bg-foreground/[0.06] px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        {handle.dataType}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Remove from public surface"
        onClick={onRemove}
        className="h-5 w-5 text-muted-foreground hover:text-destructive"
      >
        <X className="h-3 w-3" />
      </Button>
    </li>
  );
}
