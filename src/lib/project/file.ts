"use client";

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

import {
  uploadImageAsset,
  uploadMediaAsset,
} from "@/lib/library/upload-asset";
import type { ProjectState } from "@/lib/repositories/project-repository";
import { getProjectRepository } from "@/lib/repositories/supabase-project-repository";

import {
  migrateProjectDocument,
  type ProjectDocument,
} from "./document";

/**
 * Project file portability (Phase 4) — "save / open a project as a file"
 * so users aren't locked to the cloud.
 *
 * Two formats, both `.cookbook`:
 *   - JSON (`<name>.cookbook`): the document with media as URLs. Light,
 *     instant; viewing media depends on the bucket URLs staying alive.
 *   - Bundle (`<name>.cookbook.zip`): `project.json` + a `media/` folder
 *     with the actual bytes, URLs rewritten to relative paths. Fully
 *     self-contained — opens anywhere, independent of Supabase.
 *
 * The pure core (collect / rewrite / build / read) takes its IO (fetch +
 * upload) as parameters so it's testable without a network or a bucket.
 */

const URL_RE = /^https?:\/\//i;

/** Deep-walk a value, collecting unique http(s) string URLs. */
function deepCollectUrls(node: unknown, acc: Set<string>): void {
  if (typeof node === "string") {
    if (URL_RE.test(node)) acc.add(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) deepCollectUrls(item, acc);
    return;
  }
  if (node && typeof node === "object") {
    for (const value of Object.values(node)) deepCollectUrls(value, acc);
  }
}

/** Every http(s) URL referenced anywhere in the document (graph + assets + results). */
export function collectMediaUrls(doc: ProjectDocument): string[] {
  const acc = new Set<string>();
  deepCollectUrls(doc, acc);
  return [...acc];
}

/** Deep-clone a value, replacing any string found in `map`. */
function deepRewrite(node: unknown, map: Map<string, string>): unknown {
  if (typeof node === "string") return map.get(node) ?? node;
  if (Array.isArray(node)) return node.map((item) => deepRewrite(item, map));
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) out[k] = deepRewrite(v, map);
    return out;
  }
  return node;
}

/** Rewrite every URL/path in the document per `map` (url -> path, or path -> url). */
export function rewriteUrls(
  doc: ProjectDocument,
  map: Map<string, string>,
): ProjectDocument {
  return deepRewrite(doc, map) as ProjectDocument;
}

/* ──────────────────── extensions / mime ──────────────────── */

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
};

function extFor(url: string, mime: string): string {
  const fromMime = Object.entries(MIME_BY_EXT).find(([, m]) => m === mime)?.[0];
  if (fromMime) return fromMime;
  const tail = url.split("?")[0]!.split(".").pop()?.toLowerCase();
  if (tail && tail.length <= 4 && MIME_BY_EXT[tail]) return tail;
  return "bin";
}

function mimeForPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

/* ──────────────────── bundle build / read (pure core) ──────────────────── */

export interface FetchedMedia {
  bytes: Uint8Array;
  mime: string;
}

/**
 * Build a self-contained `.zip` bundle. `fetchBytes` returns the media
 * bytes for a URL (or null to leave it as a remote URL — failed/expired
 * fetches degrade gracefully).
 */
export async function buildProjectBundle(
  doc: ProjectDocument,
  fetchBytes: (url: string) => Promise<FetchedMedia | null>,
): Promise<Uint8Array> {
  const urls = collectMediaUrls(doc);
  const files: Record<string, Uint8Array> = {};
  const map = new Map<string, string>();
  let i = 0;
  for (const url of urls) {
    let fetched: FetchedMedia | null = null;
    try {
      fetched = await fetchBytes(url);
    } catch {
      fetched = null;
    }
    if (!fetched) continue;
    const path = `media/${String(i).padStart(4, "0")}.${extFor(url, fetched.mime)}`;
    files[path] = fetched.bytes;
    map.set(url, path);
    i += 1;
  }
  const rewritten = rewriteUrls(doc, map);
  files["project.json"] = strToU8(JSON.stringify(rewritten, null, 2));
  return zipSync(files);
}

/**
 * Read a `.zip` bundle back into a document. `uploadBytes` re-hosts each
 * bundled media file (returns its new durable URL); the doc's relative
 * `media/...` paths are rewritten back to those URLs.
 */
export async function readProjectBundle(
  bytes: Uint8Array,
  uploadBytes: (path: string, data: Uint8Array, mime: string) => Promise<string>,
): Promise<ProjectDocument> {
  const entries = unzipSync(bytes);
  const projectJson = entries["project.json"];
  if (!projectJson) {
    throw new Error("Invalid .cookbook bundle: missing project.json");
  }
  let doc = migrateProjectDocument(JSON.parse(strFromU8(projectJson)));
  const map = new Map<string, string>();
  for (const [path, data] of Object.entries(entries)) {
    if (!path.startsWith("media/")) continue;
    const mime = mimeForPath(path);
    const url = await uploadBytes(path, data, mime);
    map.set(path, url);
  }
  doc = rewriteUrls(doc, map);
  return doc;
}

/* ──────────────────── browser IO wrappers ──────────────────── */

function sanitizeName(name: string): string {
  const base = name.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-");
  return base.replace(/^-+|-+$/g, "").slice(0, 80) || "project";
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Download the lightweight JSON `.cookbook` document. */
export function exportProjectJson(doc: ProjectDocument): void {
  const blob = new Blob([JSON.stringify(doc, null, 2)], {
    type: "application/json",
  });
  downloadBlob(blob, `${sanitizeName(doc.projectName)}.cookbook`);
}

/** Download the self-contained `.zip` bundle (media embedded). */
export async function exportProjectBundle(doc: ProjectDocument): Promise<void> {
  const bytes = await buildProjectBundle(doc, async (url) => {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    return {
      bytes: buf,
      mime: res.headers.get("content-type") ?? "",
    };
  });
  // Copy into a fresh ArrayBuffer-backed view so the Blob constructor is happy.
  downloadBlob(new Blob([bytes.slice()], { type: "application/zip" }), `${sanitizeName(doc.projectName)}.cookbook.zip`);
}

/**
 * Open a `.cookbook` (JSON) or `.cookbook.zip` (bundle) file and return a
 * migrated document. Bundle media is re-hosted into the user's bucket so
 * its URLs are durable again.
 */
export async function importProjectFile(file: File): Promise<ProjectDocument> {
  const isZip =
    file.name.endsWith(".zip") ||
    file.type.includes("zip") ||
    file.type === "application/octet-stream";
  if (isZip) {
    const buf = new Uint8Array(await file.arrayBuffer());
    return readProjectBundle(buf, async (path, data, mime) => {
      const name = path.split("/").pop() ?? "media.bin";
      const f = new File([data.slice()], name, { type: mime });
      if (mime.startsWith("video")) return (await uploadMediaAsset(f, "videos")).url;
      if (mime.startsWith("audio")) return (await uploadMediaAsset(f, "audio")).url;
      return (await uploadImageAsset(f)).url;
    });
  }
  const text = await file.text();
  return migrateProjectDocument(JSON.parse(text));
}

/**
 * Import a project file and persist it as a NEW cloud project owned by the
 * user (so it lives on the platform too). Returns the new project id for
 * the caller to navigate to.
 */
export async function importProjectToCloud(
  file: File,
  ownerId: string,
): Promise<string> {
  const doc = await importProjectFile(file);
  const rec = await getProjectRepository().save({
    ownerId,
    name: doc.projectName || "Imported Project",
    state: doc as unknown as ProjectState,
  });
  return rec.id;
}
