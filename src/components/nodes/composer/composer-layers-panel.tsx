"use client";

import { ChevronDown, ChevronUp, Eye, EyeOff, Trash2 } from "lucide-react";

import {
  resolveLayerMediaType,
  resolveLayerUrl,
  type ComposerDocument,
  type ComposerInputRef,
  type ComposerLayer,
} from "@/types/composer";

/**
 * Composer layers panel — the z-ordered layer list (top layer first, like
 * every image editor). Visibility, reorder, select, delete. Opacity / blend /
 * transform live in the properties panel to keep rows scannable.
 */

interface ComposerLayersPanelProps {
  doc: ComposerDocument;
  inputs: Record<string, ComposerInputRef>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onPatchLayer: (id: string, patch: Partial<ComposerLayer>) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onRemove: (id: string) => void;
}

export function ComposerLayersPanel({
  doc,
  inputs,
  selectedId,
  onSelect,
  onPatchLayer,
  onMove,
  onRemove,
}: ComposerLayersPanelProps) {
  // Render top → bottom (reverse of the bottom-first document order).
  const rows = doc.layers.slice().reverse();
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border/40 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Layers
      </div>
      <div className="flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <p className="px-3 py-4 text-[11px] text-muted-foreground">
            No layers yet. Wire an image into the node, or add a solid / URL
            layer from the toolbar.
          </p>
        ) : (
          <ul className="flex flex-col">
            {rows.map((layer) => {
              const url =
                layer.source.kind === "solid"
                  ? null
                  : resolveLayerUrl(layer, inputs);
              const isVideo =
                layer.source.kind !== "solid" &&
                resolveLayerMediaType(layer, inputs) === "video";
              const active = layer.id === selectedId;
              // List index in the displayed (reversed) order.
              const arrayIndex = doc.layers.indexOf(layer);
              const isTop = arrayIndex === doc.layers.length - 1;
              const isBottom = arrayIndex === 0;
              return (
                <li
                  key={layer.id}
                  className={`flex items-center gap-2 border-b border-border/20 px-2 py-1.5 ${
                    active ? "bg-accent/10" : "hover:bg-foreground/[0.04]"
                  }`}
                >
                  <button
                    type="button"
                    aria-label={layer.visible ? "Hide layer" : "Show layer"}
                    onClick={() =>
                      onPatchLayer(layer.id, { visible: !layer.visible })
                    }
                    className="text-muted-foreground hover:text-foreground"
                  >
                    {layer.visible ? (
                      <Eye className="h-3.5 w-3.5" />
                    ) : (
                      <EyeOff className="h-3.5 w-3.5" />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => onSelect(layer.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <span
                      className="h-7 w-7 shrink-0 overflow-hidden rounded border border-border/40 bg-foreground/5"
                      style={
                        layer.source.kind === "solid"
                          ? { background: layer.source.color ?? "#000" }
                          : undefined
                      }
                    >
                      {url && isVideo ? (
                        <video
                          src={url}
                          muted
                          playsInline
                          preload="metadata"
                          className="h-full w-full object-cover"
                          draggable={false}
                        />
                      ) : url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={url}
                          alt=""
                          className="h-full w-full object-cover"
                          draggable={false}
                        />
                      ) : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11.5px] text-foreground/90">
                        {layer.name}
                      </span>
                      <span className="block truncate text-[10px] text-muted-foreground">
                        {layer.blendMode}
                        {layer.opacity < 1
                          ? ` · ${Math.round(layer.opacity * 100)}%`
                          : ""}
                      </span>
                    </span>
                  </button>

                  <div className="flex items-center">
                    <button
                      type="button"
                      aria-label="Move layer up"
                      disabled={isTop}
                      onClick={() => onMove(layer.id, 1)}
                      className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                    >
                      <ChevronUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label="Move layer down"
                      disabled={isBottom}
                      onClick={() => onMove(layer.id, -1)}
                      className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label="Delete layer"
                      onClick={() => onRemove(layer.id)}
                      className="p-0.5 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
