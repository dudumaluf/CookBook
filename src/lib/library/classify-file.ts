/**
 * classify-file
 *
 * Single source of truth for "what kind of node should this dropped /
 * pasted file become?". The library import pipeline already classifies
 * by MIME prefix, but it operates on already-filtered lists; this
 * helper handles a *single* unknown File and falls back to the
 * extension when `file.type` is empty (which happens on some OSes /
 * some clipboard sources).
 *
 * Add new kinds here when introducing new media inputs to the canvas
 * (e.g. 3D files, document → text-from-file, etc.).
 */

export type DroppedFileKind = "image" | "video" | "audio" | "unsupported";

const IMAGE_EXTS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "svg",
  "avif",
  "heic",
  "heif",
]);

const VIDEO_EXTS = new Set([
  "mp4",
  "mov",
  "webm",
  "mkv",
  "m4v",
  "avi",
]);

const AUDIO_EXTS = new Set([
  "mp3",
  "wav",
  "ogg",
  "m4a",
  "flac",
  "aac",
  "opus",
]);

export function classifyDroppedFile(file: File): DroppedFileKind {
  const mime = file.type ?? "";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";

  // Some OS / clipboard sources strip `type` (notably Safari with
  // certain clipboard images, and a few legacy file dialogs). Fall back
  // to the extension so a `.png` without a MIME still becomes an image.
  const name = (file.name ?? "").toLowerCase();
  const dot = name.lastIndexOf(".");
  if (dot < 0) return "unsupported";
  const ext = name.slice(dot + 1);
  if (IMAGE_EXTS.has(ext)) return "image";
  if (VIDEO_EXTS.has(ext)) return "video";
  if (AUDIO_EXTS.has(ext)) return "audio";
  return "unsupported";
}
