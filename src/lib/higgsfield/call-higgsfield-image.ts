import type {
  HiggsfieldErrorResponse,
  HiggsfieldImageRequest,
  HiggsfieldImageSuccessResponse,
  HiggsfieldSoulIdListResponse,
  HiggsfieldSoulIdSummary,
  HiggsfieldSoulStyle,
  HiggsfieldSoulStylesResponse,
} from "./types";

/**
 * Client-side wrappers around the Higgsfield API routes.
 *
 * The route + these wrappers are intentionally a thin pair: the route
 * holds the secrets and validates input; the wrappers handle fetch
 * mechanics + error normalisation so callers (`HiggsfieldImageGen.execute()`,
 * the SoulID library popover) only deal with `{ imageUrls, ... }` or a
 * `HiggsfieldCallError`.
 *
 * Cancellation: pass the runner's `AbortSignal`. Fetch will throw a
 * DOMException with `.name === "AbortError"`, which we re-throw with the
 * name preserved so the execution engine treats it as cancellation rather
 * than a "real" error. Server-side 499 responses are also translated to
 * AbortError for the same reason.
 *
 * Mirrors `src/lib/llm/call-openrouter.ts` one-to-one — same shape, same
 * AbortError discipline, same error-code surface.
 */

export class HiggsfieldCallError extends Error {
  readonly code: NonNullable<HiggsfieldErrorResponse["code"]> | "network";
  constructor(
    message: string,
    code: NonNullable<HiggsfieldErrorResponse["code"]> | "network",
  ) {
    super(message);
    this.name = "HiggsfieldCallError";
    this.code = code;
  }
}

export interface CallHiggsfieldImageArgs extends HiggsfieldImageRequest {
  signal: AbortSignal;
}

export async function callHiggsfieldImage(
  args: CallHiggsfieldImageArgs,
): Promise<HiggsfieldImageSuccessResponse> {
  const { signal, ...body } = args;

  let res: Response;
  try {
    res = await fetch("/api/higgsfield/image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    throw new HiggsfieldCallError(
      "Could not reach the Higgsfield endpoint. Is the dev server running?",
      "network",
    );
  }

  if (res.ok) {
    return (await res.json()) as HiggsfieldImageSuccessResponse;
  }

  const { message, code } = await readErrorPayload(res);

  if (res.status === 499) {
    const abortErr = new Error(message);
    abortErr.name = "AbortError";
    throw abortErr;
  }

  throw new HiggsfieldCallError(message, code);
}

export async function fetchSoulIds(
  signal: AbortSignal,
): Promise<HiggsfieldSoulIdSummary[]> {
  let res: Response;
  try {
    res = await fetch("/api/higgsfield/soul-ids", { signal });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    throw new HiggsfieldCallError(
      "Could not reach the Higgsfield endpoint. Is the dev server running?",
      "network",
    );
  }

  if (res.ok) {
    const data = (await res.json()) as HiggsfieldSoulIdListResponse;
    return data.items;
  }

  const { message, code } = await readErrorPayload(res);

  if (res.status === 499) {
    const abortErr = new Error(message);
    abortErr.name = "AbortError";
    throw abortErr;
  }

  throw new HiggsfieldCallError(message, code);
}

/**
 * Fetch the curated v2 Soul Style presets — Slice 5.3. Powers the
 * thumbnail picker grid in the HiggsfieldImageGen settings popover.
 *
 * Same shape contract as `fetchSoulIds` (returns the `items` array
 * directly, throws `HiggsfieldCallError` on upstream failure, preserves
 * `AbortError` unchanged on cancellation).
 */
export async function fetchSoulStyles(
  signal: AbortSignal,
): Promise<HiggsfieldSoulStyle[]> {
  let res: Response;
  try {
    res = await fetch("/api/higgsfield/soul-styles", { signal });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    throw new HiggsfieldCallError(
      "Could not reach the Higgsfield endpoint. Is the dev server running?",
      "network",
    );
  }

  if (res.ok) {
    const data = (await res.json()) as HiggsfieldSoulStylesResponse;
    return data.items;
  }

  const { message, code } = await readErrorPayload(res);

  if (res.status === 499) {
    const abortErr = new Error(message);
    abortErr.name = "AbortError";
    throw abortErr;
  }

  throw new HiggsfieldCallError(message, code);
}

async function readErrorPayload(res: Response): Promise<{
  message: string;
  code: NonNullable<HiggsfieldErrorResponse["code"]> | "network";
}> {
  let payload: HiggsfieldErrorResponse | null = null;
  try {
    payload = (await res.json()) as HiggsfieldErrorResponse;
  } catch {
    payload = null;
  }
  return {
    message:
      payload?.error ?? `Higgsfield call failed with HTTP ${res.status}`,
    code: payload?.code ?? "unknown",
  };
}
