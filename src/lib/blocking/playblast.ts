import {
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
} from "mediabunny";
import * as THREE from "three";

import { outputFrameCount } from "@/lib/media/time-remap";
import { sanitizeBlockingDocument, type BlockingDocument } from "@/types/blocking";

import { BlockingWorld } from "./world";

export interface PlayblastResult {
  blob: Blob;
  durationMs: number;
  width: number;
  height: number;
}

function even(n: number): number {
  const r = Math.round(n);
  return r > 0 ? r - (r % 2) : 2;
}

/**
 * Rasterize a blocking scene to an H.264 MP4. Browser-only (WebGL + WebCodecs).
 */
export async function playblastScene(
  raw: BlockingDocument,
  signal?: AbortSignal,
): Promise<PlayblastResult> {
  const doc = sanitizeBlockingDocument(raw);
  const width = even(doc.width);
  const height = even(doc.height);
  const fps = doc.fps;
  const outDurSec = doc.durationMs / 1000;
  const framesN = outputFrameCount(outDurSec, fps);
  const frameDur = 1 / fps;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    preserveDrawingBuffer: true,
    alpha: false,
  });
  renderer.setSize(width, height, false);
  renderer.setPixelRatio(1);

  const world = new BlockingWorld();
  await world.sync(doc, 0);

  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: "in-memory" }),
    target: new BufferTarget(),
  });
  const videoSource = new CanvasSource(canvas, {
    codec: "avc",
    bitrate: QUALITY_HIGH,
    keyFrameInterval: 1,
  });
  output.addVideoTrack(videoSource);
  await output.start();

  try {
    for (let i = 0; i < framesN; i++) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const tMs = Math.min(doc.durationMs, (i / Math.max(1, framesN - 1)) * doc.durationMs);
      await world.sync(doc, tMs);
      renderer.render(world.scene, world.playblastCamera);
      await videoSource.add(
        i * frameDur,
        frameDur,
        i === 0 || i % Math.round(fps) === 0 ? { keyFrame: true } : undefined,
      );
    }
  } finally {
    world.dispose();
    renderer.dispose();
  }

  await output.finalize();
  const buffer = (output.target as BufferTarget).buffer;
  if (!buffer) throw new Error("Playblast produced no output buffer.");
  return {
    blob: new Blob([buffer], { type: "video/mp4" }),
    durationMs: Math.round(outDurSec * 1000),
    width,
    height,
  };
}
