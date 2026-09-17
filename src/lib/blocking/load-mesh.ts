import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";

export type MeshFormat = "glb" | "gltf" | "obj" | "fbx";

export interface LoadedMesh {
  root: THREE.Object3D;
  clips: THREE.AnimationClip[];
  format: MeshFormat;
}

const cache = new Map<string, Promise<LoadedMesh>>();

export function inferMeshFormat(url: string, mime?: string): MeshFormat {
  const lower = `${url} ${mime ?? ""}`.toLowerCase();
  if (lower.includes(".fbx") || lower.includes("fbx")) return "fbx";
  if (lower.includes(".obj") || lower.includes("model/obj")) return "obj";
  if (lower.includes(".gltf")) return "gltf";
  return "glb";
}

export function loadExternalMesh(url: string, mime?: string): Promise<LoadedMesh> {
  const hit = cache.get(url);
  if (hit) {
    return hit.then((m) => ({
      root: m.root.clone(true),
      clips: m.clips,
      format: m.format,
    }));
  }
  const format = inferMeshFormat(url, mime);
  const pending = loadFresh(url, format);
  cache.set(url, pending);
  return pending.then((m) => ({
    root: m.root.clone(true),
    clips: m.clips,
    format: m.format,
  }));
}

async function loadFresh(url: string, format: MeshFormat): Promise<LoadedMesh> {
  if (format === "obj") {
    const root = await new OBJLoader().loadAsync(url);
    fitToUnit(root);
    return { root, clips: [], format };
  }
  if (format === "fbx") {
    try {
      const root = await new FBXLoader().loadAsync(url);
      fitToUnit(root);
      return { root, clips: root.animations ?? [], format };
    } catch (err) {
      throw new Error(
        `Could not read this FBX in the browser. Export a GLB and import that instead. (${
          err instanceof Error ? err.message : "parse failed"
        })`,
      );
    }
  }
  const gltf = await new GLTFLoader().loadAsync(url);
  const root = gltf.scene ?? gltf.scenes[0];
  if (!root) throw new Error("GLTF had no scene.");
  fitToUnit(root);
  return { root, clips: gltf.animations ?? [], format };
}

/** Scale imported assets so a typical character is ~1.8m tall. */
function fitToUnit(root: THREE.Object3D): void {
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  box.getSize(size);
  const tallest = Math.max(size.x, size.y, size.z);
  if (tallest > 8) {
    const s = 1.8 / tallest;
    root.scale.multiplyScalar(s);
  } else if (tallest > 0 && tallest < 0.2) {
    root.scale.multiplyScalar(1.8 / tallest);
  }
  const next = new THREE.Box3().setFromObject(root);
  if (next.min.y < -0.01) {
    root.position.y -= next.min.y;
  }
}
