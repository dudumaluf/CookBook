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
        className="h-7 min-w-[180px] max-w-[420px] rounded-md border border-border bg-background px-2 text-center text-sm text-foreground outline-none focus:border-accent/60"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={startEditing}
      aria-label={`Rename project (currently ${name})`}
      className="h-7 max-w-[420px] truncate rounded-md px-2 text-sm text-foreground/90 transition-colors hover:bg-muted/40"
    >
      {name}
    </button>
  );
}
