"use client";

import { Check, Save } from "lucide-react";

import { defineNode } from "@/lib/engine/define-node";
import { extractInputArrayByType } from "@/lib/engine/extract-input";
import { uploadImageFromUrl } from "@/lib/library/upload-asset";
import { useAssetStore } from "@/lib/stores/asset-store";
import type { NodeBodyProps } from "@/types/node";

/**
 * Export — output node that saves piped-in images to the user's Library.
 *
 * The terminal step of the Soul Image Burst recipe: 4 (or 8, 32…)
 * generated images flow into Export's `in` handle, and Export downloads
 * each one, re-uploads the bytes to our own Supabase bucket, and creates
 * a `remote`-source ImageAsset in the library so the user keeps a durable
 * copy (Higgsfield URLs are CloudFront-cached but not user-owned; Fal
 * results are similarly temporary).
 *
 * Slice 4.5: only `destination: "library"` ships. `"download"` (OS save
 * dialog) is straightforward but parks for later — once the queue panel
 * shows thumbnails (Slice 5), users can right-click a result without
 * needing this affordance.
 *
 * No outputs — pure side effect. The body shows a small status hint
 * pulled from the live ExecutionRecord ("Saving 2/4…", "Saved 4 images
 * to Library", or an error pill).
 */
export interface ExportNodeConfig {
  /**
   * Tag prefix added to each saved asset's `tags` array. Useful when the
   * user wants to find all images from a given recipe run later. Empty
   * string → no tag added.
   */
  tag?: string;
  /**
   * Per-asset name prefix. Each saved asset's name becomes
   * `${namePrefix} ${i+1}` (or just `${i+1}` if empty). Defaults to
   * "Generated" so the library reads sensibly out of the box.
   */
  namePrefix?: string;
}

const DEFAULT_NAME_PREFIX = "Generated";

function ExportNodeBody({}: NodeBodyProps<ExportNodeConfig>) {
  return (
    <div className="flex w-full min-w-[220px] flex-col gap-1.5 px-3 pb-2.5 pt-0.5">
      <div className="flex items-center gap-2 rounded-md bg-foreground/[0.04] px-2 py-2 text-[11px] text-muted-foreground">
        <Save className="h-3 w-3 text-accent" />
        <span>Saves the wired images into the Library on Run.</span>
      </div>
    </div>
  );
}

export const exportNodeSchema = defineNode<ExportNodeConfig>({
  kind: "export",
  category: "output",
  title: "Export",
  description:
    "Save the wired images into your Library. Each piped-in image lands as a Library asset you can reuse in any project.",
  icon: Check,
  inputs: [
    { id: "in", label: "in", dataType: "image", multiple: true },
  ],
  outputs: [],
  defaultConfig: {},
  reactive: false,
  execute: async ({ config, inputs, signal }) => {
    const refs = extractInputArrayByType(inputs, "in", "image");
    if (refs.length === 0) {
      throw new Error(
        "Export has nothing to save — wire an image source into the `in` handle.",
      );
    }

    const namePrefix = (config.namePrefix ?? DEFAULT_NAME_PREFIX).trim();
    const tag = config.tag?.trim();
    const tags = tag ? [tag] : [];

    // Sequential to keep things simple — uploads are dominated by the
    // download leg, which is already cached by CloudFront. If a user ever
    // exports 100+ images we can bound this with the same maxConcurrent
    // pattern the engine uses for fan-out.
    let savedCount = 0;
    for (let i = 0; i < refs.length; i++) {
      if (signal.aborted) {
        const err = new Error("Aborted");
        err.name = "AbortError";
        throw err;
      }
      const ref = refs[i]!;
      try {
        const uploaded = await uploadImageFromUrl(
          ref.url,
          `${namePrefix.toLowerCase().replace(/\s+/g, "-") || "generated"}-${i + 1}.png`,
        );
        useAssetStore.getState().createImageAssetFromUploaded({
          bucket: uploaded.bucket,
          key: uploaded.key,
          url: uploaded.url,
          mime: uploaded.mime,
          sizeBytes: uploaded.sizeBytes,
          name: namePrefix
            ? `${namePrefix} ${i + 1}`
            : `${i + 1}`,
          tags,
          scope: "project",
        });
        savedCount += 1;
      } catch (err) {
        // Bail loud — if the first save fails the rest probably will too,
        // and we'd rather surface "auth missing" once than spam toast errors.
        if ((err as Error)?.name === "AbortError") throw err;
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Saved ${savedCount} of ${refs.length} before failing: ${message}`,
        );
      }
    }

    // Output is "none" but we still must return *something* the engine
    // accepts. An empty array is a valid StandardizedOutput[] — the
    // runner treats it as "no downstream value" since this node has zero
    // declared outputs anyway.
    return [];
  },
  Body: ExportNodeBody,
  size: {
    defaultWidth: 240,
    minWidth: 220,
    maxWidth: 360,
    resizable: "both",
  },
});
