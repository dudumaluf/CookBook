"use client";

import { useRef, useState } from "react";
import { Link as LinkIcon, Loader2, Plus } from "lucide-react";
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
import { importImageFiles } from "@/lib/library/import-files";
import { useAssetStore } from "@/lib/stores/asset-store";

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
