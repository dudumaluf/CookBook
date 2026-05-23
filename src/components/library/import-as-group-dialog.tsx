"use client";

import { useId, useState } from "react";
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
import {
  importImageFiles,
  importImageFilesAsGroup,
} from "@/lib/library/import-files";

interface ImportAsGroupDialogProps {
  /**
   * Files chosen by the user. `null` means "closed" — the parent
   * passes a non-null array on every fresh selection and clears back
   * to null after the dialog finishes (success / cancel).
   */
  files: File[] | null;
  onClose: () => void;
}

/**
 * Asks the user whether a multi-file import should land as N
 * separate `image` assets or as one named `asset-group` (Slice 5.6c,
 * ADR-0032). Only opens when 2+ files arrive — single-file imports
 * skip the dialog entirely (they go straight through
 * `importImageFiles`, no group affordance applies).
 *
 * Two actions: "Import as N separate images" (existing behaviour) and
 * "Import as group …". The group name input is pre-filled with the
 * `"Untitled"` default; the user can edit before hitting the button.
 *
 * The dialog doesn't manage its own open state — `files` controls it.
 * The parent (UploadAssetButton, LibraryContent's drop handler)
 * passes the selection in and clears it back to `null` once the
 * action completes or the user cancels. Body is rendered as a child
 * sub-component that's only mounted while `files !== null`, so its
 * local state initialises fresh on every open without needing an
 * effect-based sync (matches React 19's "useEffect for sync only"
 * lint rule).
 */
export function ImportAsGroupDialog({
  files,
  onClose,
}: ImportAsGroupDialogProps) {
  const open = files !== null;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Base UI emits `false` on overlay-click / Escape. We funnel
        // both through the parent's onClose.
        if (!next) onClose();
      }}
    >
      <DialogContent>
        {files !== null ? (
          <DialogBody files={files} onClose={onClose} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Body of the dialog. Mounted only while `files !== null` so its
 * `useState` initialiser runs once per fresh selection.
 */
function DialogBody({
  files,
  onClose,
}: {
  files: File[];
  onClose: () => void;
}) {
  const nameId = useId();
  const [groupName, setGroupName] = useState(deriveDefaultName(files));
  const [isWorking, setIsWorking] = useState(false);
  const count = files.length;

  async function handleImportSeparate() {
    setIsWorking(true);
    try {
      const result = await importImageFiles(files);
      if (result.created > 0) {
        toast.success(
          `${result.created} image${result.created === 1 ? "" : "s"} added to Library`,
        );
      }
      for (const err of result.errors) toast.error(err);
    } finally {
      setIsWorking(false);
      onClose();
    }
  }

  async function handleImportAsGroup() {
    setIsWorking(true);
    try {
      const result = await importImageFilesAsGroup(
        files,
        groupName.trim(),
      );
      if (result.created > 0 && result.groupId !== null) {
        toast.success(
          `Group "${groupName.trim() || "Untitled"}" created with ${result.created} image${result.created === 1 ? "" : "s"}`,
        );
      } else if (result.created > 0) {
        toast.success(
          `${result.created} image${result.created === 1 ? "" : "s"} added`,
        );
      } else {
        toast.error("No files imported — group not created");
      }
      for (const err of result.errors) toast.error(err);
    } finally {
      setIsWorking(false);
      onClose();
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Import {count} images</DialogTitle>
        <DialogDescription>
          Keep them as individual assets, or wrap them in a group so
          they stay organised together in the Library.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-3">
        <Button
          variant="outline"
          onClick={() => void handleImportSeparate()}
          disabled={isWorking}
          data-testid="import-as-separate-button"
          className="justify-start"
        >
          Import as {count} separate image{count === 1 ? "" : "s"}
        </Button>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={nameId}
            className="text-xs font-medium text-foreground/85"
          >
            Group name
          </label>
          <input
            id={nameId}
            type="text"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleImportAsGroup();
              }
            }}
            placeholder="Untitled"
            disabled={isWorking}
            className="h-9 w-full rounded-md border border-border/60 bg-background/40 px-2 text-sm outline-none focus:border-accent/60"
          />
          <Button
            onClick={() => void handleImportAsGroup()}
            disabled={isWorking}
            data-testid="import-as-group-button"
            className="self-start"
          >
            Import as group
          </Button>
        </div>
      </div>

      <DialogFooter>
        <Button
          variant="ghost"
          onClick={onClose}
          disabled={isWorking}
          data-testid="import-as-group-cancel"
        >
          Cancel
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * Pick a sensible default group name from the dropped files. Today
 * we just suggest "Untitled" — File doesn't expose folder context in
 * the standard DataTransfer API, and `webkitGetAsEntry()` would
 * require an async resolver path we don't need yet. The user can
 * always edit before hitting the button. Signature accepts the files
 * so a future implementation can derive a name from the filenames /
 * webkit folder path without the dialog body needing a refactor.
 */
function deriveDefaultName(files: File[]): string {
  void files;
  return "Untitled";
}
