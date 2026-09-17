import {
  CAMERA_ID,
  type BlockingDocument,
  type Vec3,
} from "@/types/blocking";

import { evalObjectAt } from "./evaluate";

export const CAMERA_PRESETS = [
  "wide",
  "medium",
  "close",
  "ots",
  "profile",
] as const;

export type CameraPreset = (typeof CAMERA_PRESETS)[number];

export function isCameraPreset(value: unknown): value is CameraPreset {
  return typeof value === "string" && (CAMERA_PRESETS as readonly string[]).includes(value);
}

/**
 * Camera pose from a subject. Y-up meters. lookAt sits on the subject.
 */
export function cameraPresetPose(
  doc: BlockingDocument,
  preset: CameraPreset,
  subjectId: string,
  tMs: number,
): { position: Vec3; lookAt: Vec3 } | { error: string } {
  const subject = doc.objects.find((o) => o.id === subjectId);
  if (!subject) return { error: `No subject "${subjectId}".` };
  const at = evalObjectAt(subject, tMs, doc.objects);
  const look: Vec3 = [at.position[0], at.position[1] + 1.2, at.position[2]];
  const yaw = (at.rotation[1] * Math.PI) / 180;
  const forward: Vec3 = [Math.sin(yaw), 0, Math.cos(yaw)];
  const right: Vec3 = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const place = (back: number, side: number, lift: number): Vec3 => [
    look[0] - forward[0] * back + right[0] * side,
    look[1] + lift,
    look[2] - forward[2] * back + right[2] * side,
  ];
  if (preset === "wide") return { position: place(8, 0, 1.2), lookAt: look };
  if (preset === "medium") return { position: place(4.2, 0, 0.35), lookAt: look };
  if (preset === "close") return { position: place(1.8, 0.15, 0.15), lookAt: look };
  if (preset === "ots") {
    return {
      position: place(2.4, 0.85, 0.25),
      lookAt: [look[0] + forward[0] * 0.4, look[1], look[2] + forward[2] * 0.4],
    };
  }
  return {
    position: place(0.2, 3.2, 0.2),
    lookAt: look,
  };
}

export function applyPresetOp(
  preset: CameraPreset,
  subjectId: string,
  tMs: number,
  cameraId = CAMERA_ID,
): {
  op: "apply_preset";
  preset: CameraPreset;
  subjectId: string;
  tMs: number;
  cameraId: string;
} {
  return { op: "apply_preset", preset, subjectId, tMs, cameraId };
}
