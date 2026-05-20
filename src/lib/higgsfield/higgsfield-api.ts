import "server-only";

import type {
  HiggsfieldErrorCode,
  HiggsfieldImageRequest,
  HiggsfieldImageSuccessResponse,
  HiggsfieldSoulIdSummary,
} from "./types";

/**
 * SERVER-ONLY. Direct wrapper around Higgsfield's Cloud API.
 *
 * Lives behind Next.js API routes so HIGGSFIELD_API_KEY +
 * HIGGSFIELD_API_SECRET never reach the browser bundle (`import "server-only"`
 * is a build-time guard that fails the build if a client component reaches
 * this file).
 *
 * Mirrors ADR-0024's Fal-OpenRouter wrapper shape one-to-one — same secret-
 * boundary discipline, same AbortSignal race for cancellation, same `code`-
 * tagged errors for the route to map to HTTP. ADR-0029 documents the shape.
 *
 * Soul 2 standard endpoint is asynchronous:
 *   1. POST /higgsfield-ai/soul/v2/standard → { request_id, status: "queued" }
 *   2. GET  /requests/{id}/status (poll every 3s)
 *   3. when status === "completed" read images[].url
 *
 * Per Higgsfield's docs, requests can fail terminally with `nsfw` or `failed`
 * (credits refunded in both cases) — we surface those as distinct error codes
 * so the UI can explain "no charge" rather than letting the user think
 * something was billed.
 */

const API_BASE = "https://platform.higgsfield.ai";

/** Default polling interval — Higgsfield says "periodically", 3s is gentle. */
const DEFAULT_POLL_INTERVAL_MS = 3_000;
/** Soft cap for total wait. Most generations finish in under 30s. */
const DEFAULT_TIMEOUT_MS = 6 * 60_000;

/* ------------------------------- Auth ------------------------------- */

interface Credentials {
  key: string;
  secret: string;
}

function loadCredentials(): Credentials {
  const key = process.env.HIGGSFIELD_API_KEY?.trim();
  const secret = process.env.HIGGSFIELD_API_SECRET?.trim();
  if (!key || !secret) {
    const err = new Error(
      "HIGGSFIELD_API_KEY / HIGGSFIELD_API_SECRET missing from server env. Set both in .env.local — see .env.example.",
    );
    annotate(err, "missing_keys");
    throw err;
  }
  return { key, secret };
}

/**
 * Per the official Higgsfield API reference (cloud.higgsfield.ai/models,
 * May 2026): canonical auth header is `Authorization: Key {key}:{secret}`.
 *
 * Prism (May-2026 codebase) uses the older `hf-api-key` + `hf-secret`
 * pair which the platform still accepts on submit but appears to route
 * jobs through a different (slower / starved) queue path — empirically,
 * jobs submitted under that auth get stuck in `queued` indefinitely on
 * the v2/standard endpoint. The official `Authorization: Key` header is
 * the one we use for every request.
 */
function authHeaders(creds: Credentials): Record<string, string> {
  return {
    Authorization: `Key ${creds.key}:${creds.secret}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

/* ------------------------------- Errors ------------------------------- */

function annotate(err: Error, code: HiggsfieldErrorCode): void {
  (err as Error & { code?: HiggsfieldErrorCode }).code = code;
}

function makeAbort(): Error {
  const err = new Error("Aborted");
  err.name = "AbortError";
  return err;
}

/* ------------------------------- Fetch helper ------------------------------- */

interface FetchJsonOptions {
  method: "GET" | "POST";
  body?: string;
  signal?: AbortSignal;
}

async function fetchJson<T>(
  url: string,
  creds: Credentials,
  options: FetchJsonOptions,
): Promise<T> {
  if (options.signal?.aborted) throw makeAbort();
  const res = await fetch(url, {
    method: options.method,
    headers: authHeaders(creds),
    body: options.body,
    signal: options.signal,
  });
  const text = await res.text();
  let parsed: unknown = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  if (!res.ok) {
    const detail = extractDetail(parsed);
    const message = detail ?? `HTTP ${res.status}`;

    // Specific upstream error: concurrent-requests cap. Surfaced verbatim
    // by Higgsfield as `{"detail":"Maximum number of concurrent requests
    // (4) has been reached"}`. Detect by string match (no specific status
    // code, no machine-readable error_code field on the response) and
    // re-tag with `concurrent_limit` so the UI can prompt "wait for an
    // in-flight job to finish" instead of dumping the raw upstream text.
    if (
      res.status === 400 &&
      detail &&
      /concurrent requests/i.test(detail)
    ) {
      const err = new Error(`Higgsfield: ${detail}`);
      annotate(err, "concurrent_limit");
      throw err;
    }

    const err = new Error(`Higgsfield ${res.status}: ${message}`);
    annotate(err, "upstream_error");
    throw err;
  }
  return parsed as T;
}

/** Pulls Higgsfield's `detail` field out, whether it's a string or an
 *  array of validation errors (Zod-shape from FastAPI). */
function extractDetail(parsed: unknown): string | undefined {
  if (parsed === null || typeof parsed !== "object") {
    return typeof parsed === "string" ? parsed : undefined;
  }
  const detail = (parsed as { detail?: unknown }).detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail.length > 0) {
    // FastAPI body-validation errors look like `[{type, loc, msg, ...}]`.
    const first = detail[0];
    if (first && typeof first === "object" && "msg" in first) {
      return String((first as { msg: unknown }).msg);
    }
    return JSON.stringify(detail);
  }
  return JSON.stringify(parsed);
}

/* ------------------------------- Soul ID list ------------------------------- */

interface RawCustomReferenceListItem {
  id: string;
  name: string;
  model_version: "v1" | "v2" | "cinema";
  status:
    | "not_ready"
    | "queued"
    | "in_progress"
    | "completed"
    | "failed";
  thumbnail_url: string | null;
  created_at: string;
}

interface RawCustomReferenceList {
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  items: RawCustomReferenceListItem[];
}

/**
 * List trained Soul ID characters under the configured API key. Walks all
 * pages (Higgsfield caps at 20 per page) up to a hard 50-page safety so a
 * pathological account doesn't loop forever.
 */
export async function listSoulIds(
  signal: AbortSignal,
): Promise<HiggsfieldSoulIdSummary[]> {
  const creds = loadCredentials();
  const all: HiggsfieldSoulIdSummary[] = [];
  for (let page = 1; page <= 50; page++) {
    const res = await fetchJson<RawCustomReferenceList>(
      `${API_BASE}/v1/custom-references/list?page=${page}&page_size=20`,
      creds,
      { method: "GET", signal },
    );
    for (const item of res.items ?? []) {
      all.push({
        id: item.id,
        name: item.name,
        modelVersion: item.model_version,
        status: item.status,
        thumbnailUrl: item.thumbnail_url,
        createdAt: item.created_at,
      });
    }
    if (!res.total_pages || page >= res.total_pages) break;
  }
  return all;
}

/* ------------------------------- Image generation ------------------------------- */

interface QueueResponse {
  status: "queued";
  request_id: string;
  status_url: string;
  cancel_url: string;
}

interface StatusResponse {
  status:
    | "queued"
    | "in_progress"
    | "completed"
    | "failed"
    | "nsfw";
  request_id: string;
  images?: Array<{ url?: string }>;
  message?: string;
  detail?: unknown;
}

const SOUL_V2_ENDPOINT = `${API_BASE}/higgsfield-ai/soul/v2/standard`;
const SOUL_V2_MODEL_ID = "higgsfield-ai/soul/v2/standard";

/**
 * Submit a Soul 2 standard image generation and wait for completion.
 * Returns the array of image URLs (1 or 4 depending on `batchSize`).
 */
export async function generateSoulImage(
  args: HiggsfieldImageRequest,
  signal: AbortSignal,
  options: { pollIntervalMs?: number; timeoutMs?: number } = {},
): Promise<HiggsfieldImageSuccessResponse> {
  const creds = loadCredentials();

  // Build the per-mode body. We're explicit about which fields we send so
  // a future schema addition (negative_prompt, etc.) doesn't leak through
  // by accident.
  const body: Record<string, unknown> = {
    prompt: args.prompt,
    aspect_ratio: args.aspectRatio ?? "1:1",
    resolution: args.resolution ?? "720p",
    batch_size: args.batchSize ?? 1,
  };
  if (args.soulId) {
    // Per Prism's empirically-validated note: Higgsfield's Cloud API takes
    // `custom_reference_id` (the CLI flag `--soul-id` becomes this server-
    // side). The plain `soul_id` field is silently ignored — the model
    // renders without any character lock.
    body.custom_reference_id = args.soulId;
  }
  if (args.mode === "reference" && args.referenceUrl) {
    body.image_url = args.referenceUrl;
  }
  if (args.mode === "style" && args.styleId) {
    body.style_id = args.styleId;
  }
  if (typeof args.seed === "number") body.seed = args.seed;
  if (args.negativePrompt) body.negative_prompt = args.negativePrompt;

  if (signal.aborted) throw makeAbort();

  // Step 1 — submit and grab the request id.
  const queued = await fetchJson<QueueResponse>(SOUL_V2_ENDPOINT, creds, {
    method: "POST",
    body: JSON.stringify(body),
    signal,
  });
  if (!queued?.request_id) {
    const err = new Error(
      `Higgsfield queue response missing request_id: ${JSON.stringify(queued)}`,
    );
    annotate(err, "upstream_error");
    throw err;
  }

  // Step 2 — poll until terminal status.
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (signal.aborted) throw makeAbort();

    const status = await fetchJson<StatusResponse>(
      `${API_BASE}/requests/${encodeURIComponent(queued.request_id)}/status`,
      creds,
      { method: "GET", signal },
    );

    if (status.status === "completed") {
      const urls = (status.images ?? [])
        .map((i) => i?.url)
        .filter((u): u is string => typeof u === "string" && u.length > 0);
      if (urls.length === 0) {
        const err = new Error(
          `Higgsfield request ${queued.request_id} completed but returned no image URLs`,
        );
        annotate(err, "upstream_error");
        throw err;
      }
      return {
        imageUrls: urls,
        requestId: queued.request_id,
        model: SOUL_V2_MODEL_ID,
      };
    }

    if (status.status === "nsfw") {
      const err = new Error(
        "Higgsfield rejected the request as NSFW (no credits charged).",
      );
      annotate(err, "nsfw");
      throw err;
    }

    if (status.status === "failed") {
      const detail =
        typeof status.message === "string"
          ? status.message
          : "no detail";
      const err = new Error(
        `Higgsfield generation failed (no credits charged): ${detail}`,
      );
      annotate(err, "upstream_failed");
      throw err;
    }

    // queued / in_progress — wait then re-poll. The signal-aware sleep
    // makes cancellation snappy: an abort during the wait rejects ASAP
    // instead of forcing the user to wait out the full poll interval.
    await sleepWithAbort(pollIntervalMs, signal);
  }

  const err = new Error(
    `Higgsfield request ${queued.request_id} did not finish within ${timeoutMs}ms`,
  );
  annotate(err, "timeout");
  throw err;
}

function sleepWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(makeAbort());
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(makeAbort());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
