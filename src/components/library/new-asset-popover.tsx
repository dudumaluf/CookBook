"use client";

import { useState } from "react";
import { Image as ImageIcon, Plus } from "lucide-react";
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
import { useAssetStore } from "@/lib/stores/asset-store";

/**
 * NewAssetPopover
 *
 * Triggered by the "+" in the LibraryPanel header. Slice 2 only ships the
 * "Image from URL" path — Upload + Train Soul ID come later when their
 * pipelines exist. Designed so adding a tab/section per new asset kind is
 * mechanical.
 */
export function NewAssetPopover() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");

  const createImageAsset = useAssetStore((s) => s.createImageAsset);

  function reset() {
    setName("");
    setUrl("");
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return;
    const fallbackName =
      trimmedUrl.split("/").filter(Boolean).pop() ?? "Untitled";
    createImageAsset({
      name: name.trim() || fallbackName,
      url: trimmedUrl,
      tags: [],
      scope: "project",
    });
    toast.success("Asset added to Library");
    reset();
    setOpen(false);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground"
              aria-label="New asset"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>New asset</TooltipContent>
      </Tooltip>

      <PopoverContent side="right" align="start" className="w-[300px] p-3">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" />
            <span>New image asset</span>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-2">
            <Input
              autoFocus
              placeholder="Name (optional)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-8 text-xs"
            />
            <Input
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
              className="h-8"
              disabled={!url.trim()}
            >
              Create
            </Button>
          </form>

          <p className="text-[10.5px] leading-relaxed text-muted-foreground">
            Paste a public URL for now. Upload and Soul ID training land in a
            later slice.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
