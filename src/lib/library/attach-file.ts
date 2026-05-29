import type {
  PromptReference,
  PromptReferenceMedia,
} from "@/lib/assistant/prompt-references";
import { useAssetStore } from "@/lib/stores/asset-store";
import type { Asset } from "@/types/asset";

/**
 * Attach-file (chat attachments). Uploads a file the user dropped/pasted
 * into the prompt bar to the Library (so it becomes a real, durable,
 * wireable asset) and returns a `PromptReference` chip for it.
 */

function mediaFromMime(mime: string): "image" | "video" | "audio" | "other" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "other";
}

export function assetMedia(kind: Asset["kind"]): PromptReferenceMedia {
  if (kind === "asset-group") return "group";
  if (kind === "soul-id") return "soul-id";
  return kind;
}

export function assetUrl(asset: Asset | undefined): string | undefined {
  if (!asset) return undefined;
  if (asset.kind === "soul-id") return asset.thumbnailUrl ?? undefined;
  if (asset.kind === "asset-group") return undefined;
  return asset.source.url;
}

function refId(): string {
  return `ref_${Math.random().toString(36).slice(2, 9)}`;
}

/** Build a reference chip from an existing Library asset. */
export function assetToReference(asset: Asset): PromptReference {
  return {
    id: refId(),
    kind: "asset",
    refId: asset.id,
    label: asset.name,
    mediaType: assetMedia(asset.kind),
    ...(assetUrl(asset) ? { url: assetUrl(asset) } : {}),
  };
}

/**
 * Upload a single dropped/pasted file into the Library and return its
 * reference chip. Returns null for unsupported types.
 */
export async function attachFileAsReference(
  file: File,
): Promise<PromptReference | null> {
  const media = mediaFromMime(file.type);
  const store = useAssetStore.getState();
  let assetId: string;
  if (media === "image") {
    assetId = await store.createImageAssetFromFile(file);
  } else if (media === "video" || media === "audio") {
    assetId = await store.createMediaAssetFromFile(file, media);
  } else {
    return null;
  }
  const asset = useAssetStore.getState().getAsset(assetId);
  return asset
    ? assetToReference(asset)
    : {
        id: refId(),
        kind: "asset",
        refId: assetId,
        label: file.name,
        mediaType: media,
      };
}
