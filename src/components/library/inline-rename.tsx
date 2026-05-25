"use client";

import { useEffect, useRef, useState } from "react";

/**
 * InlineRename — shared component for "double-click a label to rename" UX.
 *
 * Slice 5.6f extracts the pattern that originally landed inline in
 * `asset-card.tsx`'s `GroupCardName` (Slice 5.6b) and was duplicated again
 * in `library-content.tsx`'s `GroupSubview` header. Both call sites now
 * delegate here so the keyboard / blur / cancel semantics live in one
 * place.
 *
 * Behaviour matches Finder + the original group-card pattern:
 *  - Double-click on the rendered label → enters edit mode, focuses input,
 *    selects the text.
 *  - Enter / blur → commit (only if non-empty + actually changed).
 *  - Escape → cancel without firing `onCommit`.
 *  - Pointer events on the input stop propagation so they don't trigger
 *    the parent card's click / drag handlers.
 *
 * The component is intentionally header-agnostic: caller passes a
 * `renderLabel` function so a group card can embed a "Untitled" badge,
 * a soul-id card can show a kind glyph, etc. The rename input itself
 * is the same minimal styled input.
 */

export interface InlineRenameProps {
  /** Current canonical name (also seeds the draft on edit start). */
  value: string;
  /**
   * Render the read-only label. Receives a `startEditing` callback that
   * the caller wires to `onDoubleClick` (or whatever entry gesture).
   * The component never opens edit mode by itself — caller has full
   * control over which gesture flips the switch.
   */
  renderLabel: (props: {
    startEditing: (event: React.MouseEvent) => void;
  }) => React.ReactNode;
  /**
   * Called once with a non-empty trimmed string when the user commits a
   * change. Caller is responsible for the actual mutation (store
   * action, API call, etc).
   */
  onCommit: (next: string) => void;
  /** ARIA label for the input, e.g. `Rename group Holiday photos`. */
  ariaLabel: string;
  /** Optional className for the input (caller can match card density). */
  inputClassName?: string;
  /**
   * Optional imperative trigger — when this ref's `.current` becomes
   * a function, calling it opens edit mode externally (e.g. from a
   * right-click menu's "Rename" item). Keeps the gesture model open
   * without forcing every consumer to lift `isEditing` into its own
   * state.
   */
  startEditingRef?: React.MutableRefObject<(() => void) | null>;
}

export function InlineRename({
  value,
  renderLabel,
  onCommit,
  ariaLabel,
  inputClassName,
  startEditingRef,
}: InlineRenameProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  // Expose an imperative entry point so a parent context-menu can
  // trigger rename without owning the editing state itself.
  useEffect(() => {
    if (!startEditingRef) return;
    startEditingRef.current = () => {
      setDraft(value);
      setIsEditing(true);
    };
    return () => {
      if (startEditingRef.current === startEditingRef.current) {
        startEditingRef.current = null;
      }
    };
  }, [startEditingRef, value]);

  function startEditing(e: React.MouseEvent) {
    e.stopPropagation();
    setDraft(value);
    setIsEditing(true);
  }

  function commit() {
    setIsEditing(false);
    const trimmed = draft.trim();
    if (trimmed.length > 0 && trimmed !== value) {
      onCommit(trimmed);
    }
  }

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setIsEditing(false);
          }
        }}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        aria-label={ariaLabel}
        data-testid="inline-rename-input"
        className={
          inputClassName ??
          "w-full rounded-sm bg-background/70 px-1 py-px text-[10.5px] text-foreground outline-none ring-1 ring-accent/60"
        }
      />
    );
  }

  return <>{renderLabel({ startEditing })}</>;
}
