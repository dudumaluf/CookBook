import {
  VEC3_ONE,
  VEC3_ZERO,
  type BlockingDocument,
  type BlockingObject,
  type EffectorSettings,
  type InstancerSettings,
  type Vec3,
} from "@/types/blocking";

import type { EvaluatedTransform } from "./evaluate";
import { evalObjectAt } from "./evaluate";
import { composeTransform, uncomposeTransform } from "./parent";

export const INSTANCE_SEP = "::";

const IDENTITY: EvaluatedTransform = {
  position: VEC3_ZERO,
  rotation: VEC3_ZERO,
  scale: VEC3_ONE,
};

export function instanceNodeId(sourceId: string, index: number): string {
  return `${sourceId}${INSTANCE_SEP}${index}`;
}

export function sourceIdFromInstance(id: string): string | null {
  const i = id.indexOf(INSTANCE_SEP);
  return i > 0 ? id.slice(0, i) : null;
}

export function instanceCount(settings: InstancerSettings): number {
  if (settings.mode === "grid") return settings.columns * settings.rows;
  return settings.count;
}

export function instancerAncestor(
  objects: readonly BlockingObject[],
  id: string,
): BlockingObject | undefined {
  const seen = new Set<string>();
  let cur: string | undefined = objects.find((o) => o.id === id)?.parentId;
  while (cur) {
    if (seen.has(cur)) return undefined;
    seen.add(cur);
    const obj = objects.find((o) => o.id === cur);
    if (!obj) return undefined;
    if (obj.kind === "instancer") return obj;
    cur = obj.parentId;
  }
  return undefined;
}

export function isClonedSource(
  objects: readonly BlockingObject[],
  obj: BlockingObject,
): boolean {
  if (obj.kind === "instancer" || obj.kind === "effector") return false;
  return Boolean(instancerAncestor(objects, obj.id));
}

export function instancerSources(
  objects: readonly BlockingObject[],
  instancerId: string,
): BlockingObject[] {
  return objects.filter(
    (o) =>
      o.parentId === instancerId &&
      o.kind !== "effector" &&
      o.kind !== "instancer",
  );
}

export function instancerEffectors(
  objects: readonly BlockingObject[],
  instancerId: string,
): BlockingObject[] {
  return objects.filter((o) => o.parentId === instancerId && o.kind === "effector");
}

export function cloneSubtree(
  objects: readonly BlockingObject[],
  rootId: string,
): BlockingObject[] {
  const out: BlockingObject[] = [];
  const walk = (id: string) => {
    const obj = objects.find((o) => o.id === id);
    if (!obj || obj.kind === "effector") return;
    out.push(obj);
    for (const child of objects.filter((o) => o.parentId === id)) walk(child.id);
  };
  walk(rootId);
  return out;
}

export interface InstanceSlot {
  nodeId: string;
  sourceId: string;
  instancerId: string;
  index: number;
}

export function listInstanceSlots(doc: BlockingDocument): InstanceSlot[] {
  const slots: InstanceSlot[] = [];
  for (const inst of doc.objects) {
    if (inst.kind !== "instancer" || !inst.instancer) continue;
    const n = instanceCount(inst.instancer);
    for (const root of instancerSources(doc.objects, inst.id)) {
      for (const source of cloneSubtree(doc.objects, root.id)) {
        for (let i = 0; i < n; i++) {
          slots.push({
            nodeId: instanceNodeId(source.id, i),
            sourceId: source.id,
            instancerId: inst.id,
            index: i,
          });
        }
      }
    }
  }
  return slots;
}

function hash01(seed: number, index: number, channel: number): number {
  const x = Math.sin(seed * 12.9898 + index * 78.233 + channel * 45.164) * 43758.5453;
  return x - Math.floor(x);
}

function signedUnit(seed: number, index: number, channel: number): number {
  return hash01(seed, index, channel) * 2 - 1;
}

export function layoutTransform(
  settings: InstancerSettings,
  index: number,
): EvaluatedTransform {
  if (settings.mode === "grid") {
    const col = index % settings.columns;
    const row = Math.floor(index / settings.columns) % settings.rows;
    return {
      position: [
        col * settings.spacing[0],
        0,
        row * settings.spacing[2],
      ],
      rotation: VEC3_ZERO,
      scale: VEC3_ONE,
    };
  }
  if (settings.mode === "scatter") {
    return {
      position: [
        signedUnit(settings.seed, index, 0) * (settings.spacing[0] / 2),
        signedUnit(settings.seed, index, 1) * (settings.spacing[1] / 2),
        signedUnit(settings.seed, index, 2) * (settings.spacing[2] / 2),
      ],
      rotation: VEC3_ZERO,
      scale: VEC3_ONE,
    };
  }
  return {
    position: [
      index * settings.spacing[0],
      index * settings.spacing[1],
      index * settings.spacing[2],
    ],
    rotation: VEC3_ZERO,
    scale: VEC3_ONE,
  };
}

export function effectorTransform(
  settings: EffectorSettings,
  index: number,
  count: number,
): EvaluatedTransform {
  const s = settings.strength;
  const weight =
    settings.type === "step"
      ? count <= 1
        ? 0
        : (index / (count - 1)) * s
      : s;
  const axis = (channel: number): number =>
    settings.type === "random"
      ? signedUnit(settings.seed, index, channel) * s
      : weight;
  const pos: Vec3 = settings.position
    ? [axis(0) * settings.amount[0], axis(1) * settings.amount[1], axis(2) * settings.amount[2]]
    : VEC3_ZERO;
  const rot: Vec3 = settings.rotation
    ? [axis(3) * settings.amount[0], axis(4) * settings.amount[1], axis(5) * settings.amount[2]]
    : VEC3_ZERO;
  const scl: Vec3 = settings.scale
    ? [
        1 + axis(6) * settings.amount[0],
        1 + axis(7) * settings.amount[1],
        1 + axis(8) * settings.amount[2],
      ]
    : VEC3_ONE;
  return { position: pos, rotation: rot, scale: scl };
}

export function stackedEffectors(
  effectors: readonly BlockingObject[],
  index: number,
  count: number,
): EvaluatedTransform {
  let cur = IDENTITY;
  for (const obj of effectors) {
    if (!obj.effector) continue;
    cur = composeTransform(cur, effectorTransform(obj.effector, index, count));
  }
  return cur;
}

export function evalInstanceAt(
  doc: BlockingDocument,
  slot: InstanceSlot,
  tMs: number,
): EvaluatedTransform {
  const instancer = doc.objects.find((o) => o.id === slot.instancerId);
  const source = doc.objects.find((o) => o.id === slot.sourceId);
  if (!instancer?.instancer || !source) return IDENTITY;
  const instW = evalObjectAt(instancer, tMs, doc.objects);
  const inLocal = uncomposeTransform(
    instW,
    evalObjectAt(source, tMs, doc.objects),
  );
  const n = instanceCount(instancer.instancer);
  const placed = composeTransform(
    layoutTransform(instancer.instancer, slot.index),
    stackedEffectors(instancerEffectors(doc.objects, instancer.id), slot.index, n),
  );
  return composeTransform(instW, composeTransform(placed, inLocal));
}
