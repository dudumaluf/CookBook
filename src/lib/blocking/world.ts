import * as THREE from "three";

import { evalCameraAt, evalObjectAt, type EvaluatedTransform } from "./evaluate";
import { evalInstanceAt, instanceCount, isClonedSource, listInstanceSlots } from "./instance";
import { loadExternalMesh } from "./load-mesh";
import { cameraAtDoc } from "./shots";
import { vatVertexAt } from "./vat";
import {
  DEFAULT_OBJECT_HEX,
  isPrimitiveKind,
  type BlockingDocument,
  type BlockingObject,
  type PrimitiveKind,
} from "@/types/blocking";

function hexToInt(hex: string): number {
  return Number.parseInt(hex.slice(1), 16);
}

function colorFor(object: BlockingObject): number {
  if (object.color) return hexToInt(object.color);
  return hexToInt(DEFAULT_OBJECT_HEX[object.kind] ?? "#888888");
}

export function createPrimitiveMesh(kind: PrimitiveKind, color = 0x888888): THREE.Mesh {
  let geo: THREE.BufferGeometry;
  if (kind === "sphere") geo = new THREE.SphereGeometry(0.5, 24, 16);
  else if (kind === "capsule") geo = new THREE.CapsuleGeometry(0.35, 1.1, 6, 12);
  else if (kind === "cylinder") geo = new THREE.CylinderGeometry(0.4, 0.4, 1.2, 16);
  else if (kind === "plane") {
    geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
  } else if (kind === "instancer") geo = new THREE.BoxGeometry(0.55, 0.55, 0.55);
  else if (kind === "effector") geo = new THREE.OctahedronGeometry(0.22);
  else geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshLambertMaterial({
    color,
    side: THREE.DoubleSide,
    wireframe: kind === "instancer" || kind === "effector",
  });
  return new THREE.Mesh(geo, mat);
}

function createVatMesh(vertexCount: number, color = 0x9ad0c2): THREE.Mesh {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(Math.max(3, vertexCount * 3));
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.blockingTint = true;
  return mesh;
}

export function applyColor(node: THREE.Object3D, hex: number, force = false): void {
  node.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const mat = child.material;
    const list = Array.isArray(mat) ? mat : [mat];
    for (const m of list) {
      if (m && "color" in m && (force || child.userData.blockingTint)) {
        (m as THREE.MeshLambertMaterial).color.setHex(hex);
      }
    }
  });
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
  private readonly instanced = new Map<string, THREE.InstancedMesh>();
  private lastIds = "";
  private readonly dummy = new THREE.Object3D();

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

  pickables(): THREE.Object3D[] {
    return [...this.nodes.values(), ...this.instanced.values()];
  }

  async sync(doc: BlockingDocument, tMs: number): Promise<void> {
    const ids = doc.objects.map((o) => `${o.id}:${o.kind}:${o.meshUrl ?? ""}`).join("|");
    const rebuild = ids !== this.lastIds;
    this.lastIds = ids;
    const slots = listInstanceSlots(doc);
    if (rebuild) {
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
        if (!this.nodes.has(object.id)) pending.push(this.spawn(object));
      }
      await Promise.all(pending);
    }

    for (const object of doc.objects) {
      const node = this.nodes.get(object.id);
      if (!node) continue;
      const cloned = isClonedSource(doc.objects, object);
      node.visible = object.visible && !cloned;
      applyEvaluated(node, evalObjectAt(object, tMs, doc.objects), object.kind);
      if (object.kind === "vat" && object.vat && node instanceof THREE.Mesh) {
        const attr = node.geometry.getAttribute("position");
        if (attr) {
          for (let i = 0; i < object.vat.vertexCount; i++) {
            const v = vatVertexAt(object.vat, tMs, i);
            attr.setXYZ(i, v[0], v[1], v[2]);
          }
          attr.needsUpdate = true;
          node.geometry.computeVertexNormals();
        }
      }
      if (object.kind !== "mesh" || object.color) {
        applyColor(node, colorFor(object), object.kind !== "mesh" || Boolean(object.color));
      }
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

    this.syncInstances(doc, tMs, slots);

    const cam = evalCameraAt(cameraAtDoc(doc, tMs), tMs, doc.objects);
    this.playblastCamera.fov = cam.fov;
    this.playblastCamera.near = cam.near;
    this.playblastCamera.far = cam.far;
    this.playblastCamera.aspect = doc.width / Math.max(1, doc.height);
    this.playblastCamera.position.set(cam.position[0], cam.position[1], cam.position[2]);
    this.playblastCamera.lookAt(cam.lookAt[0], cam.lookAt[1], cam.lookAt[2]);
    this.playblastCamera.updateProjectionMatrix();
  }

  private syncInstances(
    doc: BlockingDocument,
    tMs: number,
    slots: ReturnType<typeof listInstanceSlots>,
  ): void {
    const groups = new Map<string, typeof slots>();
    for (const slot of slots) {
      const key = `${slot.instancerId}:${slot.sourceId}`;
      const list = groups.get(key) ?? [];
      list.push(slot);
      groups.set(key, list);
    }
    for (const [key, mesh] of this.instanced) {
      if (!groups.has(key)) {
        this.scene.remove(mesh);
        this.instanced.delete(key);
      }
    }
    for (const [key, group] of groups) {
      const source = doc.objects.find((o) => o.id === group[0]!.sourceId);
      const sourceNode = this.nodes.get(group[0]!.sourceId);
      if (!source || !sourceNode) continue;
      let geo: THREE.BufferGeometry | undefined;
      let mat: THREE.Material | undefined;
      sourceNode.traverse((child) => {
        if (geo || !(child instanceof THREE.Mesh)) return;
        geo = child.geometry;
        mat = Array.isArray(child.material) ? child.material[0] : child.material;
      });
      if (!geo || !mat) continue;
      const instancer = doc.objects.find((o) => o.id === group[0]!.instancerId);
      const n = instancer?.instancer ? instanceCount(instancer.instancer) : group.length;
      let inst = this.instanced.get(key);
      if (!inst || inst.count !== n) {
        if (inst) this.scene.remove(inst);
        inst = new THREE.InstancedMesh(geo, mat, n);
        inst.name = key;
        inst.userData.sourceId = source.id;
        this.instanced.set(key, inst);
        this.scene.add(inst);
      }
      inst.visible = source.visible;
      for (const slot of group) {
        const t = evalInstanceAt(doc, slot, tMs);
        this.dummy.position.set(t.position[0], t.position[1], t.position[2]);
        this.dummy.rotation.set(
          THREE.MathUtils.degToRad(t.rotation[0]),
          THREE.MathUtils.degToRad(t.rotation[1]),
          THREE.MathUtils.degToRad(t.rotation[2]),
        );
        this.dummy.scale.set(t.scale[0], t.scale[1], t.scale[2]);
        this.dummy.updateMatrix();
        inst.setMatrixAt(slot.index, this.dummy.matrix);
      }
      inst.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const node of this.nodes.values()) this.scene.remove(node);
    for (const mesh of this.instanced.values()) this.scene.remove(mesh);
    this.nodes.clear();
    this.instanced.clear();
    this.mixers.clear();
    this.lastIds = "";
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
        node = createPrimitiveMesh("box", 0xaa4444);
        node.traverse((c) => {
          if (c instanceof THREE.Mesh) c.userData.blockingTint = true;
        });
      }
    } else if (object.kind === "vat") {
      node = createVatMesh(object.vat?.vertexCount ?? 8, colorFor(object));
    } else if (object.kind !== "mesh" && isPrimitiveKind(object.kind)) {
      node = createPrimitiveMesh(object.kind, colorFor(object));
      node.traverse((c) => {
        if (c instanceof THREE.Mesh) c.userData.blockingTint = true;
      });
    } else {
      node = createPrimitiveMesh("box", colorFor(object));
      node.traverse((c) => {
        if (c instanceof THREE.Mesh) c.userData.blockingTint = true;
      });
    }
    node.name = object.id;
    this.nodes.set(object.id, node);
    this.scene.add(node);
  }
}

export const CAMERA_PLAYBLAST = "blocking-playblast-cam";
