"use client";

import { Loader2, RotateCcw, Save, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { getPromptOverridesRepository } from "@/lib/repositories/supabase-prompt-overrides-repository";
import {
  useAssistantPromptOverridesStore,
  useOverrideBody,
} from "@/lib/stores/assistant-prompt-overrides-store";
import { cn } from "@/lib/utils";

/**
 * Cookbook Library Phase C — `<PromptEditor />`.
 *
 * In-place editor for a code-defined prompt. Pre-fills the textarea
 * with the user's current override body (if any) or the bundled
 * default. Save → upserts via the prompt-overrides repository. Reset
 * → deletes the override row (back to default). Cancel → throws away
 * the in-progress edit.
 *
 * The "yours vs default" pane is intentionally a side-by-side diff
 * cue rather than a real diff view — when you're tweaking your own
 * prompt you usually want to see the default for reference, not get
 * lost in red/green line-by-line markup. If the user wants a diff
 * they copy both into a diff tool of their choice.
 */
export interface PromptEditorProps {
  promptKey: string;
  /** The bundled default body — shown in the right "Default" pane. */
  defaultContent: string;
  /** The current owner id (auth.uid()). Editor is disabled when null. */
  ownerId: string | null;
  /** Called when the user exits edit mode (Save success OR Cancel). */
  onClose: () => void;
}

export function PromptEditor({
  promptKey,
  defaultContent,
  ownerId,
  onClose,
}: PromptEditorProps) {
  const overrideBody = useOverrideBody(promptKey);
  const setOverrideLocal = useAssistantPromptOverridesStore(
    (s) => s.setOverrideLocal,
  );
  const removeOverrideLocal = useAssistantPromptOverridesStore(
    (s) => s.removeOverrideLocal,
  );

  const [body, setBody] = useState<string>(overrideBody ?? defaultContent);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // We deliberately do NOT re-seed `body` from `overrideBody` while
  // the editor is mounted — overwriting an in-progress edit because
  // a cross-tab save touched the row would be hostile UX. The
  // PromptDetail wrapper unmounts the editor on prompt switch (key
  // remount), and Save / Reset / Cancel always exit the editor.

  // Auto-focus the textarea on mount so the user can start typing
  // immediately. Cursor lands at the end (mid-text edits are common
  // for prompts; jumping to top is rarely what you want).
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const dirty = body !== (overrideBody ?? defaultContent);
  const sameAsDefault = body === defaultContent;

  async function handleSave() {
    if (!ownerId) {
      toast.error("Sign in to save your custom prompt.");
      return;
    }
    if (sameAsDefault) {
      toast.info(
        "Your edit matches the default — nothing to save. Click Reset to remove the override instead.",
      );
      return;
    }
    setSaving(true);
    try {
      await getPromptOverridesRepository().upsert(ownerId, promptKey, body);
      setOverrideLocal(promptKey, body);
      toast.success("Custom prompt saved.");
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Save failed";
      toast.error(`Couldn't save: ${msg}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    if (!ownerId) return;
    if (
      !window.confirm(
        "Reset this prompt to the bundled default? Your custom version will be deleted.",
      )
    ) {
      return;
    }
    setResetting(true);
    try {
      await getPromptOverridesRepository().remove(ownerId, promptKey);
      removeOverrideLocal(promptKey);
      toast.success("Reset to default.");
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Reset failed";
      toast.error(`Couldn't reset: ${msg}`);
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {/* Yours — editable */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-[10.5px] font-medium uppercase tracking-wider text-foreground">
              Yours
            </h4>
            <span className="text-[10px] tabular-nums text-muted-foreground/70">
              {body.length.toLocaleString()} chars
            </span>
          </div>
          <textarea
            ref={textareaRef}
            data-testid={`prompt-editor-textarea-${promptKey}`}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            spellCheck={false}
            className={cn(
              "min-h-[360px] w-full resize-y rounded-lg border border-border/60 bg-background/40 p-3 font-mono text-[11.5px] leading-relaxed text-foreground/90",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
            )}
            placeholder="Custom prompt body…"
          />
        </div>

        {/* Default — read-only reference */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">
              Default (read-only)
            </h4>
            <span className="text-[10px] tabular-nums text-muted-foreground/70">
              {defaultContent.length.toLocaleString()} chars
            </span>
          </div>
          <pre className="min-h-[360px] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-dashed border-border/40 bg-background/20 p-3 font-mono text-[11.5px] leading-relaxed text-muted-foreground/80">
            {defaultContent}
          </pre>
        </div>
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/40 pt-2">
        {overrideBody !== null ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReset}
            disabled={resetting || saving}
            className="gap-1.5 text-[11px]"
            data-testid={`prompt-editor-reset-${promptKey}`}
          >
            {resetting ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RotateCcw className="h-3 w-3" />
            )}
            Reset to default
          </Button>
        ) : null}
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          disabled={saving || resetting}
          className="gap-1.5 text-[11px]"
          data-testid={`prompt-editor-cancel-${promptKey}`}
        >
          <X className="h-3 w-3" />
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={!dirty || saving || resetting || sameAsDefault}
          className="gap-1.5 text-[11px]"
          data-testid={`prompt-editor-save-${promptKey}`}
        >
          {saving ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Save className="h-3 w-3" />
          )}
          Save custom
        </Button>
      </div>
    </div>
  );
}
