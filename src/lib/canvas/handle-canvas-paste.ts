/**
 * handle-canvas-paste
 *
 * Pure helpers for "user pressed ⌘V on the canvas with an image in
 * their clipboard". Wired by canvas-flow.tsx via a document-level
 * `paste` listener; the actual import + spawn flow goes through
 * `handleExternalFilesDrop` so the policy (MIME, size cap, asset →
 * node mapping) stays in one place.
 *
 * Two pure functions live here:
 *
 *   - `extractImagesFromClipboard`: walks `DataTransfer.files` first
 *     (modern browsers) then falls back to `DataTransfer.items` so
 *     Safari, which sometimes only populates `items` for clipboard
 *     images, isn't left out. Non-image files are ignored — the
 *     paste flow is image-only by design (drop is the multi-media
 *     path; paste is the "I copied an image off a webpage" path).
 *
 *   - `isEditablePasteTarget`: same input/textarea/contentEditable
 *     guard the keyboard clipboard handler uses, locally duplicated
 *     to keep the modules independent.
 *
 * Both are exported so unit tests can call them without mounting
 * React or constructing a real `ClipboardEvent`.
 */

export function extractImagesFromClipboard(
  data: DataTransfer | null,
): File[] {
  if (!data) return [];

  const out: File[] = [];

  // 1. Modern browsers expose pasted images directly on `files`.
  if (data.files && data.files.length > 0) {
    for (const f of Array.from(data.files)) {
      if (f.type.startsWith("image/")) out.push(f);
    }
    if (out.length > 0) return out;
  }

  // 2. Fallback for Safari and a few older WebKit-derived browsers
  //    where clipboard images land on `items` but not `files`.
  if (data.items && data.items.length > 0) {
    for (let i = 0; i < data.items.length; i += 1) {
      const item = data.items[i];
      if (!item) continue;
      if (item.kind !== "file") continue;
      if (!item.type.startsWith("image/")) continue;
      const f = item.getAsFile();
      if (f) out.push(f);
    }
  }

  return out;
}

export function isEditablePasteTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable === true
  );
}
