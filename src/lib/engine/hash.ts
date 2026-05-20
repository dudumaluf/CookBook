/**
 * Tiny content-hash used as the cache key for node outputs.
 *
 * We deliberately don't pull in a crypto dependency — for our scale (graphs
 * with <100 nodes and runs measured in seconds) a stable 64-bit FNV-1a is
 * plenty. Same input → same 8-char hex, end of story.
 *
 * The input MUST already be a canonical (sorted-keys) JSON string. See
 * `stableStringify` below for the serializer; mixing the two would defeat
 * the cache because `{a:1,b:2}` and `{b:2,a:1}` would hash to different
 * keys even though they represent identical config.
 */
export function hashString(input: string): string {
  // 64-bit FNV-1a via two 32-bit lanes to avoid BigInt overhead in hot path.
  let h1 = 0x811c9dc5;
  let h2 = 0x84222325;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 ^= c;
    h2 ^= c;
    // 32-bit FNV prime multiplication, mimicked with Math.imul to stay 32-bit.
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 = Math.imul(h2, 0x01000195) >>> 0;
  }
  return (
    h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0")
  );
}

/**
 * JSON.stringify with deterministic key ordering at every depth.
 *
 * Two configs that are deep-equal but written with keys in a different
 * order must hash to the same string. JS object property iteration order
 * is mostly insertion-order today, but we don't want a future refactor of
 * "I'll just spread the config the other way" to silently bust every cache
 * entry. Sorted keys = no foot-gun.
 *
 * Handles primitives, arrays, plain objects, null. Other things (functions,
 * Map, Set, Date, RegExp) are out of scope — node configs are JSON
 * payloads by convention (they get persisted to localStorage already).
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k]))
      .join(",") +
    "}"
  );
}
