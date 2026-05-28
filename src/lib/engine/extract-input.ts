import type {
  AudioRef,
  DataType,
  ImageRef,
  SoulIdRef,
  StandardizedOutput,
  VideoRef,
} from "@/types/node";

/**
 * Pull a single value of the expected datatype out of an inputs record.
 *
 * Used by node `execute` functions in Slice 3+ to avoid repeating the
 * "is it a single value, is it an array, is the type right?" dance. The
 * engine guarantees inputs are already StandardizedOutput shaped, but the
 * runtime type can still surprise you (an array landed on a single input,
 * the upstream node emitted a different datatype, etc.).
 *
 * Returns `undefined` when the input is missing or type-mismatched — callers
 * should treat that as "no input" and either fall back to config or error.
 *
 * Overloads pick the precise return type per expected datatype; the
 * implementation is a single function returning `unknown`.
 */
type InputRecord = Record<
  string,
  StandardizedOutput | StandardizedOutput[] | undefined
>;

export function extractInputByType(
  inputs: InputRecord,
  handleId: string,
  expected: "text",
): string | undefined;
export function extractInputByType(
  inputs: InputRecord,
  handleId: string,
  expected: "image",
): ImageRef | undefined;
export function extractInputByType(
  inputs: InputRecord,
  handleId: string,
  expected: "video",
): VideoRef | undefined;
export function extractInputByType(
  inputs: InputRecord,
  handleId: string,
  expected: "audio",
): AudioRef | undefined;
export function extractInputByType(
  inputs: InputRecord,
  handleId: string,
  expected: "number",
): number | undefined;
export function extractInputByType(
  inputs: InputRecord,
  handleId: string,
  expected: "soul-id",
): SoulIdRef | undefined;
export function extractInputByType(
  inputs: InputRecord,
  handleId: string,
  expected: "any",
): StandardizedOutput["value"] | undefined;
export function extractInputByType(
  inputs: InputRecord,
  handleId: string,
  expected: DataType,
): unknown {
  const raw = inputs[handleId];
  if (raw === undefined) return undefined;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined) return undefined;
  if (expected !== "any" && value.type !== expected) return undefined;
  return value.value;
}

/**
 * Array variant. Normalizes single upstreams into a 1-element array and
 * filters out type-mismatched items.
 */
export function extractInputArrayByType(
  inputs: InputRecord,
  handleId: string,
  expected: "text",
): string[];
export function extractInputArrayByType(
  inputs: InputRecord,
  handleId: string,
  expected: "image",
): ImageRef[];
export function extractInputArrayByType(
  inputs: InputRecord,
  handleId: string,
  expected: "video",
): VideoRef[];
export function extractInputArrayByType(
  inputs: InputRecord,
  handleId: string,
  expected: "audio",
): AudioRef[];
export function extractInputArrayByType(
  inputs: InputRecord,
  handleId: string,
  expected: "number",
): number[];
export function extractInputArrayByType(
  inputs: InputRecord,
  handleId: string,
  expected: "soul-id",
): SoulIdRef[];
export function extractInputArrayByType(
  inputs: InputRecord,
  handleId: string,
  expected: "any",
): StandardizedOutput["value"][];
export function extractInputArrayByType(
  inputs: InputRecord,
  handleId: string,
  expected: DataType,
): unknown[] {
  const raw = inputs[handleId];
  if (raw === undefined) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list
    .filter((v) => expected === "any" || v.type === expected)
    .map((v) => v.value);
}
