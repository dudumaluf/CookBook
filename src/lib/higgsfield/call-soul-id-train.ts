import { authedFetch } from "@/lib/auth/authed-fetch";
import { HiggsfieldCallError } from "./call-higgsfield-image";
import type { HiggsfieldErrorResponse } from "./types";

/**
 * Client wrappers for Soul ID training (M0b spike) — mirror the existing
 * Higgsfield client wrappers (typed error, 499 -> AbortError).
 */

export interface SoulIdRecord {
  id: string;
  name: string;
  modelVersion: "v1" | "v2" | "cinema";
  status: "not_ready" | "queued" | "in_progress" | "completed" | "failed";
  thumbnailUrl: string | null;
  createdAt: string;
}

async function parseError(res: Response): Promise<never> {
  let payload: HiggsfieldErrorResponse | null = null;
  try {
    payload = (await res.json()) as HiggsfieldErrorResponse;
  } catch {
    payload = null;
  }
  const message = payload?.error ?? `Request failed with HTTP ${res.status}`;
  if (res.status === 499) {
    const abortErr = new Error(message);
    abortErr.name = "AbortError";
    throw abortErr;
  }
  throw new HiggsfieldCallError(message, payload?.code ?? "unknown");
}

export async function trainSoulId(args: {
  name: string;
  variant: "v1" | "v2" | "cinema";
  imageUrls: string[];
  signal: AbortSignal;
}): Promise<SoulIdRecord> {
  const { signal, ...body } = args;
  let res: Response;
  try {
    res = await authedFetch("/api/higgsfield/soul-id/train", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    throw new HiggsfieldCallError(
      "Could not reach the training endpoint.",
      "network",
    );
  }
  if (!res.ok) return parseError(res);
  const data = (await res.json()) as { record: SoulIdRecord };
  return data.record;
}

export async function getSoulIdStatus(
  id: string,
  signal: AbortSignal,
): Promise<SoulIdRecord> {
  const res = await authedFetch(`/api/higgsfield/soul-id/${encodeURIComponent(id)}`, {
    method: "GET",
    signal,
  });
  if (!res.ok) return parseError(res);
  const data = (await res.json()) as { record: SoulIdRecord };
  return data.record;
}

export async function deleteSoulIdRemote(
  id: string,
  signal: AbortSignal,
): Promise<void> {
  const res = await authedFetch(`/api/higgsfield/soul-id/${encodeURIComponent(id)}`, {
    method: "DELETE",
    signal,
  });
  if (!res.ok) return parseError(res);
}
