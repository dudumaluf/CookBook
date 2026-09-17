import type { Vec3 } from "@/types/blocking";

type FigureOp = {
  op: string;
  [key: string]: unknown;
};

/**
 * Thin primitive person: named hierarchy, not a rig.
 * Root walks; limbs swing locally.
 */
export function figureOps(args: {
  id?: string;
  name?: string;
  position?: Vec3;
}): FigureOp[] {
  const root = args.id ?? "figure";
  const name = args.name?.trim() || "Figure";
  const pos = args.position ?? [0, 0, 0];
  return [
    {
      op: "add_primitive",
      kind: "capsule",
      id: root,
      name,
      position: [pos[0], pos[1] + 1, pos[2]],
      scale: [1, 1, 1],
    },
    {
      op: "add_primitive",
      kind: "box",
      id: `${root}_torso`,
      name: "Torso",
      position: [pos[0], pos[1] + 1.35, pos[2]],
      scale: [0.55, 0.45, 0.28],
    },
    {
      op: "add_primitive",
      kind: "sphere",
      id: `${root}_head`,
      name: "Head",
      position: [pos[0], pos[1] + 1.85, pos[2]],
      scale: [0.38, 0.38, 0.38],
    },
    {
      op: "add_primitive",
      kind: "capsule",
      id: `${root}_arm_l`,
      name: "Arm L",
      position: [pos[0] - 0.42, pos[1] + 1.35, pos[2]],
      scale: [0.28, 0.45, 0.28],
    },
    {
      op: "add_primitive",
      kind: "capsule",
      id: `${root}_arm_r`,
      name: "Arm R",
      position: [pos[0] + 0.42, pos[1] + 1.35, pos[2]],
      scale: [0.28, 0.45, 0.28],
    },
    {
      op: "add_primitive",
      kind: "capsule",
      id: `${root}_leg_l`,
      name: "Leg L",
      position: [pos[0] - 0.16, pos[1] + 0.45, pos[2]],
      scale: [0.32, 0.5, 0.32],
    },
    {
      op: "add_primitive",
      kind: "capsule",
      id: `${root}_leg_r`,
      name: "Leg R",
      position: [pos[0] + 0.16, pos[1] + 0.45, pos[2]],
      scale: [0.32, 0.5, 0.32],
    },
    { op: "set_parent", id: `${root}_torso`, parentId: root },
    { op: "set_parent", id: `${root}_head`, parentId: `${root}_torso` },
    { op: "set_parent", id: `${root}_arm_l`, parentId: `${root}_torso` },
    { op: "set_parent", id: `${root}_arm_r`, parentId: `${root}_torso` },
    { op: "set_parent", id: `${root}_leg_l`, parentId: root },
    { op: "set_parent", id: `${root}_leg_r`, parentId: root },
  ];
}

/** Root A→B plus a short looping limb swing. Writes pose keys on purpose. */
export function locomotionOps(args: {
  id: string;
  from: Vec3;
  to: Vec3;
  startMs?: number;
  endMs?: number;
}): FigureOp[] {
  const start = Math.max(0, args.startMs ?? 0);
  const end = Math.max(start + 200, args.endMs ?? start + 2000);
  const mid = Math.round((start + end) / 2);
  const ops: FigureOp[] = [
    {
      op: "set_transform",
      id: args.id,
      position: args.from,
      tMs: start,
    },
    {
      op: "set_transform",
      id: args.id,
      position: args.to,
      tMs: end,
    },
  ];
  const swing = (limb: string, sign: number) => {
    ops.push(
      {
        op: "set_keyframe",
        id: limb,
        channel: "rotation",
        tMs: start,
        value: [sign * 22, 0, 0],
      },
      {
        op: "set_keyframe",
        id: limb,
        channel: "rotation",
        tMs: mid,
        value: [sign * -22, 0, 0],
      },
      {
        op: "set_keyframe",
        id: limb,
        channel: "rotation",
        tMs: end,
        value: [sign * 22, 0, 0],
      },
    );
  };
  swing(`${args.id}_arm_l`, 1);
  swing(`${args.id}_arm_r`, -1);
  swing(`${args.id}_leg_l`, -1);
  swing(`${args.id}_leg_r`, 1);
  return ops;
}
