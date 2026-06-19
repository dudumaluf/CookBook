"use client";

import { Download, ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback } from "react";
import { toast } from "sonner";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { downloadFromUrl, safeFilename } from "@/lib/library/download";

/**
 * ImageContextMenu — right-click affordance for ANY image preview rendered
 * in a node body. Wrap a preview surface and the user gets "Download PNG"
 * (fetch+blob so cross-origin Supabase/CDN URLs actually save instead of
 * navigating) and "Open in new tab".
 *
 * `display: contents` on the trigger keeps the wrapper visually invisible —
 * the child is the real element base-ui attaches the contextmenu listener
 * to — so it never disturbs the node's flex/aspect layout. Mirrors the
 * library `AssetContextMenu` pattern.
 */
export interface ImageContextMenuProps {
  /** Image URL the menu acts on. */
  url: string;
  /** Filename (sans extension) for the download. Defaults to "image". */
  downloadName?: string;
  children: ReactNode;
}

export function ImageContextMenu({
  url,
  downloadName,
  children,
}: ImageContextMenuProps) {
  const handleDownload = useCallback(async () => {
    try {
      await downloadFromUrl(url, `${safeFilename(downloadName ?? "image")}.png`);
    } catch (err) {
      console.warn("[image-context-menu] download failed:", err);
      toast.error("Could not download image");
    }
  }, [url, downloadName]);

  return (
    <ContextMenu>
      <ContextMenuTrigger style={{ display: "contents" }}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent data-testid="image-context-menu" className="min-w-40">
        <ContextMenuItem
          data-testid="image-context-menu-download"
          onClick={() => void handleDownload()}
        >
          <Download />
          Download PNG
        </ContextMenuItem>
        <ContextMenuItem
          data-testid="image-context-menu-open"
          onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
        >
          <ExternalLink />
          Open in new tab
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
