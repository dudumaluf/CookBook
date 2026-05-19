"use client";

import { useMemo, useState } from "react";
import {
  Plus,
  Type,
  Image as ImageIcon,
  Layers,
  Eye,
  Sparkles,
  Film,
  Combine,
  Download,
  Search,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useLayoutStore } from "@/lib/stores/layout-store";

interface NodeDef {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  category: string;
  status: "stub";
}

const NODE_CATALOG: NodeDef[] = [
  {
    id: "text",
    label: "Text",
    description: "Inline string editable in the node",
    icon: Type,
    category: "Inputs",
    status: "stub",
  },
  {
    id: "image",
    label: "Image",
    description: "Single image input or upload",
    icon: ImageIcon,
    category: "Inputs",
    status: "stub",
  },
  {
    id: "asset",
    label: "Asset",
    description: "Reference an item from the library",
    icon: Layers,
    category: "Inputs",
    status: "stub",
  },
  {
    id: "image-iterator",
    label: "Image iterator",
    description: "Collection of images that fan out downstream",
    icon: Layers,
    category: "Iterators",
    status: "stub",
  },
  {
    id: "vision-read",
    label: "Vision read",
    description: "Fal OpenRouter vision describes references",
    icon: Eye,
    category: "AI · Vision",
    status: "stub",
  },
  {
    id: "soul-image",
    label: "Soul image generation",
    description: "Higgsfield Soul ID image with structured prompt",
    icon: Sparkles,
    category: "AI · Generation",
    status: "stub",
  },
  {
    id: "nano-banana-edit",
    label: "Nano Banana edit",
    description: "Fal image edit with reference + instruction",
    icon: Sparkles,
    category: "AI · Generation",
    status: "stub",
  },
  {
    id: "seedance-video",
    label: "Seedance 2.0 video",
    description: "Photo → motion video",
    icon: Film,
    category: "AI · Video",
    status: "stub",
  },
  {
    id: "kling-video",
    label: "Kling 3 video",
    description: "Photo → motion video (Kling)",
    icon: Film,
    category: "AI · Video",
    status: "stub",
  },
  {
    id: "compositor",
    label: "Compositor",
    description: "Timeline compose of text, images, video",
    icon: Combine,
    category: "Compose",
    status: "stub",
  },
  {
    id: "export",
    label: "Export",
    description: "Save to disk + library",
    icon: Download,
    category: "Output",
    status: "stub",
  },
];

/**
 * AddNodeButton
 *
 * Small floating pill (bottom-left). Click → popover with categorized,
 * searchable node catalog. Everything is currently stubbed ("Available in
 * M0a") — the M0a milestone hooks each entry to the canvas.
 *
 * The right-click context menu on the canvas will reuse the same `NODE_CATALOG`.
 */
export function AddNodeButton() {
  const { addNodePopoverOpen, setAddNodePopoverOpen } = useLayoutStore();
  const [query, setQuery] = useState("");

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? NODE_CATALOG.filter(
          (n) =>
            n.label.toLowerCase().includes(q) ||
            n.description.toLowerCase().includes(q) ||
            n.category.toLowerCase().includes(q),
        )
      : NODE_CATALOG;
    const map = new Map<string, NodeDef[]>();
    for (const node of filtered) {
      const list = map.get(node.category) ?? [];
      list.push(node);
      map.set(node.category, list);
    }
    return Array.from(map.entries());
  }, [query]);

  return (
    <Popover open={addNodePopoverOpen} onOpenChange={setAddNodePopoverOpen}>
      <PopoverTrigger
        aria-label="Add a node (or right-click the canvas)"
        className="pointer-events-auto inline-flex h-9 items-center gap-1.5 rounded-full border border-border/80 bg-popover/95 px-3 text-sm text-foreground shadow-lg shadow-black/30 backdrop-blur-md transition-colors hover:bg-popover focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
      >
        <Plus className="h-3.5 w-3.5" />
        <span>Add node</span>
      </PopoverTrigger>

      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        className="w-[320px] p-0"
      >
        <div className="border-b border-border/60 p-2">
          <div className="flex items-center gap-2 rounded-md border border-border/80 bg-background px-2">
            <Search
              className="h-3.5 w-3.5 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
              placeholder="Search nodes…"
              aria-label="Search nodes"
              className="h-8 border-0 px-0 text-sm shadow-none focus-visible:ring-0"
            />
          </div>
        </div>
        <ScrollArea className="h-[300px]">
          <div className="flex flex-col gap-1 p-2">
            {grouped.length === 0 && (
              <p className="px-2 py-4 text-xs text-muted-foreground">
                No matches for &quot;{query}&quot;
              </p>
            )}
            {grouped.map(([category, nodes]) => (
              <div key={category} className="flex flex-col gap-0.5">
                <p className="px-2 pt-1.5 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {category}
                </p>
                {nodes.map((node) => (
                  <Button
                    key={node.id}
                    variant="ghost"
                    disabled
                    className="h-auto w-full justify-start gap-2 px-2 py-1.5 text-left"
                  >
                    <node.icon className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="flex min-w-0 flex-1 flex-col items-start">
                      <span className="text-xs text-foreground">
                        {node.label}
                      </span>
                      <span className="truncate text-[10px] text-muted-foreground">
                        {node.description}
                      </span>
                    </span>
                    <span className="rounded-sm border border-border/60 px-1 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
                      M0a
                    </span>
                  </Button>
                ))}
              </div>
            ))}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
