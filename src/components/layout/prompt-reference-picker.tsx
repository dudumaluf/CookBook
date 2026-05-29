"use client";

import { Image as ImageIcon, Pencil, Search } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import type { PromptReference } from "@/lib/assistant/prompt-references";
import { assetMedia, assetUrl } from "@/lib/library/attach-file";
import { useGenerations } from "@/lib/hooks/use-generations";
import { getGenerationRepository } from "@/lib/repositories/supabase-generation-repository";
import type {
  GenerationFilter,
  GenerationRecord,
} from "@/lib/repositories/generation-repository";
import { useAssetStore } from "@/lib/stores/asset-store";
import { useProjectStore } from "@/lib/stores/project-store";
import { cn } from "@/lib/utils";
import type { StandardizedOutput } from "@/types/node";

/**
 * Prompt reference picker (the `@`-mention menu). A popover listing
 * everything the user can reference — Library assets + Gallery
 * generations — searchable by name/title, with quick inline rename so the
 * referenced item is easy to find later (renames the underlying asset /
 * generation title). Selecting a row inserts a reference chip.
 */

interface PickerRow {
  key: string;
  ref: PromptReference;
}

function genOutputFirst(
  output: GenerationRecord["output"],
): StandardizedOutput | null {
  const first = Array.isArray(output) ? output[0] : output;
  return first ?? null;
}

function genMedia(row: GenerationRecord): PromptReference["mediaType"] {
  const first = genOutputFirst(row.output);
  if (first?.type === "image") return "image";
  if (first?.type === "video") return "video";
  if (first?.type === "audio") return "audio";
  if (first?.type === "text") return "text";
  return "other";
}

function genUrl(row: GenerationRecord): string | undefined {
  const first = genOutputFirst(row.output);
  if (first && (first.type === "image" || first.type === "video" || first.type === "audio")) {
    return first.value?.url;
  }
  return undefined;
}

function genLabel(row: GenerationRecord): string {
  return row.title ?? row.promptText ?? row.nodeKind;
}

export function PromptReferencePicker({
  query,
  onPick,
  onClose,
}: {
  query: string;
  onPick: (ref: PromptReference) => void;
  onClose: () => void;
}) {
  const assets = useAssetStore((s) => s.assets);
  const updateAsset = useAssetStore((s) => s.updateAsset);
  const renameGroup = useAssetStore((s) => s.renameGroup);
  const projectId = useProjectStore((s) => s.id);
  const [localQuery, setLocalQuery] = useState(query);
  const searchRef = useRef<HTMLInputElement>(null);

  const genFilter = useMemo<GenerationFilter | null>(
    () => (projectId ? { projectId, limit: 60 } : null),
    [projectId],
  );
  const { data: generations, refresh: refreshGenerations } =
    useGenerations(genFilter);

  const q = localQuery.trim().toLowerCase();

  const assetRows = useMemo<PickerRow[]>(() => {
    return assets
      .filter((a) => !q || a.name.toLowerCase().includes(q))
      .slice(0, 40)
      .map((a) => ({
        key: `a:${a.id}`,
        ref: {
          id: `ref_${a.id}`,
          kind: "asset" as const,
          refId: a.id,
          label: a.name,
          mediaType: assetMedia(a.kind),
          ...(assetUrl(a) ? { url: assetUrl(a)! } : {}),
        },
      }));
  }, [assets, q]);

  const genRows = useMemo<PickerRow[]>(() => {
    return generations
      .filter((g) => !q || genLabel(g).toLowerCase().includes(q))
      .slice(0, 40)
      .map((g) => ({
        key: `g:${g.id}`,
        ref: {
          id: `ref_${g.id}`,
          kind: "generation" as const,
          refId: g.id,
          label: genLabel(g),
          mediaType: genMedia(g),
          ...(genUrl(g) ? { url: genUrl(g)! } : {}),
        },
      }));
  }, [generations, q]);

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  function commitRename(row: PickerRow) {
    const name = editValue.trim();
    setEditingKey(null);
    if (!name) return;
    if (row.ref.kind === "asset") {
      const asset = assets.find((a) => a.id === row.ref.refId);
      if (asset?.kind === "asset-group") renameGroup(asset.id, name);
      else updateAsset(row.ref.refId, { name });
    } else {
      void getGenerationRepository()
        .setTitle(row.ref.refId, name)
        .then(() => void refreshGenerations());
    }
  }

  function renderRow(row: PickerRow) {
    const editing = editingKey === row.key;
    return (
      <div
        key={row.key}
        className="group/ref flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-foreground/[0.06]"
      >
        <div className="h-7 w-7 shrink-0 overflow-hidden rounded bg-foreground/5">
          {row.ref.url && row.ref.mediaType === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={row.ref.url} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-muted-foreground/50">
              <ImageIcon className="h-3.5 w-3.5" />
            </span>
          )}
        </div>
        {editing ? (
          <Input
            autoFocus
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={() => commitRename(row)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename(row);
              if (e.key === "Escape") setEditingKey(null);
            }}
            className="h-7 flex-1 text-xs"
          />
        ) : (
          <button
            type="button"
            onClick={() => onPick(row.ref)}
            className="flex min-w-0 flex-1 flex-col items-start text-left"
          >
            <span className="w-full truncate text-xs text-foreground">
              {row.ref.label}
            </span>
            <span className="text-[10px] text-muted-foreground capitalize">
              {row.ref.mediaType} · {row.ref.kind}
            </span>
          </button>
        )}
        <button
          type="button"
          aria-label={`Rename ${row.ref.label}`}
          onClick={() => {
            setEditingKey(row.key);
            setEditValue(row.ref.label);
          }}
          className="shrink-0 text-muted-foreground/50 opacity-0 transition-opacity hover:text-foreground group-hover/ref:opacity-100"
        >
          <Pencil className="h-3 w-3" />
        </button>
      </div>
    );
  }

  const empty = assetRows.length === 0 && genRows.length === 0;

  return (
    <div
      data-testid="prompt-reference-picker"
      className="flex max-h-[320px] w-[320px] flex-col rounded-xl border border-border/70 bg-popover/98 shadow-2xl shadow-black/40 backdrop-blur-md"
    >
      <div className="flex items-center gap-1.5 border-b border-border/50 px-2.5 py-2">
        <Search className="h-3.5 w-3.5 text-muted-foreground/70" />
        <input
          ref={searchRef}
          autoFocus
          value={localQuery}
          onChange={(e) => setLocalQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
          }}
          placeholder="Reference an asset or result…"
          aria-label="Search references"
          className="flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>
      <div className="flex-1 overflow-y-auto p-1.5">
        {empty ? (
          <p className="px-2 py-4 text-center text-[11px] text-muted-foreground">
            Nothing to reference yet.
          </p>
        ) : (
          <>
            {assetRows.length > 0 ? (
              <Section label="Library" rows={assetRows} render={renderRow} />
            ) : null}
            {genRows.length > 0 ? (
              <Section label="Gallery" rows={genRows} render={renderRow} />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function Section({
  label,
  rows,
  render,
}: {
  label: string;
  rows: PickerRow[];
  render: (row: PickerRow) => React.ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <p className={cn("px-2 pb-0.5 pt-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70")}>
        {label}
      </p>
      {rows.map(render)}
    </div>
  );
}
