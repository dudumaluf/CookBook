import { BlockingWorld } from "./world";

const holders = new Set<string>();
let world: BlockingWorld | null = null;

/** One Three scene shared by editor + node body. Playblast stays its own. */
export function acquireBlockingWorld(holder: string): BlockingWorld {
  if (!world) world = new BlockingWorld();
  holders.add(holder);
  return world;
}

export function releaseBlockingWorld(holder: string): void {
  holders.delete(holder);
  if (holders.size === 0 && world) {
    world.dispose();
    world = null;
  }
}
