"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  Link as LinkIcon,
  Loader2,
  Plus,
  Sparkles,
  User,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  fetchSoulIds,
  HiggsfieldCallError,
} from "@/lib/higgsfield/call-higgsfield-image";
import { importImageFiles } from "@/lib/library/import-files";
import { useAssetStore } from "@/lib/stores/asset-store";
import type { HiggsfieldSoulIdSummary } from "@/lib/higgsfield/types";

/**
 * Two small composable buttons for the LibraryPanel header.
 *
 * Replaces the old `NewAssetPopover` which buried the OS file picker behind
 * a popover middleman — the 99% path was "click + → click Choose files →
 * OS picker", two clicks where one would do. Now:
 *
 *   `+`  → opens the OS file picker immediately (primary path)
 *   `🔗` → opens a tiny URL-only popover (rare paste path)
 *
 * Both routes feed the same `importImageFiles` pipeline, so MIME filtering,
 * size cap, and batched toast behaviour stay identical.
 */

/** Inline "uploading" badge so the user sees progress without a popover. */
function UploadingBadge() {
  return (
    <span className="ml-1 flex items-center gap-1 text-[10.5px] text-muted-foreground">
      <Loader2 className="h-3 w-3 animate-spin" />
      <span>Uploading…</span>
    </span>
  );
}

export function UploadAssetButton() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setIsUploading(true);
    let result;
    try {
      result = await importImageFiles(Array.from(files));
    } finally {
      setIsUploading(false);
    }
    if (result.created > 0) {
      toast.success(
        `${result.created} image${result.created === 1 ? "" : "s"} added to Library`,
      );
    }
    for (const err of result.errors) toast.error(err);
  }

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            disabled={isUploading}
            onClick={() => inputRef.current?.click()}
            className="h-6 w-6 text-muted-foreground"
            aria-label="Upload image from disk"
          >
            {isUploading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>Upload image(s) from disk</TooltipContent>
      </Tooltip>
      {isUploading ? <UploadingBadge /> : null}
      {/* Hidden, focus-skipped — the visible Button is the real control. */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => {
          void handleFiles(e.target.files);
          // Reset so re-selecting the same file fires another change.
          e.target.value = "";
        }}
      />
    </>
  );
}

export function AddAssetUrlButton() {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const createImageAssetFromUrl = useAssetStore(
    (s) => s.createImageAssetFromUrl,
  );

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;
    createImageAssetFromUrl({ url: trimmed, scope: "project" });
    toast.success("Asset added to Library");
    setUrl("");
    setOpen(false);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setUrl("");
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground"
              aria-label="Add image by URL"
            >
              <LinkIcon className="h-3.5 w-3.5" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Add image by URL</TooltipContent>
      </Tooltip>

      <PopoverContent side="right" align="start" className="w-[260px] p-3">
        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Image URL
          </label>
          <Input
            autoFocus
            type="url"
            placeholder="https://…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="h-8 text-xs"
            required
          />
          <Button
            type="submit"
            size="sm"
            className="h-7 self-end"
            disabled={!url.trim()}
          >
            Add URL
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/* Import Soul ID — picks from the user's trained Higgsfield characters */
/* ────────────────────────────────────────────────────────────────────── */

const VARIANT_LABEL: Record<HiggsfieldSoulIdSummary["modelVersion"], string> =
  {
    v2: "Soul 2",
    v1: "Soul 1",
    cinema: "Cinema",
  };

/**
 * Lists the Soul ID characters trained under the user's Higgsfield keypair
 * (via `GET /api/higgsfield/soul-ids` → server-side proxy of the Cloud API
 * `list custom-references` endpoint), and lets the user import one as a
 * library asset with a single click. Idempotent — re-importing an existing
 * Soul ID is a no-op (asset-store dedupes on `customReferenceId`).
 *
 * Slice 4.2c: this is the primary flow for getting Soul IDs into Cookbook.
 * Training new ones lands in M0b per the ROADMAP. Paste-by-UUID (an
 * additional escape hatch) can be layered on later if anyone ever asks.
 */
export function ImportSoulIdButton() {
  const [open, setOpen] = useState(false);
  // Bumped on each open to key the fetch effect; lets `items` and `error`
  // reset together via a fresh effect run instead of a synchronous-setState-
  // in-effect dance (which the React lint forbids).
  const [openSeq, setOpenSeq] = useState(0);
  const [items, setItems] = useState<HiggsfieldSoulIdSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingImportId, setPendingImportId] = useState<string | null>(null);

  const importSoulIdAsset = useAssetStore((s) => s.importSoulIdAsset);
  // Subscribe to the assets array (stable reference until the store mutates)
  // and derive the imported-ids set locally — Zustand's default equality is
  // referential, so returning a fresh array from the selector on every render
  // (e.g. via `.filter().map()`) loops the React tree. Subscribe to the raw
  // array, project after.
  const assets = useAssetStore((s) => s.assets);
  const importedSet = new Set(
    assets
      .filter((a) => a.kind === "soul-id")
      .map((a) => (a as { customReferenceId: string }).customReferenceId),
  );

  // Fetch on open. We reset `items`/`error` by keying off `openSeq` (bumped
  // by `handleOpenChange`) — that's why this effect doesn't itself call
  // setState synchronously. AbortController guards against a stale response
  // landing if the user closes/reopens mid-flight.
  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    fetchSoulIds(ctrl.signal)
      .then((list) => {
        if (ctrl.signal.aborted) return;
        setItems(list);
      })
      .catch((err: unknown) => {
        if ((err as Error)?.name === "AbortError") return;
        const msg =
          err instanceof HiggsfieldCallError && err.code === "missing_keys"
            ? "Set HIGGSFIELD_API_KEY + HIGGSFIELD_API_SECRET in .env.local."
            : err instanceof Error
              ? err.message
              : "Failed to load Soul IDs.";
        setError(msg);
      });
    return () => ctrl.abort();
    // openSeq is in the deps so each fresh open re-fires the fetch even when
    // `open` flips false→true and back without a deep state change.
  }, [open, openSeq]);

  function handleOpenChange(next: boolean) {
    if (next) {
      // Reset before the effect runs (synchronous, in an event handler —
      // not in an effect — so React's lint is happy).
      setItems(null);
      setError(null);
      setOpenSeq((n) => n + 1);
    }
    setOpen(next);
  }

  function handleImport(item: HiggsfieldSoulIdSummary) {
    setPendingImportId(item.id);
    try {
      importSoulIdAsset({
        customReferenceId: item.id,
        variant: item.modelVersion,
        name: item.name,
        thumbnailUrl: item.thumbnailUrl,
        scope: "global",
      });
      toast.success(`${item.name} added to Library`);
    } finally {
      setPendingImportId(null);
    }
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground"
              aria-label="Import Soul ID from Higgsfield"
            >
              <Sparkles className="h-3.5 w-3.5" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Import Soul ID from Higgsfield</TooltipContent>
      </Tooltip>

      <PopoverContent side="right" align="start" className="w-[300px] p-0">
        <div className="border-b border-border/50 px-3 py-2">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Your Soul IDs
          </div>
        </div>
        <div className="max-h-[320px] overflow-y-auto">
          {items === null && error === null ? (
            <div
              role="status"
              aria-label="Loading"
              className="flex items-center justify-center px-3 py-6 text-xs text-muted-foreground"
            >
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              Loading…
            </div>
          ) : error !== null ? (
            <div
              role="alert"
              className="flex items-start gap-2 px-3 py-3 text-xs text-destructive"
            >
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          ) : items && items.length === 0 ? (
            <div className="px-3 py-4 text-xs text-muted-foreground">
              No Soul IDs trained yet. Train one at{" "}
              <a
                href="https://higgsfield.ai"
                target="_blank"
                rel="noreferrer noopener"
                className="text-foreground underline-offset-2 hover:underline"
              >
                higgsfield.ai
              </a>{" "}
              and reopen this menu.
            </div>
          ) : (
            <ul className="flex flex-col">
              {items!.map((item) => {
                const alreadyImported = importedSet.has(item.id);
                const importing = pendingImportId === item.id;
                const usable = item.status === "completed";
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      disabled={
                        alreadyImported || importing || !usable
                      }
                      onClick={() => handleImport(item)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-foreground/[0.04] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
                    >
                      {item.thumbnailUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.thumbnailUrl}
                          alt={item.name}
                          className="h-9 w-9 shrink-0 rounded-md object-cover"
                        />
                      ) : (
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-foreground/10 text-muted-foreground">
                          <User className="h-4 w-4" />
                        </div>
                      )}
                      <div className="flex flex-1 flex-col gap-0.5 overflow-hidden">
                        <span className="truncate text-xs font-medium text-foreground">
                          {item.name}
                        </span>
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          {VARIANT_LABEL[item.modelVersion]}
                          {usable ? "" : ` · ${item.status}`}
                        </span>
                      </div>
                      {alreadyImported ? (
                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Check className="h-3 w-3" />
                          Imported
                        </span>
                      ) : importing ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
