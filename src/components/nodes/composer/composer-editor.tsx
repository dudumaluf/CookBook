"use client";

import { Plus, Square, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { ComposerLayersPanel } from "@/components/nodes/composer/composer-layers-panel";
import { ComposerPropertiesPanel } from "@/components/nodes/composer/composer-properties-panel";
import { ComposerStage } from "@/components/nodes/composer/composer-stage";
import { ComposerTimeline } from "@/components/nodes/composer/composer-timeline";
import {
  createLayer,
  docDurationMs,
  isTimelineMode,
  moveLayer,
  patchLayerTransform,
  updateLayerById,
  type ComposerDocument,
  type ComposerInputRef,
  type ComposerLayer,
  type LayerTransform,
} from "@/types/composer";

/**
 * Composer editor — the full-screen layered compositor surface (ADR-0085).
 *
 * Portaled to `document.body` (`z-[80]`) so it escapes React Flow's CSS
 * transform and covers the real viewport, mirroring `ImagePreviewModal`. Holds
 * a LOCAL working copy of the document for buttery direct manipulation and
 * commits it back (debounced) so dragging doesn't thrash the node's reactive
 * re-render / persistence. Keystrokes are swallowed so canvas shortcuts
 * (Delete / ⌘C) never fire underneath.
 */

interface ComposerEditorProps {
  doc: ComposerDocument;
  inputs: Record<string, ComposerInputRef>;
  onChange: (doc: ComposerDocument) => void;
  onClose: () => void;
}

const COMMIT_DEBOUNCE_MS = 120;

export function ComposerEditor({
  doc: initialDoc,
  inputs,
  onChange,
  onClose,
}: ComposerEditorProps) {
  // Local working copy: the editor is authoritative while open. External doc
  // changes (e.g. a new wire) are picked up on the next open, not mid-edit.
  const [doc, setDoc] = useState<ComposerDocument>(initialDoc);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialDoc.layers[initialDoc.layers.length - 1]?.id ?? null,
  );

  // Transport (only meaningful in timeline mode). The editor owns the master
  // clock; the stage + timeline both read `playheadMs`. While playing we advance
  // it off wall-clock via rAF and loop at the doc duration — a preview, not the
  // frame-exact Run render (ADR-0091).
  const timeline = isTimelineMode(doc);
  const durMs = docDurationMs(doc);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [playing, setPlaying] = useState(false);

  const docRef = useRef(doc);
  const onChangeRef = useRef(onChange);
  // Keep "latest" refs current in an effect — writing refs during render is
  // disallowed by the React lint rule.
  useEffect(() => {
    docRef.current = doc;
    onChangeRef.current = onChange;
  });

  // Debounced commit back to the node config.
  useEffect(() => {
    const t = setTimeout(
      () => onChangeRef.current(docRef.current),
      COMMIT_DEBOUNCE_MS,
    );
    return () => clearTimeout(t);
  }, [doc]);

  const close = useCallback(() => {
    onChangeRef.current(docRef.current); // flush pending edits
    onClose();
  }, [onClose]);

  // Clamp at READ time so a just-shortened duration never paints the playhead
  // past the end (avoids a setState-in-effect cascade). The rAF loop wraps with
  // `% durMs`, so the stored value only ever overshoots while paused.
  const clampedPlayheadMs =
    durMs > 0 ? Math.min(playheadMs, durMs) : playheadMs;

  // Master playback clock. Advances the playhead off wall-clock and loops; the
  // stage seeks/plays its <video> layers to match.
  useEffect(() => {
    if (!playing || durMs <= 0) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      setPlayheadMs((p) => {
        const next = p + dt;
        return next >= durMs ? next % durMs : next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, durMs]);

  const togglePlay = useCallback(() => setPlaying((p) => !p), []);
  const scrub = useCallback((ms: number) => {
    setPlaying(false);
    setPlayheadMs(ms);
  }, []);

  // Lock body scroll while the editor is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  /* ── mutators ── */
  const patchDoc = useCallback((patch: Partial<ComposerDocument>) => {
    setDoc((d) => ({ ...d, ...patch }));
  }, []);
  const patchLayer = useCallback(
    (id: string, patch: Partial<ComposerLayer>) => {
      setDoc((d) => ({ ...d, layers: updateLayerById(d.layers, id, patch) }));
    },
    [],
  );
  const patchTransform = useCallback(
    (id: string, patch: Partial<LayerTransform>) => {
      setDoc((d) => ({ ...d, layers: patchLayerTransform(d.layers, id, patch) }));
    },
    [],
  );
  const move = useCallback((id: string, direction: -1 | 1) => {
    setDoc((d) => ({ ...d, layers: moveLayer(d.layers, id, direction) }));
  }, []);
  const remove = useCallback((id: string) => {
    setDoc((d) => ({ ...d, layers: d.layers.filter((l) => l.id !== id) }));
    setSelectedId((cur) => (cur === id ? null : cur));
  }, []);
  const addLayer = useCallback((layer: ComposerLayer) => {
    setDoc((d) => ({ ...d, layers: [...d.layers, layer] }));
    setSelectedId(layer.id);
  }, []);

  const addSolid = useCallback(() => {
    addLayer(createLayer({ source: { kind: "solid", color: "#222222" }, fit: "stretch" }));
  }, [addLayer]);
  const addUrl = useCallback(() => {
    const url = window.prompt("Image URL");
    if (url && /^https?:\/\//i.test(url.trim())) {
      addLayer(createLayer({ source: { kind: "url", url: url.trim() } }));
    }
  }, [addLayer]);

  // Keyboard: swallow everything (so canvas shortcuts don't fire), handle a few.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement;
      const inField =
        el instanceof HTMLElement &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT" ||
          el.isContentEditable);
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      }
      if (inField) return;
      if (e.key === " " && isTimelineMode(docRef.current)) {
        e.preventDefault();
        e.stopPropagation();
        setPlaying((p) => !p);
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        e.preventDefault();
        e.stopPropagation();
        remove(selectedId);
        return;
      }
      const nudge =
        e.key === "ArrowLeft"
          ? [-1, 0]
          : e.key === "ArrowRight"
            ? [1, 0]
            : e.key === "ArrowUp"
              ? [0, -1]
              : e.key === "ArrowDown"
                ? [0, 1]
                : null;
      if (nudge && selectedId) {
        e.preventDefault();
        e.stopPropagation();
        const step = (e.shiftKey ? 0.05 : 0.01);
        const layer = docRef.current.layers.find((l) => l.id === selectedId);
        if (layer) {
          patchTransform(selectedId, {
            xPct: layer.transform.xPct + nudge[0]! * step,
            yPct: layer.transform.yPct + nudge[1]! * step,
          });
        }
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [close, remove, patchTransform, selectedId]);

  if (typeof document === "undefined") return null;

  const selected = doc.layers.find((l) => l.id === selectedId) ?? null;

  const toolBtn =
    "inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/40 px-2 py-1 text-[11px] text-foreground/80 hover:bg-foreground/[0.06]";

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Composer editor"
      data-testid="composer-editor"
      onPointerDown={(e) => e.stopPropagation()}
      className="fixed inset-0 z-[80] flex flex-col bg-background/97 backdrop-blur-md"
    >
      <header className="flex items-center gap-2 border-b border-border/40 px-3 py-2">
        <span className="text-[12px] font-semibold text-foreground">Composer</span>
        <span className="text-[11px] text-muted-foreground">
          {doc.layers.length} layer{doc.layers.length === 1 ? "" : "s"} ·{" "}
          {doc.width}×{doc.height}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <button type="button" className={toolBtn} onClick={addSolid}>
            <Square className="h-3 w-3" />
            Solid
          </button>
          <button type="button" className={toolBtn} onClick={addUrl}>
            <Plus className="h-3 w-3" />
            URL
          </button>
          <button
            type="button"
            aria-label="Close editor"
            onClick={close}
            className="ml-1 inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-foreground/[0.08]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="w-56 shrink-0 border-r border-border/40 bg-background/40">
          <ComposerLayersPanel
            doc={doc}
            inputs={inputs}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onPatchLayer={patchLayer}
            onMove={move}
            onRemove={remove}
          />
        </aside>

        <main className="min-w-0 flex-1">
          <ComposerStage
            doc={doc}
            inputs={inputs}
            selectedId={selectedId}
            playheadMs={clampedPlayheadMs}
            playing={playing}
            onSelect={setSelectedId}
            onTransform={patchTransform}
          />
        </main>

        <aside className="w-64 shrink-0 border-l border-border/40 bg-background/40">
          <ComposerPropertiesPanel
            doc={doc}
            selected={selected}
            inputs={inputs}
            onPatchDoc={patchDoc}
            onPatchLayer={patchLayer}
            onPatchTransform={patchTransform}
          />
        </aside>
      </div>

      {timeline ? (
        <ComposerTimeline
          doc={doc}
          inputs={inputs}
          playheadMs={clampedPlayheadMs}
          playing={playing}
          selectedId={selectedId}
          onScrub={scrub}
          onTogglePlay={togglePlay}
          onSelect={setSelectedId}
          onPatchLayer={patchLayer}
          onPatchDoc={patchDoc}
        />
      ) : null}
    </div>,
    document.body,
  );
}
