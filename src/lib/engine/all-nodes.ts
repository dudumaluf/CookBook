import { imageNodeSchema } from "@/components/nodes/node-image";
import { llmTextNodeSchema } from "@/components/nodes/node-llm-text";
import { soulIdNodeSchema } from "@/components/nodes/node-soul-id";
import { textNodeSchema } from "@/components/nodes/node-text";

import { nodeRegistry } from "./registry";

/**
 * Single source of truth for which node schemas exist.
 *
 * Adding a new node:
 *   1. Create `src/components/nodes/node-<kind>.tsx` exporting `<kind>NodeSchema`.
 *   2. Import + register it here.
 *   3. Reference the schema's `kind` in any composite/recipe definitions.
 *
 * The registry is populated as a module side-effect on import. Tests that
 * need a clean registry should instantiate their own `new NodeRegistry()`.
 *
 * We register each schema individually (rather than storing them in a typed
 * array) so TypeScript can preserve each schema's specific config generic
 * without running into NodeSchema's TConfig invariance.
 */
let registered = false;
export function registerAllNodes(): void {
  if (registered) return;
  nodeRegistry.register(textNodeSchema);
  nodeRegistry.register(imageNodeSchema);
  nodeRegistry.register(llmTextNodeSchema);
  nodeRegistry.register(soulIdNodeSchema);
  registered = true;
}

registerAllNodes();
