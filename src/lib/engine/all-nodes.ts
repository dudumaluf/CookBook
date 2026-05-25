import { arrayNodeSchema } from "@/components/nodes/node-array";
import { exportNodeSchema } from "@/components/nodes/node-export";
import { higgsfieldImageGenNodeSchema } from "@/components/nodes/node-higgsfield-image-gen";
import { imageIteratorNodeSchema } from "@/components/nodes/node-image-iterator";
import { imageNodeSchema } from "@/components/nodes/node-image";
import { listNodeSchema } from "@/components/nodes/node-list";
import { llmTextNodeSchema } from "@/components/nodes/node-llm-text";
import { numberNodeSchema } from "@/components/nodes/node-number";
import { soulIdNodeSchema } from "@/components/nodes/node-soul-id";
import { textIteratorNodeSchema } from "@/components/nodes/node-text-iterator";
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
  nodeRegistry.register(numberNodeSchema);
  nodeRegistry.register(llmTextNodeSchema);
  nodeRegistry.register(soulIdNodeSchema);
  nodeRegistry.register(higgsfieldImageGenNodeSchema);
  nodeRegistry.register(imageIteratorNodeSchema);
  nodeRegistry.register(textIteratorNodeSchema);
  nodeRegistry.register(arrayNodeSchema);
  nodeRegistry.register(listNodeSchema);
  nodeRegistry.register(exportNodeSchema);
  registered = true;
}

registerAllNodes();
