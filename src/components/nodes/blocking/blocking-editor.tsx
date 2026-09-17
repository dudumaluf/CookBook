"use client";

import {
  Box,
  Circle,
  Copy,
  Cylinder,
  Diamond,
  Loader2,
  Redo2,
  Sparkles,
  Square,
  Undo2,
  UserRound,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { uploadMeshAsset } from "@/lib/library/upload-asset";
import { runBlockingAgent } from "@/lib/blocking/agent";
import {
  blockingTransformOp,
  cameraPairSelected,
  extraTransformOps,
  groupTranslateCamera,
  type ViewportTransform,
} from "@/lib/blocking/camera-gizmo";
import { captureShotJpeg } from "@/lib/blocking/capture";
import { applyBlockingOp, type BlockingOp } from "@/lib/blocking/ops";
import { evalCameraAt, evalObjectAt } from "@/lib/blocking/evaluate";
import { circleKeyMs, editTargetMs, findPose } from "@/lib/blocking/pose";
import { CAMERA_PRESETS, type CameraPreset } from "@/lib/blocking/presets";
import { cameraAtDoc } from "@/lib/blocking/shots";
import {
  CAMERA_ID,
  DEFAULT_OBJECT_HEX,
  LOOK_AT_ID,
  type BlockingDocument,
  type PrimitiveKind,
  type Vec3,
} from "@/types/blocking";
import { cn } from "@/lib/utils";

import {
  BlockingViewport,
  type GizmoMode,
} from "./blocking-viewport";
import { BlockingDopeSheet } from "./blocking-dopesheet";
import {
  FovRow,
  XyzRow,
  channelKeyed,
} from "./blocking-inspector";
import { BlockingOutliner } from "./blocking-outliner";
import { BlockingShotStrip } from "./blocking-shot-strip";
import { BlockingTimeline, type TimelineKey } from "./blocking-timeline";
import {
  deleteBlockingOps,
  isTypingTarget,
  nextSelection,
  selectionMode,
} from "./editor-actions";
import { useSceneHistory } from "./use-scene-history";
import { ScrubNumberInput } from "./scrub-number-input";

const COMMIT_MS = 120;

const PRIMITIVES: { kind: PrimitiveKind; label: string; icon: typeof Box }[] = [
  { kind: "capsule", label: "Capsule", icon: UserRound },
  { kind: "box", label: "Box", icon: Box },
  { kind: "sphere", label: "Sphere", icon: Circle },
  { kind: "cylinder", label: "Cylinder", icon: Cylinder },
  { kind: "plane", label: "Plane", icon: Square },
  { kind: "instancer", label: "Instancer", icon: Copy },
  { kind: "effector", label: "Effector", icon: Sparkles },
];

export function BlockingEditor({
  doc: initialDoc,
  onChange,
  onClose,
  playheadMs,
  playing,
  onPlayhead,
  onPlaying,
}: {
  doc: BlockingDocument;
  onChange: (doc: BlockingDocument) => void;
  onClose: () => void;
  playheadMs: number;
  playing: boolean;
  onPlayhead: (ms: number) => void;
  onPlaying: (playing: boolean) => void;
}) {
  const [doc, setDoc] = useState(initialDoc);
  const [selectedIds, setSelectedIds] = useState<string[]>([CAMERA_ID]);
  const selectedId = selectedIds[selectedIds.length - 1] ?? null;
  const [gizmoMode, setGizmoMode] = useState<GizmoMode>("translate");
  const [shotView, setShotView] = useState(false);
  const [linkCameraTarget, setLinkCameraTarget] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentLog, setAgentLog] = useState<string>("");
  const [importError, setImportError] = useState<string>("");
  const [selectedKey, setSelectedKey] = useState<TimelineKey | null>(null);
  const [autoKey, setAutoKey] = useState(false);
  const { push, undo, redo, canUndo, canRedo } = useSceneHistory(initialDoc);
  const skipHistoryRef = useRef(false);

  const docRef = useRef(doc);
  const onChangeRef = useRef(onChange);
  const selectedIdRef = useRef(selectedId);
  const selectedIdsRef = useRef(selectedIds);
  const selectedKeyRef = useRef(selectedKey);
  const applyRef = useRef<(op: BlockingOp) => ReturnType<typeof applyBlockingOp>>(
    () => ({ doc: initialDoc }),
  );
  const undoRef = useRef(undo);
  const redoRef = useRef(redo);
  const closeRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    docRef.current = doc;
    onChangeRef.current = onChange;
    selectedIdRef.current = selectedId;
    selectedIdsRef.current = selectedIds;
    selectedKeyRef.current = selectedKey;
    undoRef.current = undo;
    redoRef.current = redo;
  });
  useEffect(() => {
    const t = setTimeout(() => onChangeRef.current(docRef.current), COMMIT_MS);
    return () => clearTimeout(t);
  }, [doc]);

  const apply = useCallback((op: BlockingOp) => {
    const prev = docRef.current;
    const next = applyBlockingOp(prev, op);
    if (next.error) setImportError(next.error);
    else setImportError("");
    if (next.doc !== prev) {
      setDoc(next.doc);
      if (!skipHistoryRef.current) push(next.doc);
    }
    if (next.createdId) setSelectedIds([next.createdId]);
    return next;
  }, [push]);
  applyRef.current = apply;

  const applyMany = (ops: BlockingOp[]) => {
    if (ops.length === 0) return;
    let cur = docRef.current;
    let error: string | undefined;
    let createdId: string | undefined;
    for (const op of ops) {
      const next = applyBlockingOp(cur, op);
      if (next.error) {
        error = next.error;
        break;
      }
      cur = next.doc;
      if (next.createdId) createdId = next.createdId;
    }
    if (error) setImportError(error);
    else setImportError("");
    if (cur !== docRef.current) {
      setDoc(cur);
      push(cur);
    }
    if (createdId) setSelectedIds([createdId]);
  };

  const close = useCallback(() => {
    onChangeRef.current(docRef.current);
    onClose();
  }, [onClose]);
  closeRef.current = close;

  const beginScrub = () => {
    skipHistoryRef.current = true;
  };
  const endScrub = () => {
    skipHistoryRef.current = false;
    push(docRef.current);
  };

  const restore = (next: BlockingDocument | null) => {
    if (!next) return;
    setDoc(next);
    setSelectedKey(null);
  };

  const deleteSelected = () => {
    const ops = deleteBlockingOps({
      selectedIds: selectedIdsRef.current,
      selectedKey: selectedKeyRef.current,
    });
    if (ops.length === 0) return;
    applyMany(ops);
    if (ops[0]?.op === "remove_pose" || ops[0]?.op === "remove_keyframe") {
      setSelectedKey(null);
      return;
    }
    setSelectedIds([CAMERA_ID]);
    setSelectedKey(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setSelectedKey(null);
        setSelectedIds([]);
        return;
      }
      if (!isTypingTarget(e.target)) {
        if (e.key === "w" || e.key === "W") {
          e.preventDefault();
          setGizmoMode("translate");
          return;
        }
        if (e.key === "e" || e.key === "E") {
          e.preventDefault();
          setGizmoMode("rotate");
          return;
        }
        if (e.key === "r" || e.key === "R") {
          e.preventDefault();
          setGizmoMode("scale");
          return;
        }
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "w") {
          e.preventDefault();
          closeRef.current();
          return;
        }
      }
      const typing = isTypingTarget(e.target);
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "z") {
        if (typing) return;
        e.preventDefault();
        e.stopPropagation();
        restore(e.shiftKey ? redoRef.current() : undoRef.current());
        return;
      }
      if (meta && e.key.toLowerCase() === "y") {
        if (typing) return;
        e.preventDefault();
        e.stopPropagation();
        restore(redoRef.current());
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (typing) return;
        e.preventDefault();
        e.stopPropagation();
        deleteSelected();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);

  const posesFor = (id: string) => {
    if (id === CAMERA_ID || id === LOOK_AT_ID) return doc.camera.poseKeys;
    return doc.objects.find((o) => o.id === id)?.poseKeys ?? [];
  };

  const writeMs = (id: string) =>
    editTargetMs({
      autoKey,
      playheadMs,
      selectedKeyT: selectedKey && (selectedKey.id === id || (id === LOOK_AT_ID && selectedKey.id === CAMERA_ID))
        ? selectedKey.tMs
        : selectedKey && selectedKey.id === id
          ? selectedKey.tMs
          : selectedKey
            ? selectedKey.tMs
            : null,
      hasPoseAtPlayhead: Boolean(findPose(posesFor(id === LOOK_AT_ID ? CAMERA_ID : id), playheadMs)),
    });

  const insertMs = (_id: string) =>
    circleKeyMs({
      playheadMs,
      selectedKeyT: selectedKey ? selectedKey.tMs : null,
    });

  const onTransformEnd = useCallback(
    (id: string, next: ViewportTransform) => {
      const t = writeMs(id);
      if (t == null) {
        setImportError("Key to pose here");
        return;
      }
      applyMany([
        blockingTransformOp(id, next, t),
        ...extraTransformOps(
          docRef.current,
          id,
          next,
          selectedIdsRef.current,
          t,
        ),
      ]);
    },
    [playheadMs, autoKey, selectedKey],
  );

  const pick = (
    id: string | null,
    additiveOrEvent?: boolean | React.MouseEvent,
  ) => {
    setSelectedKey(null);
    const event =
      typeof additiveOrEvent === "object" ? additiveOrEvent : undefined;
    const additive =
      typeof additiveOrEvent === "boolean"
        ? additiveOrEvent
        : Boolean(event && (event.shiftKey || event.metaKey || event.ctrlKey));
    const mode = additive
      ? selectionMode(event ?? { shiftKey: false, metaKey: true })
      : "replace";
    const order = [CAMERA_ID, LOOK_AT_ID, ...docRef.current.objects.map((o) => o.id)];
    setSelectedIds((cur) => nextSelection(cur, id, mode, order));
  };

  const cameraSelected = selectedId === CAMERA_ID || selectedId === LOOK_AT_ID;
  const pairGrouped = cameraPairSelected(selectedIds);
  const selected =
    !selectedId || cameraSelected
      ? null
      : doc.objects.find((o) => o.id === selectedId) ?? null;
  const camAt = evalCameraAt(cameraAtDoc(doc, playheadMs), playheadMs, doc.objects);
  const writeTarget = writeMs(selectedId === LOOK_AT_ID ? CAMERA_ID : selectedId ?? CAMERA_ID);
  const writeHint = writeTarget == null ? "Key to pose here" : undefined;
  const objAt = selected ? evalObjectAt(selected, playheadMs, doc.objects) : null;

  const moveCamPoint = (which: "position" | "lookAt", next: Vec3) => {
    const t = writeTarget;
    if (t == null) {
      setImportError("Key to pose here");
      return;
    }
    const grouped = groupTranslateCamera(camAt, which, next, pairGrouped);
    if (!pairGrouped) {
      if (which === "position") {
        apply({
          op: "set_transform",
          id: CAMERA_ID,
          position: next,
          tMs: t,
        });
        return;
      }
      apply({ op: "set_camera", lookAt: next, tMs: t });
      return;
    }
    apply({
      op: "set_camera",
      position: grouped.position,
      lookAt: grouped.lookAt,
      tMs: t,
    });
  };

  const toggleChannelKey = (
    id: string,
    channel: "position" | "rotation" | "scale" | "lookAt" | "fov",
    value: Vec3 | number,
  ) => {
    const t = insertMs(id);
    const poses = posesFor(id === LOOK_AT_ID ? CAMERA_ID : id);
    if (channelKeyed(poses, t, channel)) {
      apply({ op: "remove_pose_channel", id: id === LOOK_AT_ID ? CAMERA_ID : id, tMs: t, channel });
      return;
    }
    if (channel === "fov") {
      apply({ op: "upsert_pose", id: CAMERA_ID, tMs: t, fov: typeof value === "number" ? value : value[0] });
      return;
    }
    if (channel === "lookAt") {
      apply({
        op: "upsert_pose",
        id: CAMERA_ID,
        tMs: t,
        lookAt: value as Vec3,
      });
      return;
    }
    apply({
      op: "upsert_pose",
      id,
      tMs: t,
      [channel]: value,
    });
    setSelectedKey({ id, channel, tMs: t, label: "Pose" });
  };

  const runPrompt = async () => {
    const text = prompt.trim();
    if (!text || agentBusy) return;
    setAgentBusy(true);
    setAgentLog("");
    const ac = new AbortController();
    try {
      const jpeg = await captureShotJpeg(docRef.current, playheadMs);
      const result = await runBlockingAgent(
        docRef.current,
        jpeg
          ? `${text}\n\n[shot view at ${Math.round(playheadMs)}ms attached as JPEG]`
          : text,
        ac.signal,
      );
      if (result.doc !== docRef.current) {
        setDoc(result.doc);
        push(result.doc);
      }
      const lines = result.trace.map((s) => s.name).join(" → ");
      setAgentLog(result.text || lines || "Scene updated.");
    } catch (err) {
      setAgentLog(err instanceof Error ? err.message : "Agent failed.");
    } finally {
      setAgentBusy(false);
    }
  };

  const onImportFile = async (file: File) => {
    setImportError("");
    try {
      const uploaded = await uploadMeshAsset(file);
      apply({
        op: "import_mesh",
        url: uploaded.url,
        name: file.name.replace(/\.[^.]+$/, ""),
      });
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Import failed.");
    }
  };

  return createPortal(
    <div
      data-blocking-editor=""
      className="fixed inset-0 z-[80] flex select-none flex-col bg-background text-foreground"
      onKeyDown={(e) => {
        e.stopPropagation();
      }}
    >
      <header className="flex items-center gap-2 border-b border-border/50 px-3 py-2">
        <span className="text-sm font-medium">3D Blocking</span>
        <div className="flex items-center gap-1">
          {PRIMITIVES.map(({ kind, label, icon: Icon }) => (
            <button
              key={kind}
              type="button"
              title={label}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
              onClick={() => apply({ op: "add_primitive", kind })}
            >
              <Icon className="h-4 w-4" />
            </button>
          ))}
          <button
            type="button"
            title="Figure"
            className="rounded-md px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-foreground/[0.06]"
            onClick={() => apply({ op: "add_figure" })}
          >
            Figure
          </button>
          <button
            type="button"
            title="VAT sample"
            className="rounded-md px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-foreground/[0.06]"
            onClick={() => apply({ op: "add_vat" })}
          >
            VAT
          </button>
        </div>
        <label className="cursor-pointer rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground">
          Import GLB / OBJ / FBX
          <input
            type="file"
            accept=".glb,.gltf,.obj,.fbx,model/gltf-binary,model/gltf+json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onImportFile(f);
              e.target.value = "";
            }}
          />
        </label>
        <div className="ml-2 flex items-center gap-1 text-[11px]">
          {(["translate", "rotate", "scale"] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={cn(
                "rounded-md px-1.5 py-0.5 capitalize",
                gizmoMode === m
                  ? "bg-accent/30 text-foreground"
                  : "text-muted-foreground hover:bg-foreground/[0.06]",
              )}
              onClick={() => setGizmoMode(m)}
            >
              {m === "translate" ? "Move W" : m === "rotate" ? "Rotate E" : "Scale R"}
            </button>
          ))}
        </div>
        <div className="ml-2 flex items-center gap-1 text-[11px]">
          <button
            type="button"
            className={cn(
              "rounded-md px-1.5 py-0.5",
              !shotView ? "bg-accent/30 text-foreground" : "text-muted-foreground hover:bg-foreground/[0.06]",
            )}
            onClick={() => setShotView(false)}
          >
            Orbit
          </button>
          <button
            type="button"
            className={cn(
              "rounded-md px-1.5 py-0.5",
              shotView ? "bg-accent/30 text-foreground" : "text-muted-foreground hover:bg-foreground/[0.06]",
            )}
            onClick={() => setShotView(true)}
          >
            Shot
          </button>
          <button
            type="button"
            title="Move camera and look-at together"
            className={cn(
              "rounded-md px-1.5 py-0.5",
              linkCameraTarget
                ? "bg-accent/30 text-foreground"
                : "text-muted-foreground hover:bg-foreground/[0.06]",
            )}
            onClick={() => setLinkCameraTarget((v) => !v)}
          >
            {linkCameraTarget ? "Linked" : "Unlinked"}
          </button>
        </div>
        <div className="ml-2 flex items-center gap-1 text-[11px]">
          {CAMERA_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className="rounded-md px-1.5 py-0.5 uppercase text-muted-foreground hover:bg-foreground/[0.06]"
              onClick={() => {
                const subject =
                  selected && selected.id !== CAMERA_ID ? selected.id : doc.objects[0]?.id;
                if (!subject) {
                  setImportError("Select a subject for the preset.");
                  return;
                }
                apply({
                  op: "apply_preset",
                  preset: preset as CameraPreset,
                  subjectId: subject,
                  tMs: playheadMs,
                });
              }}
            >
              {preset}
            </button>
          ))}
        </div>
        <div className="ml-2 flex items-center gap-1 text-[11px]">
          <button
            type="button"
            title="Insert a pose at the playhead"
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-muted-foreground hover:bg-foreground/[0.06]"
            onClick={() => {
              if (cameraSelected) {
                apply({
                  op: "upsert_pose",
                  id: CAMERA_ID,
                  tMs: playheadMs,
                  position: camAt.position,
                  lookAt: camAt.lookAt,
                  fov: camAt.fov,
                });
              } else if (selected && objAt) {
                apply({
                  op: "upsert_pose",
                  id: selected.id,
                  tMs: playheadMs,
                  position: objAt.position,
                  rotation: objAt.rotation,
                  scale: objAt.scale,
                });
              }
              setSelectedKey({
                id: cameraSelected ? CAMERA_ID : selected?.id ?? CAMERA_ID,
                channel: "position",
                tMs: playheadMs,
                label: "Pose",
              });
            }}
          >
            <Diamond className="h-3 w-3" />
            Key
          </button>
          <button
            type="button"
            title="Auto-key: gizmos insert a pose at the playhead"
            className={cn(
              "rounded-md px-1.5 py-0.5",
              autoKey
                ? "bg-accent/30 text-foreground"
                : "text-muted-foreground hover:bg-foreground/[0.06]",
            )}
            onClick={() => setAutoKey((v) => !v)}
          >
            Auto-key
          </button>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            title="Undo"
            aria-label="Undo"
            disabled={!canUndo}
            className="rounded-md p-1 text-muted-foreground hover:bg-foreground/[0.06] disabled:opacity-30"
            onClick={() => restore(undo())}
          >
            <Undo2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="Redo"
            aria-label="Redo"
            disabled={!canRedo}
            className="rounded-md p-1 text-muted-foreground hover:bg-foreground/[0.06] disabled:opacity-30"
            onClick={() => restore(redo())}
          >
            <Redo2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="rounded-md p-1 text-muted-foreground hover:bg-foreground/[0.06]"
            onClick={close}
            aria-label="Close editor"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <BlockingOutliner
          doc={doc}
          selectedId={selectedId}
          selectedIds={selectedIds}
          onPick={pick}
          onParent={(child, parentId) => {
            apply({ op: "set_parent", id: child, parentId });
          }}
          onDelete={(id) => {
            const result = apply({ op: "remove_object", id });
            if (!result.error) {
              setSelectedIds((cur) => {
                const next = cur.filter((x) => x !== id);
                return next.length > 0 ? next : [CAMERA_ID];
              });
            }
          }}
        />

        <div className="relative min-w-0 flex-1">
          <BlockingViewport
            doc={doc}
            playheadMs={playheadMs}
            selectedId={selectedId}
            gizmoMode={gizmoMode}
            onSelect={pick}
            onTransformEnd={onTransformEnd}
            shotView={shotView}
            linkCameraTarget={linkCameraTarget || pairGrouped}
          />
        </div>

        <aside className="flex w-60 shrink-0 select-none flex-col gap-2 overflow-y-auto border-l border-border/40 p-2 text-[11px]">
          {selectedIds.length > 1 ? (
            <p className="text-muted-foreground">{selectedIds.length} selected</p>
          ) : null}
          {cameraSelected ? (
            <div className="flex flex-col gap-2">
              <p className="font-medium text-foreground">
                {pairGrouped ? "Camera + Look at" : selectedId === LOOK_AT_ID ? "Look at" : "Camera"}
              </p>
              {writeHint ? <p className="text-[10px] text-muted-foreground">{writeHint}</p> : null}
              <FovRow
                value={camAt.fov}
                keyed={channelKeyed(doc.camera.poseKeys, writeTarget ?? playheadMs, "fov")}
                disabled={writeTarget == null}
                onChange={(v) => apply({ op: "set_camera", fov: v, tMs: writeTarget ?? playheadMs })}
                onKeyToggle={() => toggleChannelKey(CAMERA_ID, "fov", camAt.fov)}
                onScrubStart={beginScrub}
                onScrubEnd={endScrub}
              />
              <XyzRow
                label="Camera"
                value={camAt.position}
                keyed={channelKeyed(doc.camera.poseKeys, writeTarget ?? playheadMs, "position")}
                disabled={writeTarget == null}
                onChange={(next) => moveCamPoint("position", next)}
                onKeyToggle={() => toggleChannelKey(CAMERA_ID, "position", camAt.position)}
                onScrubStart={beginScrub}
                onScrubEnd={endScrub}
              />
              <XyzRow
                label="Look at"
                value={camAt.lookAt}
                keyed={channelKeyed(doc.camera.poseKeys, writeTarget ?? playheadMs, "lookAt")}
                disabled={writeTarget == null}
                onChange={(next) => moveCamPoint("lookAt", next)}
                onKeyToggle={() => toggleChannelKey(CAMERA_ID, "lookAt", camAt.lookAt)}
                onScrubStart={beginScrub}
                onScrubEnd={endScrub}
              />
            </div>
          ) : selected && objAt ? (
            <>
            <p className="font-medium text-foreground">{selected.name}</p>
            {writeHint ? <p className="text-[10px] text-muted-foreground">{writeHint}</p> : null}
            <XyzRow
              label="Position"
              value={objAt.position}
              keyed={channelKeyed(selected.poseKeys, writeTarget ?? playheadMs, "position")}
              disabled={writeTarget == null}
              onChange={(p) =>
                apply({
                  op: "set_transform",
                  id: selected.id,
                  position: p,
                  tMs: writeTarget ?? playheadMs,
                })
              }
              onKeyToggle={() => toggleChannelKey(selected.id, "position", objAt.position)}
              onScrubStart={beginScrub}
              onScrubEnd={endScrub}
            />
            <XyzRow
              label="Rotation"
              value={objAt.rotation}
              keyed={channelKeyed(selected.poseKeys, writeTarget ?? playheadMs, "rotation")}
              disabled={writeTarget == null}
              onChange={(p) =>
                apply({
                  op: "set_transform",
                  id: selected.id,
                  rotation: p,
                  tMs: writeTarget ?? playheadMs,
                })
              }
              onKeyToggle={() => toggleChannelKey(selected.id, "rotation", objAt.rotation)}
              onScrubStart={beginScrub}
              onScrubEnd={endScrub}
            />
            <XyzRow
              label="Scale"
              value={objAt.scale}
              keyed={channelKeyed(selected.poseKeys, writeTarget ?? playheadMs, "scale")}
              disabled={writeTarget == null}
              onChange={(p) =>
                apply({
                  op: "set_transform",
                  id: selected.id,
                  scale: p,
                  tMs: writeTarget ?? playheadMs,
                })
              }
              onKeyToggle={() => toggleChannelKey(selected.id, "scale", objAt.scale)}
              onScrubStart={beginScrub}
              onScrubEnd={endScrub}
            />
            <label className="mt-2 flex items-center gap-2 text-muted-foreground">
              <span className="w-12 shrink-0">color</span>
              <input
                type="color"
                value={selected.color ?? DEFAULT_OBJECT_HEX[selected.kind] ?? "#888888"}
                onChange={(e) =>
                  apply({ op: "set_color", id: selected.id, color: e.target.value })
                }
                className="h-6 w-10 cursor-pointer rounded-sm border border-border/60 bg-transparent"
              />
            </label>
            {selected.kind === "instancer" && selected.instancer ? (
              <div className="mt-2 flex flex-col gap-1.5">
                <p className="font-medium text-foreground">Instancer</p>
                <label className="flex items-center gap-2 text-muted-foreground">
                  <span className="w-12 shrink-0">mode</span>
                  <select
                    value={selected.instancer.mode}
                    onChange={(e) =>
                      apply({
                        op: "set_instancer",
                        id: selected.id,
                        patch: {
                          mode: e.target.value as "linear" | "grid" | "scatter",
                        },
                      })
                    }
                    className="h-6 flex-1 rounded-md border border-border/60 bg-background/40 px-1 text-foreground"
                  >
                    <option value="linear">Linear</option>
                    <option value="grid">Grid</option>
                    <option value="scatter">Scatter</option>
                  </select>
                </label>
                {selected.instancer.mode === "grid" ? (
                  <>
                    <InspectorBlock
                      onScrubStart={beginScrub}
                      onScrubEnd={endScrub}
                      title=""
                      rows={[
                        [
                          "cols",
                          selected.instancer.columns,
                          (v) =>
                            apply({
                              op: "set_instancer",
                              id: selected.id,
                              patch: { columns: v },
                            }),
                        ],
                        [
                          "rows",
                          selected.instancer.rows,
                          (v) =>
                            apply({
                              op: "set_instancer",
                              id: selected.id,
                              patch: { rows: v },
                            }),
                        ],
                      ]}
                    />
                  </>
                ) : (
                  <InspectorBlock
                    onScrubStart={beginScrub}
                    onScrubEnd={endScrub}
                    title=""
                    rows={[
                      [
                        "count",
                        selected.instancer.count,
                        (v) =>
                          apply({
                            op: "set_instancer",
                            id: selected.id,
                            patch: { count: v },
                          }),
                      ],
                    ]}
                  />
                )}
                <InspectorBlock
                  onScrubStart={beginScrub}
                  onScrubEnd={endScrub}
                  title=""
                  rows={
                    (["x", "y", "z"] as const).map((axis, i) => [
                      `gap ${axis}`,
                      selected.instancer!.spacing[i]!,
                      (v: number) => {
                        const spacing: Vec3 = [...selected.instancer!.spacing];
                        spacing[i] = v;
                        apply({
                          op: "set_instancer",
                          id: selected.id,
                          patch: { spacing },
                        });
                      },
                    ]) as [string, number, (v: number) => void][]
                  }
                />
                {selected.instancer.mode === "scatter" ? (
                  <InspectorBlock
                    onScrubStart={beginScrub}
                    onScrubEnd={endScrub}
                    title=""
                    rows={[
                      [
                        "seed",
                        selected.instancer.seed,
                        (v) =>
                          apply({
                            op: "set_instancer",
                            id: selected.id,
                            patch: { seed: v },
                          }),
                      ],
                    ]}
                  />
                ) : null}
                <p className="text-[10px] text-muted-foreground">
                  Parent objects under this instancer. Drop an Effector on it to
                  jitter P / R / S.
                </p>
              </div>
            ) : null}
            {selected.kind === "vat" && selected.vat ? (
              <div className="mt-2 flex flex-col gap-1.5">
                <p className="font-medium text-foreground">VAT clips</p>
                {selected.vat.clips.map((clip) => (
                  <button
                    key={clip.name}
                    type="button"
                    className="rounded-md px-1.5 py-0.5 text-left text-muted-foreground hover:bg-foreground/[0.06]"
                    onClick={() =>
                      apply({
                        op: "set_vat_clip",
                        id: selected.id,
                        clip: clip.name,
                        tMs: playheadMs,
                      })
                    }
                  >
                    {clip.role} · {clip.name}
                  </button>
                ))}
              </div>
            ) : null}
            {selected.kind === "effector" && selected.effector ? (
              <div className="mt-2 flex flex-col gap-1.5">
                <p className="font-medium text-foreground">Effector</p>
                <label className="flex items-center gap-2 text-muted-foreground">
                  <span className="w-12 shrink-0">type</span>
                  <select
                    value={selected.effector.type}
                    onChange={(e) =>
                      apply({
                        op: "set_effector",
                        id: selected.id,
                        patch: { type: e.target.value as "random" | "step" },
                      })
                    }
                    className="h-6 flex-1 rounded-md border border-border/60 bg-background/40 px-1 text-foreground"
                  >
                    <option value="random">Random</option>
                    <option value="step">Step</option>
                  </select>
                </label>
                {(
                  [
                    ["P", "position"],
                    ["R", "rotation"],
                    ["S", "scale"],
                  ] as const
                ).map(([label, key]) => (
                  <label
                    key={key}
                    className="flex items-center gap-2 text-muted-foreground"
                  >
                    <input
                      type="checkbox"
                      checked={selected.effector![key]}
                      onChange={(e) =>
                        apply({
                          op: "set_effector",
                          id: selected.id,
                          patch: { [key]: e.target.checked },
                        })
                      }
                    />
                    affect {label}
                  </label>
                ))}
                <InspectorBlock
                  onScrubStart={beginScrub}
                  onScrubEnd={endScrub}
                  title=""
                  rows={[
                    [
                      "str",
                      selected.effector.strength,
                      (v) =>
                        apply({
                          op: "set_effector",
                          id: selected.id,
                          patch: { strength: v },
                        }),
                    ],
                    ...(
                      (["x", "y", "z"] as const).map((axis, i) => [
                        `amt ${axis}`,
                        selected.effector!.amount[i]!,
                        (v: number) => {
                          const amount: Vec3 = [...selected.effector!.amount];
                          amount[i] = v;
                          apply({
                            op: "set_effector",
                            id: selected.id,
                            patch: { amount },
                          });
                        },
                      ]) as [string, number, (v: number) => void][]
                    ),
                    [
                      "seed",
                      selected.effector.seed,
                      (v) =>
                        apply({
                          op: "set_effector",
                          id: selected.id,
                          patch: { seed: v },
                        }),
                    ],
                  ]}
                />
                <p className="text-[10px] text-muted-foreground">
                  Parent this onto an Instancer. Stack several — each picks P / R
                  / S.
                </p>
              </div>
            ) : null}
            </>
          ) : (
            <p className="text-muted-foreground">Select an object.</p>
          )}
          <label className="mt-2 flex flex-col gap-1 text-muted-foreground">
            Duration (s)
            <ScrubNumberInput
              min={0.2}
              max={60}
              step={0.1}
              value={doc.durationMs / 1000}
              onChange={(v) =>
                apply({ op: "set_duration", durationMs: v * 1000 })
              }
              onScrubStart={beginScrub}
              onScrubEnd={endScrub}
              className="h-7 rounded-md border border-border/60 bg-background/40 px-2 text-foreground"
            />
          </label>
        </aside>
      </div>

      <BlockingTimeline
        doc={doc}
        playheadMs={playheadMs}
        selectedId={selectedId}
        selectedKey={selectedKey}
        playing={playing}
        onScrub={(ms) => {
          onPlaying(false);
          onPlayhead(ms);
        }}
        onTogglePlay={() => onPlaying(!playing)}
        onSelectKey={(key) => {
          setSelectedKey(key);
          setSelectedIds([key.channel === "lookAt" ? LOOK_AT_ID : key.id]);
        }}
        onMoveKey={(key, toMs) => {
          const result = apply({
            op: "move_keyframe",
            id: key.id,
            channel: key.channel,
            fromMs: key.tMs,
            toMs,
          });
          if (!result.error) {
            setSelectedKey({ ...key, tMs: Math.max(1, toMs) });
          }
        }}
        onSetKey={() => {
          if (selectedId === CAMERA_ID || selectedId === LOOK_AT_ID) {
            apply({
              op: "set_camera",
              position: camAt.position,
              lookAt: camAt.lookAt,
              fov: camAt.fov,
              tMs: playheadMs,
            });
            return;
          }
          if (selected && objAt) {
            apply({
              op: "set_transform",
              id: selected.id,
              position: objAt.position,
              rotation: objAt.rotation,
              scale: objAt.scale,
              tMs: playheadMs,
            });
          }
        }}
      />
      <BlockingShotStrip
        doc={doc}
        playheadMs={playheadMs}
        onSplit={(tMs, cameraId) => apply({ op: "add_shot", tMs, cameraId })}
        onMoveCut={(afterIndex, toMs) => apply({ op: "move_shot_cut", afterIndex, toMs })}
        onAddCamera={() => apply({ op: "add_camera" })}
      />
      <BlockingDopeSheet
        doc={doc}
        playheadMs={playheadMs}
        selectedId={selectedId}
        selectedKey={selectedKey}
        onSelectKey={(key) => {
          setSelectedKey(key);
          setSelectedIds([key.id]);
        }}
        onMoveKey={(key, toMs) => {
          const result = apply({
            op: "move_keyframe",
            id: key.id,
            channel: key.channel,
            fromMs: key.tMs,
            toMs,
          });
          if (!result.error) setSelectedKey({ ...key, tMs: Math.max(1, toMs) });
        }}
      />

      <div className="flex items-center gap-2 border-t border-border/40 px-3 py-2">
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void runPrompt();
            }
          }}
          placeholder="Describe the blocking… e.g. two capsules cross left to right, camera dollies in"
          className="h-8 flex-1 rounded-md border border-border/60 bg-background/40 px-2 text-xs"
        />
        <button
          type="button"
          disabled={agentBusy || !prompt.trim()}
          className="rounded-md bg-foreground/[0.08] px-2 py-1 text-xs disabled:opacity-40"
          onClick={() => void runPrompt()}
        >
          {agentBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Ask"}
        </button>
      </div>
      {agentLog || importError ? (
        <p className="px-3 pb-2 text-[11px] text-muted-foreground">
          {importError || agentLog}
        </p>
      ) : null}
    </div>,
    document.body,
  );
}

function InspectorBlock({
  title,
  rows,
  onScrubStart,
  onScrubEnd,
}: {
  title: string;
  rows: [string, number, (v: number) => void][];
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {title ? <p className="font-medium text-foreground">{title}</p> : null}
      {rows.map(([label, value, onChange]) => (
        <label
          key={label}
          className="flex items-center gap-2 text-muted-foreground"
        >
          <ScrubNumberInput
            label={label}
            labelClassName="w-12 shrink-0"
            value={value}
            onChange={onChange}
            onScrubStart={onScrubStart}
            onScrubEnd={onScrubEnd}
            className="h-6 w-full rounded-md border border-border/60 bg-background/40 px-1 text-foreground"
          />
        </label>
      ))}
    </div>
  );
}
