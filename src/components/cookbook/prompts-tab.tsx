"use client";

import {
  Bot,
  Cpu,
  ExternalLink,
  FileText,
  Package,
  Search,
  Wand2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { CopyButton } from "@/components/cookbook/copy-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useRecipes } from "@/lib/hooks/use-recipes";
import { extractAllRecipePrompts } from "@/lib/prompts/extract-from-recipe";
import { getCodePrompts } from "@/lib/prompts/registry";
import type { PromptEntry, PromptSection } from "@/lib/prompts/types";
import { useLayoutStore } from "@/lib/stores/layout-store";
import { cn } from "@/lib/utils";

type FilterId = "all" | PromptSection;

const FILTER_DEFS: { id: FilterId; label: string; description: string }[] = [
  {
    id: "all",
    label: "All",
    description: "Every prompt the app uses, in one place.",
  },
  {
    id: "assistant",
    label: "Assistant",
    description:
      "The chat assistant's foundational rulebook. Loaded before every conversation turn.",
  },
  {
    id: "recipe-internal",
    label: "Recipes",
    description:
      "Prompts baked inside saved recipes. Edit the recipe to change them.",
  },
  {
    id: "node-default",
    label: "Node defaults",
    description:
      "Starter text new nodes begin with. Each placed node gets its own copy you can change.",
  },
];

const ICON_BY_SECTION: Record<PromptSection, typeof FileText> = {
  assistant: Bot,
  "recipe-internal": Package,
  "node-default": Wand2,
};

/**
 * PromptsTab — Cookbook Library Phase A.
 *
 * One unified view across three sources of prompts in the system:
 *   1. Assistant — code-defined `REASONER_INSTRUCTIONS` (and future
 *      role overlays). Read-only in Phase A.
 *   2. Recipe-internal — every Text-node body + llm-text meta from
 *      every recipe the user can see. Each entry links back to its
 *      source recipe (Tab 1 jumps).
 *   3. Node defaults — starter prompts hardcoded in node specs.
 *      Empty in Phase A; the registry slot is reserved for later.
 *
 * Two-column layout matching RecipesTab. Search runs across title +
 * description + content, case-insensitive. Premium-UI principle "no
 * jargon": filter labels are user-facing names, not internal section
 * keys.
 */
export function PromptsTab() {
  const { data: recipes } = useRecipes();
  const setCookbookTab = useLayoutStore((s) => s.setCookbookTab);
  const [filter, setFilter] = useState<FilterId>("all");
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const allPrompts = useMemo<PromptEntry[]>(() => {
    const code = getCodePrompts();
    const recipePrompts = extractAllRecipePrompts(recipes, {
      includeLlmCalls: true,
    });
    return [...code, ...recipePrompts];
  }, [recipes]);

  const filteredPrompts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allPrompts.filter((p) => {
      if (filter !== "all" && p.section !== filter) return false;
      if (!q) return true;
      const haystack = `${p.title} ${p.description} ${p.content}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [allPrompts, filter, query]);

  // Auto-select first prompt to keep the right pane informative.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (filteredPrompts.length === 0) {
      if (selectedKey !== null) setSelectedKey(null);
      return;
    }
    const stillVisible = filteredPrompts.some((p) => p.key === selectedKey);
    if (!stillVisible) setSelectedKey(filteredPrompts[0]!.key);
  }, [filteredPrompts, selectedKey]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const selected = useMemo(
    () => filteredPrompts.find((p) => p.key === selectedKey) ?? null,
    [filteredPrompts, selectedKey],
  );

  return (
    <div className="grid h-full grid-cols-[minmax(280px,360px)_1fr] gap-0 overflow-hidden">
      {/* Left — list */}
      <aside className="flex h-full flex-col border-r border-border/60">
        <div className="flex flex-col gap-2 border-b border-border/40 p-3">
          <div className="flex items-center gap-2 rounded-md border border-border/80 bg-background px-2">
            <Search className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search prompts…"
              aria-label="Search prompts"
              className="h-8 border-0 px-0 text-sm shadow-none focus-visible:ring-0"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {FILTER_DEFS.map((f) => (
              <Button
                key={f.id}
                variant="ghost"
                size="sm"
                onClick={() => setFilter(f.id)}
                aria-pressed={filter === f.id}
                title={f.description}
                className={cn(
                  "h-7 rounded-full px-2.5 text-[11px]",
                  filter === f.id
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {f.label}
              </Button>
            ))}
            <span className="ml-auto text-[10.5px] tabular-nums text-muted-foreground/70">
              {filteredPrompts.length}
            </span>
          </div>
        </div>
        <ScrollArea className="flex-1">
          <div className="flex flex-col gap-1 p-2">
            {filteredPrompts.length === 0 ? (
              <p className="px-2 py-8 text-center text-xs text-muted-foreground">
                {query.trim() || filter !== "all"
                  ? "No matching prompts."
                  : "No prompts yet."}
              </p>
            ) : (
              filteredPrompts.map((p) => (
                <PromptCard
                  key={p.key}
                  prompt={p}
                  selected={p.key === selectedKey}
                  onSelect={() => setSelectedKey(p.key)}
                />
              ))
            )}
          </div>
        </ScrollArea>
      </aside>

      {/* Right — detail */}
      <section className="flex h-full flex-col overflow-hidden">
        {selected ? (
          <PromptDetail
            prompt={selected}
            onJumpToRecipe={() => {
              setCookbookTab("recipes");
              // recipes tab reads its own state; selecting the right
              // recipe is handled in Phase B's deeper integration. For
              // now we just hop to the Recipes tab.
            }}
          />
        ) : (
          <DetailEmptyState />
        )}
      </section>
    </div>
  );
}

function PromptCard({
  prompt,
  selected,
  onSelect,
}: {
  prompt: PromptEntry;
  selected: boolean;
  onSelect: () => void;
}) {
  const Icon = prompt.internalNodeKind === "llm-text"
    ? Cpu
    : ICON_BY_SECTION[prompt.section];
  const sectionLabel =
    FILTER_DEFS.find((f) => f.id === prompt.section)?.label ?? prompt.section;

  return (
    <button
      type="button"
      onClick={onSelect}
      data-testid={`cookbook-prompt-card-${prompt.key}`}
      className={cn(
        "group flex flex-col gap-1 rounded-lg border px-2.5 py-2 text-left transition-colors",
        selected
          ? "border-border bg-muted/60"
          : "border-transparent bg-transparent hover:bg-muted/30",
      )}
    >
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate text-xs font-medium text-foreground">
          {prompt.title}
        </span>
        <span className="rounded-sm border border-border/40 bg-background/80 px-1 py-px text-[9px] uppercase tracking-wider text-muted-foreground/80">
          {sectionLabel}
        </span>
      </div>
      <p className="line-clamp-2 text-[10.5px] leading-snug text-muted-foreground">
        {prompt.description}
      </p>
    </button>
  );
}

function PromptDetail({
  prompt,
  onJumpToRecipe,
}: {
  prompt: PromptEntry;
  onJumpToRecipe: () => void;
}) {
  const Icon = prompt.internalNodeKind === "llm-text"
    ? Cpu
    : ICON_BY_SECTION[prompt.section];

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-5 p-6">
        <header className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <h2 className="truncate text-base font-medium text-foreground">
                  {prompt.title}
                </h2>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {prompt.description}
              </p>
            </div>
            <CopyButton text={prompt.content} label="Copy prompt as plain text" />
          </div>

          {prompt.section === "recipe-internal" && prompt.recipeId ? (
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={onJumpToRecipe}
                className="gap-1.5 text-[11px]"
              >
                <ExternalLink className="h-3 w-3" />
                Open the recipe
              </Button>
              {prompt.recipeName ? (
                <span className="text-[11px] text-muted-foreground/80">
                  inside <strong className="font-medium text-foreground/80">{prompt.recipeName}</strong>
                </span>
              ) : null}
            </div>
          ) : null}
        </header>

        <Separator />

        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">
              Plain text
            </h3>
            <span className="text-[10.5px] tabular-nums text-muted-foreground/70">
              {prompt.content.length.toLocaleString()} chars
            </span>
          </div>
          <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-border/50 bg-background/40 p-4 font-mono text-[11.5px] leading-relaxed text-foreground/90">
            {prompt.content}
          </pre>
        </section>
      </div>
    </ScrollArea>
  );
}

function DetailEmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-12 text-center">
      <FileText className="h-7 w-7 text-muted-foreground/40" />
      <p className="text-sm text-muted-foreground">
        Select a prompt on the left to read its full text.
      </p>
      <p className="max-w-md text-[11px] leading-relaxed text-muted-foreground/70">
        Every prompt is plain text — copy it into ChatGPT, Claude, or any other
        LLM to discuss improvements. Phase B will let you edit prompts in
        recipes you own; Phase C lets you customize the assistant&apos;s base
        instructions.
      </p>
    </div>
  );
}
