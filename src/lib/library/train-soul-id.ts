import {
  getSoulIdStatus,
  trainSoulId,
} from "@/lib/higgsfield/call-soul-id-train";
import { useAssetStore } from "@/lib/stores/asset-store";
import type { GroupSoulTraining } from "@/types/asset";

/**
 * Train a group as a Soul ID (M0b). Orchestration:
 *
 *   1. Collect the group's image URLs (must be public — they are, since
 *      library images live on Supabase).
 *   2. Set the group's soulTraining to { status: "training" } optimistically.
 *   3. Kick off training (Higgsfield /v1/custom-references).
 *   4. Poll status until "completed" / "failed", patching the group's
 *      thumbnail + status as it goes. (Higgsfield has no training webhook;
 *      Prism polled too. The poll only runs while training — see ADR note.)
 *
 * The group keeps its images throughout (the user can still enter it). On
 * success the group "is" a Soul ID (status "ready" + thumbnail). On failure
 * the binding records the error so the UI can offer a re-train.
 *
 * `pollIntervalMs` is injectable for tests.
 */

const DEFAULT_POLL_MS = 20_000;
const POLL_TIMEOUT_MS = 15 * 60_000; // 15 min hard stop

function imageUrlsForGroup(groupId: string): string[] {
  const store = useAssetStore.getState();
  const group = store.getAsset(groupId);
  if (!group || group.kind !== "asset-group") return [];
  const urls: string[] = [];
  for (const id of group.assetIds) {
    const asset = store.getAsset(id);
    if (asset?.kind === "image") urls.push(asset.source.url);
  }
  return urls;
}

export interface TrainGroupOptions {
  groupId: string;
  variant?: "v1" | "v2" | "cinema";
  signal: AbortSignal;
  pollIntervalMs?: number;
}

export async function trainGroupAsSoulId(
  options: TrainGroupOptions,
): Promise<GroupSoulTraining> {
  const { groupId, variant = "v2", signal } = options;
  const pollMs = options.pollIntervalMs ?? DEFAULT_POLL_MS;
  const store = useAssetStore.getState();
  const group = store.getAsset(groupId);
  if (!group || group.kind !== "asset-group") {
    throw new Error("Group not found.");
  }
  const imageUrls = imageUrlsForGroup(groupId);
  if (imageUrls.length === 0) {
    throw new Error("This group has no images to train on.");
  }

  // Optimistic training state (no id yet).
  store.setGroupSoulTraining(groupId, {
    customReferenceId: "",
    variant,
    status: "training",
    thumbnailUrl: null,
  });

  let record;
  try {
    record = await trainSoulId({
      name: group.name,
      variant,
      imageUrls,
      signal,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failed: GroupSoulTraining = {
      customReferenceId: "",
      variant,
      status: "failed",
      thumbnailUrl: null,
      error: message,
    };
    useAssetStore.getState().setGroupSoulTraining(groupId, failed);
    throw err;
  }

  // Bind the Higgsfield id; keep polling for completion.
  useAssetStore.getState().setGroupSoulTraining(groupId, {
    customReferenceId: record.id,
    variant,
    status: "training",
    thumbnailUrl: record.thumbnailUrl,
  });

  return pollUntilDone(groupId, record.id, variant, signal, pollMs);
}

/**
 * Poll a Soul ID's status until terminal, patching the group as it goes.
 * Exported so a "resume poll on load" path (for groups left in "training"
 * after a reload) can reuse it.
 */
export async function pollUntilDone(
  groupId: string,
  customReferenceId: string,
  variant: "v1" | "v2" | "cinema",
  signal: AbortSignal,
  pollIntervalMs = DEFAULT_POLL_MS,
): Promise<GroupSoulTraining> {
  const started = Date.now();
  for (;;) {
    if (signal.aborted) {
      const e = new Error("Aborted");
      e.name = "AbortError";
      throw e;
    }
    if (Date.now() - started > POLL_TIMEOUT_MS) {
      const timedOut: GroupSoulTraining = {
        customReferenceId,
        variant,
        status: "failed",
        thumbnailUrl: null,
        error: "Training timed out.",
      };
      useAssetStore.getState().setGroupSoulTraining(groupId, timedOut);
      return timedOut;
    }

    await new Promise((r) => setTimeout(r, pollIntervalMs));
    if (signal.aborted) continue;

    let rec;
    try {
      rec = await getSoulIdStatus(customReferenceId, signal);
    } catch {
      // Transient error — keep polling.
      continue;
    }

    if (rec.status === "completed") {
      const ready: GroupSoulTraining = {
        customReferenceId,
        variant,
        status: "ready",
        thumbnailUrl: rec.thumbnailUrl,
      };
      useAssetStore.getState().setGroupSoulTraining(groupId, ready);
      return ready;
    }
    if (rec.status === "failed") {
      const failed: GroupSoulTraining = {
        customReferenceId,
        variant,
        status: "failed",
        thumbnailUrl: rec.thumbnailUrl,
        error: "Training failed upstream.",
      };
      useAssetStore.getState().setGroupSoulTraining(groupId, failed);
      return failed;
    }
    // not_ready / queued / in_progress → keep polling (patch thumbnail if any).
    if (rec.thumbnailUrl) {
      useAssetStore.getState().setGroupSoulTraining(groupId, {
        customReferenceId,
        variant,
        status: "training",
        thumbnailUrl: rec.thumbnailUrl,
      });
    }
  }
}
