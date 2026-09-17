"use client";

import { Trash2 } from "lucide-react";

import { CAMERA_ID, LOOK_AT_ID, type BlockingDocument } from "@/types/blocking";
import { cn } from "@/lib/utils";

import { GROUND_ID } from "./editor-actions";

const DRAG = "application/x-cookbook-blocking-child";

function Row({
  id,
  label,
  hint,
  selected,
  indent = 0,
  draggable,
  droppable,
  onPick,
  onParent,
  onDelete,
}: {
  id: string;
  label: string;
  hint?: string;
  selected: boolean;
  indent?: number;
  draggable?: boolean;
  droppable?: boolean;
  onPick: (id: string, event?: React.MouseEvent) => void;
  onParent: (child: typeof CAMERA_ID | typeof LOOK_AT_ID, parentId: string | null) => void;
  onDelete?: () => void;
}) {
  return (
    <div
      className={cn(
        "group flex items-center rounded-md",
        selected ? "bg-accent/25" : "hover:bg-foreground/[0.05]",
      )}
    >
      <button
        type="button"
        draggable={draggable}
        className="min-w-0 flex-1 px-2 py-1 text-left"
        style={{ paddingLeft: 8 + indent * 12 }}
        onClick={(e) => {
          e.preventDefault();
          onPick(id, e);
        }}
        onDragStart={(e) => {
          if (!draggable) return;
          e.dataTransfer.setData(DRAG, id);
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(e) => {
          if (!droppable) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }}
        onDrop={(e) => {
          if (!droppable) return;
          e.preventDefault();
          const child = e.dataTransfer.getData(DRAG);
          if (child === CAMERA_ID || child === LOOK_AT_ID) {
            onParent(child, id === "__stage" ? null : id);
          }
        }}
      >
        {label}
        {hint ? <span className="ml-1 text-muted-foreground">{hint}</span> : null}
      </button>
      {onDelete ? (
        <button
          type="button"
          aria-label={`Delete ${label}`}
          title="Delete"
          className="mr-1 rounded p-0.5 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      ) : null}
    </div>
  );
}

export function BlockingOutliner({
  doc,
  selectedId,
  selectedIds,
  onPick,
  onParent,
  onDelete,
}: {
  doc: BlockingDocument;
  selectedId: string | null;
  selectedIds?: readonly string[];
  onPick: (id: string, event?: React.MouseEvent) => void;
  onParent: (child: typeof CAMERA_ID | typeof LOOK_AT_ID, parentId: string | null) => void;
  onDelete?: (id: string) => void;
}) {
  const camParent = doc.camera.parentId;
  const lookParent = doc.camera.lookAtParentId;
  const picked = selectedIds ?? (selectedId ? [selectedId] : []);
  return (
    <aside className="flex w-48 shrink-0 select-none flex-col gap-1 overflow-y-auto border-r border-border/40 p-2 text-[11px]">
      <p className="px-2 pb-1 text-[10px] text-muted-foreground">
        Shift / ⌘ click to multi-select. Drag Camera / Look at onto an object to parent.
      </p>
      <Row
        id="__stage"
        label="Stage"
        selected={false}
        droppable
        onPick={() => undefined}
        onParent={onParent}
      />
      {!camParent ? (
        <Row
          id={CAMERA_ID}
          label="Camera"
          selected={picked.includes(CAMERA_ID)}
          draggable
          onPick={onPick}
          onParent={onParent}
        />
      ) : null}
      {!lookParent ? (
        <Row
          id={LOOK_AT_ID}
          label="Look at"
          selected={picked.includes(LOOK_AT_ID)}
          draggable
          onPick={onPick}
          onParent={onParent}
        />
      ) : null}
      {doc.objects.map((o) => (
        <div key={o.id} className="flex flex-col gap-0.5">
          <Row
            id={o.id}
            label={o.name}
            hint={o.kind}
            selected={picked.includes(o.id)}
            droppable
            onPick={onPick}
            onParent={onParent}
            onDelete={
              o.id !== GROUND_ID && onDelete
                ? () => onDelete(o.id)
                : undefined
            }
          />
          {camParent === o.id ? (
            <Row
              id={CAMERA_ID}
              label="Camera"
              selected={picked.includes(CAMERA_ID)}
              indent={1}
              draggable
              onPick={onPick}
              onParent={onParent}
            />
          ) : null}
          {lookParent === o.id ? (
            <Row
              id={LOOK_AT_ID}
              label="Look at"
              selected={picked.includes(LOOK_AT_ID)}
              indent={1}
              draggable
              onPick={onPick}
              onParent={onParent}
            />
          ) : null}
        </div>
      ))}
    </aside>
  );
}
