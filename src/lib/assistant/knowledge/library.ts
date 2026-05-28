import { useAssetStore } from "@/lib/stores/asset-store";
import type {
  AssetGroupAsset,
  ImageAsset,
  SoulIdAsset,
} from "@/types/asset";

/**
 * Knowledge dimension: library state — Slice 7.2 (ADR-0041).
 *
 * Compact summary of the user's asset library so the assistant can
 * answer "which Soul IDs do I have?" / "do I have any beach photos?"
 * without dumping every URL into the prompt.
 *
 * Each section is capped to the first 25 entries — anything over that
 * sums up as "(25 of N total)". The assistant calls `read_library`
 * (Slice 7.2 read tool) when it needs the full list.
 *
 * Format:
 *   ## LIBRARY (X assets total)
 *
 *   Soul IDs (3):
 *     - asset-uuid-1: "Dudu Model" (v2)
 *     - asset-uuid-2: "Jane" (cinema)
 *
 *   Groups (2):
 *     - asset-uuid-7: "Editorial refs" (12 images)
 *
 *   Images (87) (25 of 87 listed):
 *     - asset-uuid-A: "matthew_walking.jpg"
 *     - ...
 */

const PER_SECTION_LIMIT = 25;

function formatSoulId(asset: SoulIdAsset): string {
  return `  - ${asset.id}: "${asset.name}" (${asset.variant})`;
}

function formatImage(asset: ImageAsset): string {
  return `  - ${asset.id}: "${asset.name}"`;
}

function formatGroup(group: AssetGroupAsset): string {
  return `  - ${group.id}: "${group.name}" (${group.assetIds.length} images)`;
}

export function buildLibraryKnowledge(): string {
  const assets = useAssetStore.getState().assets;
  if (assets.length === 0) {
    return `## LIBRARY\n_(empty — no assets uploaded yet)_`;
  }

  const soulIds = assets.filter(
    (a): a is SoulIdAsset => a.kind === "soul-id",
  );
  const groups = assets.filter(
    (a): a is AssetGroupAsset => a.kind === "asset-group",
  );
  const images = assets.filter((a): a is ImageAsset => a.kind === "image");

  const lines: string[] = [`## LIBRARY (${assets.length} assets total)`];

  if (soulIds.length > 0) {
    lines.push("", `Soul IDs (${soulIds.length}):`);
    for (const a of soulIds.slice(0, PER_SECTION_LIMIT)) {
      lines.push(formatSoulId(a));
    }
    if (soulIds.length > PER_SECTION_LIMIT) {
      lines.push(`  …and ${soulIds.length - PER_SECTION_LIMIT} more`);
    }
  }

  if (groups.length > 0) {
    lines.push("", `Groups (${groups.length}):`);
    for (const g of groups.slice(0, PER_SECTION_LIMIT)) {
      lines.push(formatGroup(g));
    }
    if (groups.length > PER_SECTION_LIMIT) {
      lines.push(`  …and ${groups.length - PER_SECTION_LIMIT} more`);
    }
  }

  if (images.length > 0) {
    const showing = Math.min(images.length, PER_SECTION_LIMIT);
    const summary =
      images.length > PER_SECTION_LIMIT
        ? `${showing} of ${images.length} listed`
        : `${images.length}`;
    lines.push("", `Images (${summary}):`);
    for (const a of images.slice(0, PER_SECTION_LIMIT)) {
      lines.push(formatImage(a));
    }
    if (images.length > PER_SECTION_LIMIT) {
      lines.push(`  …and ${images.length - PER_SECTION_LIMIT} more`);
    }
  }

  return lines.join("\n");
}
