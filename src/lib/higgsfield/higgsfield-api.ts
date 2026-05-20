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
 * Higgsfield's API has TWO coexisting auth schemes — discovered via the
 * cloud.higgsfield.ai/models reference UI:
 *
 *   1. Generation endpoints (`/higgsfield-ai/soul/*`,
 *      `/requests/{id}/status`, `/requests/{id}/cancel`,
 *      `/v1/custom-references/list`) take a single
 *      `Authorization: Key KEY:SECRET` header.
 *
 *   2. Other `/v1/text2image/*` endpoints (notably
 *      `/v1/text2image/soul-styles/v2` for listing Soul Style
 *      presets, used when we ship a style picker UI in a later
 *      slice) take separate `hf-api-key` + `hf-secret` headers.
 *
 * The split is a vestige of an in-progress auth migration on their
 * side. Pick the right helper for each endpoint.
 *
 * Submitting v2/standard generation jobs with the LEGACY header pair
 * still passes auth at the gateway, but empirically the request
 * ends up in a queue path that never advances past `queued` — so we
 * use the canonical scheme for everything generation-related, even
 * though the docs cohort changes per endpoint.
 */
function authHeaders(creds: Credentials): Record<string, string> {
  return {
    Authorization: `Key ${creds.key}:${creds.secret}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

/**
 * Headers for the legacy auth scheme — used by `/v1/text2image/*`
 * endpoints (Soul Style listings, etc.). Not used yet; will be when
 * the style picker UI lands. Kept here so the next wrapper that needs
 * a `/v1/text2image/*` call can `import { authHeadersV1 }` and not
 * re-discover the auth split.
 *
 * eslint-disable-next-line @typescript-eslint/no-unused-vars
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function authHeadersV1(creds: Credentials): Record<string, string> {
  return {
    "hf-api-key": creds.key,
    "hf-secret": creds.secret,
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
  /**
   * The list endpoint never populates `thumbnail_url` (always null in the
   * wild as of May 2026), but the per-character GET endpoint returns a
   * `reference_media` array with the training images. We could fetch each
   * character individually for a thumbnail, but that's N extra requests
   * per list — for now we surface what the list endpoint gives us and let
   * the UI render a User-glyph fallback.
   */
  reference_media?: Array<{ id: string; media_url: string }>;
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
 *
 * The list endpoint never populates `thumbnail_url` (always null in the
 * wild as of May 2026); for completed characters we fan-out a per-character
 * GET to read the first `reference_media` entry as a thumbnail. Keeps the
 * UI from rendering a wall of placeholder glyphs when the user actually
 * has trained characters with cover images.
 *
 * The fan-out is sequential to stay well under any per-second rate limit;
 * for users with many characters this is N+1 requests but each is a
 * cached GET. If this ever becomes a perceived UX problem (>10 chars),
 * the obvious fix is concurrent + a session cache.
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
      // For completed characters, fetch the per-character payload to grab
      // a real thumbnail from `reference_media[0].media_url`. Defensive
      // fallback to null on errors so a single bad character doesn't kill
      // the whole list.
      let thumbnailUrl: string | null = item.thumbnail_url ?? null;
      if (item.status === "completed" && !thumbnailUrl) {
        try {
          const detail = await fetchJson<RawCustomReferenceListItem>(
            `${API_BASE}/v1/custom-references/${encodeURIComponent(item.id)}`,
            creds,
            { method: "GET", signal },
          );
          thumbnailUrl =
            detail.thumbnail_url ??
            detail.reference_media?.[0]?.media_url ??
            null;
        } catch {
          // Keep going with no thumbnail rather than failing the whole list.
        }
      }
      all.push({
        id: item.id,
        name: item.name,
        modelVersion: item.model_version,
        status: item.status,
        thumbnailUrl,
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

/**
 * Endpoint dispatch by Soul variant — see ADR-0029.
 *
 * Higgsfield silently ignores `custom_reference_id` when the request hits
 * the wrong endpoint for the character's trained variant (e.g. a v2 char
 * on /soul/cinema renders generically, no error). Picking the right URL
 * from the variant is the single most important thing this wrapper does.
 *
 * For variant === "none" (no Soul ID wired) we route to v2/standard for
 * the best quality generic render.
 *
 * Note on reference images: /soul/v2/standard accepts `image_url` in the
 * body but the visible influence on the output is subtle (the model
 * leans on the prompt much more than the ref). If a stronger ref-driven
 * style transfer is needed, the recipe-level pattern is to feed the ref
 * through an LLM Vision node first (Image → LLM Text with vision
 * system prompt → text → HiggsfieldImageGen.prompt). M0d's "save recipe
 * as reusable node" feature will let users package that subgraph as a
 * single "Image Describer" node.
 */
const SOUL_ENDPOINT_BY_VARIANT: Record<
  HiggsfieldImageRequest["variant"],
  { url: string; modelId: string }
> = {
  v2: {
    url: `${API_BASE}/higgsfield-ai/soul/v2/standard`,
    modelId: "higgsfield-ai/soul/v2/standard",
  },
  cinema: {
    url: `${API_BASE}/higgsfield-ai/soul/cinema`,
    modelId: "higgsfield-ai/soul/cinema",
  },
  v1: {
    url: `${API_BASE}/higgsfield-ai/soul/character`,
    modelId: "higgsfield-ai/soul/character",
  },
  none: {
    url: `${API_BASE}/higgsfield-ai/soul/v2/standard`,
    modelId: "higgsfield-ai/soul/v2/standard",
  },
};

/**
 * Submit a Soul image generation and wait for completion. Picks the right
 * endpoint from `args.variant` (see SOUL_ENDPOINT_BY_VARIANT). Returns the
 * array of image URLs (1 or 4 depending on `batchSize`).
 */
export async function generateSoulImage(
  args: HiggsfieldImageRequest,
  signal: AbortSignal,
  options: { pollIntervalMs?: number; timeoutMs?: number } = {},
): Promise<HiggsfieldImageSuccessResponse> {
  const creds = loadCredentials();
  const endpoint = SOUL_ENDPOINT_BY_VARIANT[args.variant];

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
  // The cinema endpoint 400s on any style_id ("Provided Soul style not
  // found"); we never send styleId on cinema even if it leaked through
  // the request schema. Same belt-and-suspenders pattern Prism's wrapper
  // had. Other variants get the styleId when in style mode.
  if (
    args.mode === "style" &&
    args.styleId &&
    args.variant !== "cinema"
  ) {
    body.style_id = args.styleId;
  }
  if (typeof args.seed === "number") body.seed = args.seed;
  if (args.negativePrompt) body.negative_prompt = args.negativePrompt;

  if (signal.aborted) throw makeAbort();

  // Step 1 — submit and grab the request id.
  const queued = await fetchJson<QueueResponse>(endpoint.url, creds, {
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
        model: endpoint.modelId,
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
