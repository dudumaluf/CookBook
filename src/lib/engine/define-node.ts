import type { NodeSchema } from "@/types/node";

/**
 * Identity helper that exists purely for type-inference convenience: when you
 * call `defineNode<MyConfig>({ ... })`, TypeScript pins the schema's generic
 * to `MyConfig` so `defaultConfig`, `execute`, and `Body` props all stay in
 * sync. We may add validation here later (e.g. assert unique handle ids,
 * non-empty title) — right now keep it cheap and predictable.
 */
export function defineNode<TConfig>(
  schema: NodeSchema<TConfig>,
): NodeSchema<TConfig> {
  return schema;
}
