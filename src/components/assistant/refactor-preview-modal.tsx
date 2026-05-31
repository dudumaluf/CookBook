"use client";

import { AlertTriangle, ArrowRight, Loader2, MessageSquare, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { applyPendingRefactor } from "@/lib/assistant/refactor-apply";
import type { RefactorOperation } from "@/lib/assistant/refactor-types";
import { nodeRegistry } from "@/lib/engine/registry";
import { useAssistantStore } from "@/lib/stores/assistant-store";
import { useLayoutStore } from "@/lib/stores/layout-store";

/**
 * RefactorPreviewModal — Phase 3.
 *
 * Subscribes to `pendingRefactor` on the assistant store. When a
 * proposal lands with `status: "pending"`, the modal opens and shows:
 *   - The assistant's one-line summary at the top.
 *   - A diff-flavored bulleted list of the queued ops (color-coded
 *     adds / removes / updates).
 *   - Three buttons:
 *       - **Apply all** — atomic dispatch via `applyPendingRefactor()`.
 *       - **Cancel** — clear the proposal, no side effects.
 *       - **Edit in chat** — mark rejected, open the chat sheet so the
 *         user can ask the assistant to revise.
 *
 * On apply, the modal closes and a success / failure toast surfaces
 * the result. On any apply-time failure, the dispatcher rolls the
 * store back; we just report the error.
 *
 * Why mounted at app-level (not chat-sheet): the chat sheet returns
 * null when closed, which would unmount the modal too. A user could
 * collapse the chat, the assistant would still queue the refactor,
 * and the user would never see the modal. Living at always-rendered
 * scope keeps the apply gate reachable regardless of chat-sheet state.
 */

export function RefactorPreviewModal() {
  const pending = useAssistantStore((s) => s.pendingRefactor);
  const setPending = useAssistantStore((s) => s.setPendingRefactor);
  const setChatSheetOpen = useLayoutStore((s) => s.setChatSheetOpen);
  const [busy, setBusy] = useState(false);

  // Auto-close on `applied` so the user gets a moment of "applied!" toast
  // and the modal doesn't linger. We don't close on `failed` — the user
  // probably wants to read the error before dismissing.
  useEffect(() => {
    if (pending?.status === "applied") {
      const timer = setTimeout(() => setPending(null), 200);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [pending?.status, setPending]);

  if (!pending) return null;
  const open =
    pending.status === "pending" ||
    pending.status === "applying" ||
    pending.status === "failed";

  async function handleApply() {
    if (!pending) return;
    setBusy(true);
    try {
      const result = await applyPendingRefactor();
      if (result.ok) {
        toast.success(`Applied ${result.appliedCount} change${result.appliedCount === 1 ? "" : "s"}`);
      } else {
        toast.error(`Refactor failed: ${result.error ?? "unknown error"}`);
      }
    } finally {
      setBusy(false);
    }
  }

  function handleCancel() {
    if (!pending) return;
    setPending({ ...pending, status: "cancelled" });
    setPending(null);
  }

  function handleEditInChat() {
    if (!pending) return;
    setPending({ ...pending, status: "rejected" });
    setPending(null);
    setChatSheetOpen(true);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // The shadcn Dialog calls onOpenChange(false) when the user
        // clicks the backdrop or hits Escape. We map that to "cancel"
        // so the proposal doesn't hang around invisibly.
        if (!next) handleCancel();
      }}
    >
      <DialogContent
        data-testid="refactor-preview-modal"
        className="sm:max-w-[600px]"
      >
        <DialogHeader>
          <DialogTitle>Apply assistant refactor?</DialogTitle>
          <DialogDescription>{pending.summary}</DialogDescription>
        </DialogHeader>

        <div
          data-testid="refactor-preview-ops"
          className="-mx-4 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-4 py-1"
        >
          <p className="text-[10.5px] uppercase tracking-wider text-muted-foreground/70">
            {pending.operations.length} change
            {pending.operations.length === 1 ? "" : "s"} queued
          </p>
          <ul className="flex flex-col gap-1">
            {pending.operations.map((op, i) => (
              <li
                key={i}
                data-testid={`refactor-op-${i}`}
                className="flex items-start gap-2 rounded-md border border-border/60 bg-background/40 px-2 py-1.5 text-xs"
              >
                <OpIcon op={op} />
                <span className="flex-1 text-foreground/85">
                  <OpDescription op={op} />
                </span>
              </li>
            ))}
          </ul>
          {pending.status === "failed" && pending.error ? (
            <p
              data-testid="refactor-error"
              className="mt-2 flex items-start gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive/90"
            >
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{pending.error}</span>
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCancel}
            disabled={busy || pending.status === "applying"}
            data-testid="refactor-cancel"
          >
            Cancel
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleEditInChat}
            disabled={busy || pending.status === "applying"}
            data-testid="refactor-edit-in-chat"
          >
            <MessageSquare className="h-3 w-3" />
            Edit in chat
          </Button>
          <Button
            size="sm"
            onClick={() => void handleApply()}
            disabled={busy || pending.status === "applying"}
            data-testid="refactor-apply"
          >
            {busy || pending.status === "applying" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : null}
            Apply all
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OpIcon({ op }: { op: RefactorOperation }) {
  if (op.op === "add_node" || op.op === "add_edge") {
    return <Plus className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" />;
  }
  if (op.op === "remove_node" || op.op === "remove_edge") {
    return <Trash2 className="mt-0.5 h-3 w-3 shrink-0 text-destructive/80" />;
  }
  // update_node_config + move_node both modify in-place — neutral arrow.
  return <ArrowRight className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />;
}

function OpDescription({ op }: { op: RefactorOperation }) {
  switch (op.op) {
    case "add_node": {
      const schema = nodeRegistry.get(op.kind);
      const label = schema?.title ?? op.kind;
      return (
        <>
          Add{" "}
          <code className="rounded bg-foreground/5 px-1 py-px text-[10.5px]">
            {label}
          </code>
          {op.clientId ? (
            <>
              {" "}as{" "}
              <code className="rounded bg-foreground/5 px-1 py-px text-[10.5px]">
                {op.clientId}
              </code>
            </>
          ) : null}{" "}
          at ({Math.round(op.position.x)}, {Math.round(op.position.y)})
        </>
      );
    }
    case "remove_node":
      return (
        <>
          Remove node{" "}
          <code className="rounded bg-foreground/5 px-1 py-px text-[10.5px]">
            {op.nodeId}
          </code>
        </>
      );
    case "update_node_config": {
      const keys = Object.keys(op.config);
      return (
        <>
          Update{" "}
          <code className="rounded bg-foreground/5 px-1 py-px text-[10.5px]">
            {op.nodeId}
          </code>{" "}
          config: {keys.join(", ")}
        </>
      );
    }
    case "move_node":
      return (
        <>
          Move{" "}
          <code className="rounded bg-foreground/5 px-1 py-px text-[10.5px]">
            {op.nodeId}
          </code>{" "}
          to ({Math.round(op.position.x)}, {Math.round(op.position.y)})
        </>
      );
    case "add_edge":
      return (
        <>
          Connect{" "}
          <code className="rounded bg-foreground/5 px-1 py-px text-[10.5px]">
            {op.source}.{op.sourceHandle}
          </code>{" "}
          →{" "}
          <code className="rounded bg-foreground/5 px-1 py-px text-[10.5px]">
            {op.target}.{op.targetHandle}
          </code>
        </>
      );
    case "remove_edge":
      return (
        <>
          Remove edge{" "}
          <code className="rounded bg-foreground/5 px-1 py-px text-[10.5px]">
            {op.edgeId}
          </code>
        </>
      );
    default: {
      const _exhaustive: never = op;
      void _exhaustive;
      return null;
    }
  }
}
