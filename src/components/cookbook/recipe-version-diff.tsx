"use client";

import { Minus, Pencil, Plus } from "lucide-react";
import { useState } from "react";

import { diffSubgraphs, type SubgraphDiff } from "@/lib/recipes/diff-subgraphs";
import type { RecipeSubgraph } from "@/lib/repositories/recipe-repository";
import { cn } from "@/lib/utils";

interface RecipeVersionDiffProps {
  prev: RecipeSubgraph;
  next: RecipeSubgraph;
}

/**
 * `<RecipeVersionDiff />` — Cookbook Library Phase B2 (ADR-0060).
 *
 * Renders a plain-English summary of two subgraphs:
 *   - Added nodes (green +)
 *   - Removed nodes (red −)
 *   - Changed nodes (yellow ~), with per-field details and char-level
 *     text diff for prompt fields > 30 chars
 *   - Edge counts (added / removed)
 *
 * The component is intentionally read-only: no jump-to-canvas, no
 * blame-per-line, no copy-as-patch. The use case is "did the recipe
 * I'm using really change in a way I care about?" — answered by 5
 * seconds of reading. Heavier diff tooling can grow on top later.
 */
export function RecipeVersionDiff({ prev, next }: RecipeVersionDiffProps) {
  const diff: SubgraphDiff = diffSubgraphs(prev, next);

  if (diff.isEmpty) {
    return (
      <p
        data-testid="recipe-version-diff-empty"
        className="text-[11px] italic text-muted-foreground/60"
      >
        No structural changes between these versions.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3 text-[11px]" data-testid="recipe-version-diff">
      {diff.addedNodes.length > 0 ? (
        <DiffSection
          icon={<Plus className="h-3 w-3" />}
          tone="positive"
          title={`Added ${diff.addedNodes.length} node${diff.addedNodes.length === 1 ? "" : "s"}`}
        >
          {diff.addedNodes.map((n) => (
            <li key={n.id}>
              <span className="font-mono text-[10px] text-emerald-500/80">
                {n.kind}
              </span>{" "}
              <span className="text-foreground/80">{nodeLabel(n)}</span>
            </li>
          ))}
        </DiffSection>
      ) : null}

      {diff.removedNodes.length > 0 ? (
        <DiffSection
          icon={<Minus className="h-3 w-3" />}
          tone="negative"
          title={`Removed ${diff.removedNodes.length} node${diff.removedNodes.length === 1 ? "" : "s"}`}
        >
          {diff.removedNodes.map((n) => (
            <li key={n.id}>
              <span className="font-mono text-[10px] text-red-500/80">
                {n.kind}
              </span>{" "}
              <span className="text-foreground/80">{nodeLabel(n)}</span>
            </li>
          ))}
        </DiffSection>
      ) : null}

      {diff.changedNodes.length > 0 ? (
        <DiffSection
          icon={<Pencil className="h-3 w-3" />}
          tone="neutral"
          title={`Changed ${diff.changedNodes.length} node${diff.changedNodes.length === 1 ? "" : "s"}`}
        >
          {diff.changedNodes.map((c) => (
            <li key={c.node.id} className="flex flex-col gap-1.5">
              <span className="flex items-center gap-1.5">
                <span className="font-mono text-[10px] text-amber-500/90">
                  {c.node.kind}
                </span>
                <span className="text-foreground/80">{nodeLabel(c.node)}</span>
              </span>
              <ul className="ml-3 flex flex-col gap-1">
                {c.fields.map((f) => (
                  <FieldDelta key={f.key} field={f} />
                ))}
              </ul>
            </li>
          ))}
        </DiffSection>
      ) : null}

      {diff.addedEdges.length > 0 || diff.removedEdges.length > 0 ? (
        <p className="text-[10.5px] text-muted-foreground/80">
          Connections:{" "}
          {diff.addedEdges.length > 0 ? (
            <span className="text-emerald-500">
              +{diff.addedEdges.length}
            </span>
          ) : null}
          {diff.addedEdges.length > 0 && diff.removedEdges.length > 0
            ? " / "
            : null}
          {diff.removedEdges.length > 0 ? (
            <span className="text-red-500">−{diff.removedEdges.length}</span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

function DiffSection({
  icon,
  tone,
  title,
  children,
}: {
  icon: React.ReactNode;
  tone: "positive" | "negative" | "neutral";
  title: string;
  children: React.ReactNode;
}) {
  const toneCls =
    tone === "positive"
      ? "text-emerald-500"
      : tone === "negative"
        ? "text-red-500"
        : "text-amber-500";
  return (
    <div className="flex flex-col gap-1.5">
      <div
        className={cn(
          "flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-wider",
          toneCls,
        )}
      >
        {icon}
        {title}
      </div>
      <ul className="flex flex-col gap-1 pl-4 text-foreground/85">
        {children}
      </ul>
    </div>
  );
}

function FieldDelta({
  field,
}: {
  field: SubgraphDiff["changedNodes"][number]["fields"][number];
}) {
  const [expanded, setExpanded] = useState(false);
  if (field.textDiff) {
    const text = field.textDiff;
    return (
      <li className="flex flex-col gap-1">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80">
          {field.key}
        </span>
        <pre
          data-testid={`field-text-diff-${field.key}`}
          className={cn(
            "max-w-full whitespace-pre-wrap break-words rounded-md border border-border/40 bg-background/40 p-1.5 font-mono text-[10px] leading-relaxed",
            !expanded && "max-h-24 overflow-y-hidden",
          )}
        >
          {text.map((part, i) => (
            <span
              key={i}
              className={cn(
                part.added && "bg-emerald-500/15 text-emerald-500",
                part.removed && "bg-red-500/15 text-red-500 line-through",
                !part.added && !part.removed && "text-foreground/70",
              )}
            >
              {part.value}
            </span>
          ))}
        </pre>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="self-start text-[10px] text-muted-foreground hover:text-foreground"
        >
          {expanded ? "Show less" : "Show full"}
        </button>
      </li>
    );
  }
  return (
    <li className="flex flex-col gap-0.5">
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80">
        {field.key}
      </span>
      <span className="break-words text-[10.5px]">
        <span className="text-red-500/80 line-through">
          {formatValue(field.prev)}
        </span>{" "}
        →{" "}
        <span className="text-emerald-500">{formatValue(field.next)}</span>
      </span>
    </li>
  );
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v.length > 60 ? `${v.slice(0, 57)}…` : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    const json = JSON.stringify(v);
    return json.length > 60 ? `${json.slice(0, 57)}…` : json;
  } catch {
    return "(unrenderable)";
  }
}

function nodeLabel(n: { id: string; config?: unknown }): string {
  const cfg = (n.config ?? {}) as Record<string, unknown>;
  // Try common label fields in priority order. Falls back to the node
  // id (truncated) so every list item still has something to scan.
  const candidates = [cfg.title, cfg.label, cfg.name, cfg.purpose];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) {
      return c.length > 40 ? `${c.slice(0, 37)}…` : c;
    }
  }
  return n.id.length > 12 ? `${n.id.slice(0, 9)}…` : n.id;
}
