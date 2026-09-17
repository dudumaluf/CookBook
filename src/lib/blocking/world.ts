import * as THREE from "three";

import { evalCameraAt, evalObjectAt, type EvaluatedTransform } from "./evaluate";
import { loadExternalMesh } from "./load-mesh";
import type { BlockingDocument, BlockingObject, PrimitiveKind } from "@/types/blocking";

const KIND_COLOR: Record<string, number> = {
  box: 0x6b8cce,
  sphere: 0xce8c6b,
  capsule: 0x6bce8c,
  cylinder: 0xce6b8c,
  plane: 0x3d3d42,
  mesh: 0xc8c4bc,
};

export function createPrimitiveMesh(kind: PrimitiveKind): THREE.Mesh {
  let geo: THREE.BufferGeometry;
  if (kind === "sphere") geo = new THREE.SphereGeometry(0.5, 24, 16);
  else if (kind === "capsule") geo = new THREE.CapsuleGeometry(0.35, 1.1, 6, 12);
  else if (kind === "cylinder") geo = new THREE.CylinderGeometry(0.4, 0.4, 1.2, 16);
  else if (kind === "plane") {
    geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
  } else geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshLambertMaterial({
    color: KIND_COLOR[kind] ?? 0x888888,
    side: THREE.DoubleSide,
  });
  return new THREE.Mesh(geo, mat);
}

export function applyEvaluated(
  obj: THREE.Object3D,
  t: EvaluatedTransform,
  _kind?: string,
): void {
  obj.position.set(t.position[0], t.position[1], t.position[2]);
  obj.rotation.set(
    THREE.MathUtils.degToRad(t.rotation[0]),
    THREE.MathUtils.degToRad(t.rotation[1]),
    THREE.MathUtils.degToRad(t.rotation[2]),
  );
  obj.scale.set(t.scale[0], t.scale[1], t.scale[2]);
}

/**
 * Shared Three scene for the editor viewport and the playblast encoder.
 * Lights are fixed (not user-editable).
 */
export class BlockingWorld {
  readonly scene: THREE.Scene;
  readonly playblastCamera: THREE.PerspectiveCamera;
  readonly nodes = new Map<string, THREE.Object3D>();
  private readonly mixers = new Map<string, THREE.AnimationMixer>();
  private readonly clipNames = new Map<string, string[]>();
  private readonly loading = new Map<string, Promise<void>>();

  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x16161a);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3a48, 1.15));
    const dir = new THREE.DirectionalLight(0xffffff, 0.75);
    dir.position.set(5, 9, 6);
    this.scene.add(dir);
    const grid = new THREE.GridHelper(16, 16, 0x3a3a42, 0x2a2a30);
    grid.name = "__grid";
    this.scene.add(grid);
    this.playblastCamera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200);
    this.playblastCamera.name = CAMERA_PLAYBLAST;
    this.scene.add(this.playblastCamera);
  }

  clipList(id: string): string[] {
    return this.clipNames.get(id) ?? [];
  }

  async sync(doc: BlockingDocument, tMs: number): Promise<void> {
    const live = new Set(doc.objects.map((o) => o.id));
    for (const [id, node] of this.nodes) {
      if (!live.has(id)) {
        this.scene.remove(node);
        this.nodes.delete(id);
        this.mixers.delete(id);
        this.clipNames.delete(id);
      }
    }
    const pending: Promise<void>[] = [];
    for (const object of doc.objects) {
      if (!this.nodes.has(object.id)) {
        pending.push(this.spawn(object));
      }
    }
    await Promise.all(pending);

    for (const object of doc.objects) {
      const node = this.nodes.get(object.id);
      if (!node) continue;
      node.visible = object.visible;
      applyEvaluated(node, evalObjectAt(object, tMs), object.kind);
      const mixer = this.mixers.get(object.id);
      if (mixer && object.clip) {
        const clips = (node.userData.clips as THREE.AnimationClip[] | undefined) ?? [];
        const clip = clips.find((c) => c.name === object.clip!.name) ?? clips[0];
        if (clip) {
          const action = mixer.clipAction(clip);
          action.play();
          const t =
            Math.max(0, (tMs - object.clip.startMs) / 1000) * (object.clip.speed || 1);
          mixer.setTime(t);
        }
      }
    }

    const cam = evalCameraAt(doc.camera, tMs);
    this.playblastCamera.fov = cam.fov;
    this.playblastCamera.near = cam.near;
    this.playblastCamera.far = cam.far;
    this.playblastCamera.aspect = doc.width / Math.max(1, doc.height);
    this.playblastCamera.position.set(cam.position[0], cam.position[1], cam.position[2]);
    this.playblastCamera.lookAt(cam.lookAt[0], cam.lookAt[1], cam.lookAt[2]);
    this.playblastCamera.updateProjectionMatrix();
  }

  dispose(): void {
    for (const node of this.nodes.values()) this.scene.remove(node);
    this.nodes.clear();
    this.mixers.clear();
  }

  private async spawn(object: BlockingObject): Promise<void> {
    if (this.loading.has(object.id)) return this.loading.get(object.id);
    const work = this.spawnInner(object);
    this.loading.set(object.id, work);
    try {
      await work;
    } finally {
      this.loading.delete(object.id);
    }
  }

  private async spawnInner(object: BlockingObject): Promise<void> {
    if (this.nodes.has(object.id)) return;
    let node: THREE.Object3D;
    if (object.kind === "mesh" && object.meshUrl) {
      try {
        const loaded = await loadExternalMesh(object.meshUrl);
        node = loaded.root;
        node.userData.clips = loaded.clips;
        this.clipNames.set(
          object.id,
          loaded.clips.map((c) => c.name).filter(Boolean),
        );
        if (loaded.clips.length > 0) {
          this.mixers.set(object.id, new THREE.AnimationMixer(node));
        }
      } catch {
        node = createPrimitiveMesh("box");
        (node as THREE.Mesh).material = new THREE.MeshLambertMaterial({
          color: 0xaa4444,
        });
      }
    } else if (object.kind !== "mesh") {
      node = createPrimitiveMesh(object.kind);
    } else {
      node = createPrimitiveMesh("box");
    }
    node.name = object.id;
    this.nodes.set(object.id, node);
    this.scene.add(node);
  }
}

export const CAMERA_PLAYBLAST = "blocking-playblast-cam";
