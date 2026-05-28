import { arrayNodeSchema } from "@/components/nodes/node-array";
import { audioNodeSchema } from "@/components/nodes/node-audio";
import { compositeNodeSchema } from "@/components/nodes/node-composite";
import { continuityBuilderNodeSchema } from "@/components/nodes/node-continuity-builder";
import { exportNodeSchema } from "@/components/nodes/node-export";
import { falImageNodeSchema } from "@/components/nodes/node-fal-image";
import { seedanceVideoNodeSchema } from "@/components/nodes/node-fal-seedance";
import { higgsfieldImageGenNodeSchema } from "@/components/nodes/node-higgsfield-image-gen";
import { imageIteratorNodeSchema } from "@/components/nodes/node-image-iterator";
import { imageNodeSchema } from "@/components/nodes/node-image";
import { listNodeSchema } from "@/components/nodes/node-list";
import { llmTextNodeSchema } from "@/components/nodes/node-llm-text";
import { numberNodeSchema } from "@/components/nodes/node-number";
import { passthroughNodeSchema } from "@/components/nodes/node-passthrough";
import { videoNodeSchema } from "@/components/nodes/node-video";
import { soulIdNodeSchema } from "@/components/nodes/node-soul-id";
import { textIteratorNodeSchema } from "@/components/nodes/node-text-iterator";
import { textNodeSchema } from "@/components/nodes/node-text";
import { videoConcatNodeSchema } from "@/components/nodes/node-video-concat";

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
  nodeRegistry.register(videoNodeSchema);
  nodeRegistry.register(audioNodeSchema);
  nodeRegistry.register(numberNodeSchema);
  nodeRegistry.register(llmTextNodeSchema);
  nodeRegistry.register(soulIdNodeSchema);
  nodeRegistry.register(higgsfieldImageGenNodeSchema);
  nodeRegistry.register(falImageNodeSchema);
  nodeRegistry.register(seedanceVideoNodeSchema);
  nodeRegistry.register(continuityBuilderNodeSchema);
  nodeRegistry.register(videoConcatNodeSchema);
  nodeRegistry.register(imageIteratorNodeSchema);
  nodeRegistry.register(textIteratorNodeSchema);
  nodeRegistry.register(arrayNodeSchema);
  nodeRegistry.register(listNodeSchema);
  nodeRegistry.register(exportNodeSchema);
  // Slice 6.6 — composite + passthrough lands. `composite` is the
  // recipe-as-node primitive; `passthrough` is its internal injection
  // helper (never spawned by the user, only by composite execute()).
  nodeRegistry.register(compositeNodeSchema);
  nodeRegistry.register(passthroughNodeSchema);
  registered = true;
}

registerAllNodes();
