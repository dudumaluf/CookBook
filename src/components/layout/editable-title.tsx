"use client";

import { useEffect, useRef, useState } from "react";

import { useProjectStore } from "@/lib/stores/project-store";

/**
 * EditableTitle
 *
 * Centered project title in the top bar. Click to edit inline (Notion-style):
 * the text becomes an input, focus selects all, Enter / blur commits, Escape
 * reverts.
 *
 * `draft` is only meaningful while `editing` is true; otherwise we render the
 * store value directly. This avoids any sync-on-effect anti-pattern.
 */
export function EditableTitle() {
  const { name, setName } = useProjectStore();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  function startEditing() {
    setDraft(name);
    setEditing(true);
  }

  function commit() {
    setName(draft);
    setEditing(false);
  }

  function cancel() {
    setEditing(false);
  }

  if (editing) {
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
            cancel();
          }
        }}
        aria-label="Project name"
        className="h-8 min-w-[200px] max-w-[420px] rounded-full border border-accent/60 bg-popover px-3 text-center text-sm text-foreground shadow-lg shadow-black/30 outline-none backdrop-blur-md"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={startEditing}
      aria-label={`Rename project (currently ${name})`}
      className="inline-flex h-8 max-w-[420px] items-center truncate rounded-full border border-border/70 bg-popover/95 px-3 text-sm text-foreground/90 shadow-lg shadow-black/30 backdrop-blur-md transition-colors hover:bg-popover"
    >
      {name}
    </button>
  );
}
