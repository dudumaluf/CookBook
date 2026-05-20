import type { NodeCategory, NodeSchema } from "@/types/node";

/**
 * Authoritative catalog of every node the engine knows about.
 *
 * The registry is constructed eagerly from `all-nodes.ts` (no side-effect
 * imports, no module load order surprises). Consumers:
 *
 *   - Add-node popover lists from `listByCategory()`
 *   - Right-click context menu reuses the same listing
 *   - Workflow store calls `get(kind)` to read `defaultConfig` when adding a node
 *   - Canvas-flow registers each kind's React component into React Flow's nodeTypes
 *   - LLM assistant (M0a Slice 6) auto-generates its tool catalog from `list()`
 */
export class NodeRegistry {
  private byKind = new Map<string, NodeSchema>();

  /**
   * Generic in the config type so callers can pass `NodeSchema<MyConfig>`
   * without TypeScript balking about TConfig variance. The map stores the
   * type-erased shape — config-specific typing only matters in the owning
   * node module and inside `execute` (where we cast back at the boundary).
   *
   * Re-registering the same kind is a silent upsert. This is critical for
   * Turbopack HMR: when a node module is edited, the new module re-imports
   * `all-nodes.ts` which calls `register()` again with the freshly-built
   * schema. We *want* the new schema (so the body changes pick up), and we
   * don't want to crash the page. In dev, we log so anyone genuinely
   * duplicating a kind in source notices.
   */
  register<TConfig>(schema: NodeSchema<TConfig>): void {
    if (
      process.env.NODE_ENV !== "production" &&
      this.byKind.has(schema.kind)
    ) {
      console.debug(
        `[NodeRegistry] HMR re-registration of kind "${schema.kind}" (replacing prior schema)`,
      );
    }
    this.byKind.set(schema.kind, schema as NodeSchema);
  }

  get<TConfig = unknown>(kind: string): NodeSchema<TConfig> | undefined {
    return this.byKind.get(kind) as NodeSchema<TConfig> | undefined;
  }

  has(kind: string): boolean {
    return this.byKind.has(kind);
  }

  list(): NodeSchema[] {
    return Array.from(this.byKind.values());
  }

  /** Group schemas by category, preserving registration order within each. */
  listByCategory(): Map<NodeCategory, NodeSchema[]> {
    const grouped = new Map<NodeCategory, NodeSchema[]>();
    for (const schema of this.byKind.values()) {
      const bucket = grouped.get(schema.category) ?? [];
      bucket.push(schema);
      grouped.set(schema.category, bucket);
    }
    return grouped;
  }
}

/**
 * Singleton consumed everywhere. Tests instantiate their own `new NodeRegistry()`
 * to avoid contaminating the global one.
 */
export const nodeRegistry = new NodeRegistry();
