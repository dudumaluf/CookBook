import { sanitizeBlockingDocument, type BlockingDocument } from "@/types/blocking";

/** Shot-view JPEG at tMs. Browser-only. */
export async function captureShotJpeg(
  raw: BlockingDocument,
  tMs: number,
): Promise<string | null> {
  if (typeof document === "undefined") return null;
  const doc = sanitizeBlockingDocument(raw);
  const { BlockingWorld } = await import("./world");
  const THREE = await import("three");
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 360;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    preserveDrawingBuffer: true,
    alpha: false,
  });
  renderer.setSize(640, 360, false);
  const world = new BlockingWorld();
  try {
    await world.sync(doc, tMs);
    renderer.render(world.scene, world.playblastCamera);
    return canvas.toDataURL("image/jpeg", 0.7);
  } catch {
    return null;
  } finally {
    world.dispose();
    renderer.dispose();
  }
}
