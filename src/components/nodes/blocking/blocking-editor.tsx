"use client";

import { Box, Circle, Cylinder, Loader2, Square, UserRound, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { uploadMeshAsset } from "@/lib/library/upload-asset";
import { runBlockingAgent } from "@/lib/blocking/agent";
import { applyBlockingOp, type BlockingOp } from "@/lib/blocking/ops";
import { evalCameraAt, evalObjectAt } from "@/lib/blocking/evaluate";
import {
  CAMERA_ID,
  type BlockingDocument,
  type PrimitiveKind,
  type Vec3,
} from "@/types/blocking";
import { cn } from "@/lib/utils";

import {
  BlockingViewport,
  type GizmoMode,
} from "./blocking-viewport";
import { BlockingTimeline } from "./blocking-timeline";

const COMMIT_MS = 120;

const PRIMITIVES: { kind: PrimitiveKind; label: string; icon: typeof Box }[] = [
  { kind: "capsule", label: "Capsule", icon: UserRound },
  { kind: "box", label: "Box", icon: Box },
  { kind: "sphere", label: "Sphere", icon: Circle },
  { kind: "cylinder", label: "Cylinder", icon: Cylinder },
  { kind: "plane", label: "Plane", icon: Square },
];

export function BlockingEditor({
  doc: initialDoc,
  onChange,
  onClose,
}: {
  doc: BlockingDocument;
  onChange: (doc: BlockingDocument) => void;
  onClose: () => void;
}) {
  const [doc, setDoc] = useState(initialDoc);
  const [selectedId, setSelectedId] = useState<string | null>(CAMERA_ID);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [gizmoMode, setGizmoMode] = useState<GizmoMode>("translate");
  const [prompt, setPrompt] = useState("");
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentLog, setAgentLog] = useState<string>("");
  const [importError, setImportError] = useState<string>("");

  const docRef = useRef(doc);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    docRef.current = doc;
    onChangeRef.current = onChange;
  });
  useEffect(() => {
    const t = setTimeout(() => onChangeRef.current(docRef.current), COMMIT_MS);
    return () => clearTimeout(t);
  }, [doc]);

  const apply = useCallback((op: BlockingOp) => {
    const next = applyBlockingOp(docRef.current, op);
    if (next.error) setImportError(next.error);
    setDoc(next.doc);
    if (next.createdId) setSelectedId(next.createdId);
    return next;
  }, []);

  const close = useCallback(() => {
    onChangeRef.current(docRef.current);
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      setPlayheadMs((p) => {
        const next = p + dt;
        return next >= doc.durationMs ? next % doc.durationMs : next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, doc.durationMs]);

  const onTransformEnd = useCallback(
    (id: string, next: { position?: Vec3; rotation?: Vec3; scale?: Vec3 }) => {
      apply({
        op: "set_transform",
        id,
        ...next,
        tMs: playheadMs,
      });
    },
    [apply, playheadMs],
  );

  const selected =
    selectedId === CAMERA_ID
      ? null
      : doc.objects.find((o) => o.id === selectedId) ?? null;
  const camAt = evalCameraAt(doc.camera, playheadMs);
  const objAt = selected ? evalObjectAt(selected, playheadMs) : null;

  const runPrompt = async () => {
    const text = prompt.trim();
    if (!text || agentBusy) return;
    setAgentBusy(true);
    setAgentLog("");
    const ac = new AbortController();
    try {
      const result = await runBlockingAgent(doc, text, ac.signal);
      setDoc(result.doc);
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
      className="fixed inset-0 z-[80] flex flex-col bg-background text-foreground"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          close();
        }
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
              {m === "translate" ? "Move" : m === "rotate" ? "Rotate" : "Scale"}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="ml-auto rounded-md p-1 text-muted-foreground hover:bg-foreground/[0.06]"
          onClick={close}
          aria-label="Close editor"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-48 shrink-0 flex-col gap-1 overflow-y-auto border-r border-border/40 p-2 text-[11px]">
          <button
            type="button"
            className={cn(
              "rounded-md px-2 py-1 text-left",
              selectedId === CAMERA_ID
                ? "bg-accent/25"
                : "hover:bg-foreground/[0.05]",
            )}
            onClick={() => setSelectedId(CAMERA_ID)}
          >
            Camera
          </button>
          {doc.objects.map((o) => (
            <button
              key={o.id}
              type="button"
              className={cn(
                "rounded-md px-2 py-1 text-left",
                selectedId === o.id ? "bg-accent/25" : "hover:bg-foreground/[0.05]",
                !o.visible && "opacity-50",
              )}
              onClick={() => setSelectedId(o.id)}
            >
              {o.name}
              <span className="ml-1 text-muted-foreground">{o.kind}</span>
            </button>
          ))}
        </aside>

        <div className="relative min-w-0 flex-1">
          <BlockingViewport
            doc={doc}
            playheadMs={playheadMs}
            selectedId={selectedId}
            gizmoMode={gizmoMode}
            onSelect={setSelectedId}
            onTransformEnd={onTransformEnd}
          />
        </div>

        <aside className="flex w-60 shrink-0 flex-col gap-2 overflow-y-auto border-l border-border/40 p-2 text-[11px]">
          {selectedId === CAMERA_ID ? (
            <InspectorBlock
              title="Camera"
              rows={[
                ["fov", doc.camera.fov, (v) => apply({ op: "set_camera", fov: v })],
                [
                  "pos x",
                  camAt.position[0],
                  (v) =>
                    apply({
                      op: "set_transform",
                      id: CAMERA_ID,
                      position: [v, camAt.position[1], camAt.position[2]],
                      tMs: playheadMs,
                    }),
                ],
                [
                  "pos y",
                  camAt.position[1],
                  (v) =>
                    apply({
                      op: "set_transform",
                      id: CAMERA_ID,
                      position: [camAt.position[0], v, camAt.position[2]],
                      tMs: playheadMs,
                    }),
                ],
                [
                  "pos z",
                  camAt.position[2],
                  (v) =>
                    apply({
                      op: "set_transform",
                      id: CAMERA_ID,
                      position: [camAt.position[0], camAt.position[1], v],
                      tMs: playheadMs,
                    }),
                ],
                [
                  "look x",
                  camAt.lookAt[0],
                  (v) =>
                    apply({
                      op: "set_camera",
                      lookAt: [v, camAt.lookAt[1], camAt.lookAt[2]],
                      tMs: playheadMs,
                    }),
                ],
                [
                  "look y",
                  camAt.lookAt[1],
                  (v) =>
                    apply({
                      op: "set_camera",
                      lookAt: [camAt.lookAt[0], v, camAt.lookAt[2]],
                      tMs: playheadMs,
                    }),
                ],
                [
                  "look z",
                  camAt.lookAt[2],
                  (v) =>
                    apply({
                      op: "set_camera",
                      lookAt: [camAt.lookAt[0], camAt.lookAt[1], v],
                      tMs: playheadMs,
                    }),
                ],
              ]}
            />
          ) : selected && objAt ? (
            <InspectorBlock
              title={selected.name}
              rows={[
                ...(["x", "y", "z"] as const).map((axis, i) => [
                  `pos ${axis}`,
                  objAt.position[i]!,
                  (v: number) => {
                    const p: Vec3 = [...objAt.position];
                    p[i] = v;
                    apply({
                      op: "set_transform",
                      id: selected.id,
                      position: p,
                      tMs: playheadMs,
                    });
                  },
                ] as [string, number, (v: number) => void]),
                ...(["x", "y", "z"] as const).map((axis, i) => [
                  `rot ${axis}`,
                  objAt.rotation[i]!,
                  (v: number) => {
                    const p: Vec3 = [...objAt.rotation];
                    p[i] = v;
                    apply({
                      op: "set_transform",
                      id: selected.id,
                      rotation: p,
                      tMs: playheadMs,
                    });
                  },
                ] as [string, number, (v: number) => void]),
                ...(["x", "y", "z"] as const).map((axis, i) => [
                  `scl ${axis}`,
                  objAt.scale[i]!,
                  (v: number) => {
                    const p: Vec3 = [...objAt.scale];
                    p[i] = v;
                    apply({
                      op: "set_transform",
                      id: selected.id,
                      scale: p,
                      tMs: playheadMs,
                    });
                  },
                ] as [string, number, (v: number) => void]),
              ]}
            />
          ) : (
            <p className="text-muted-foreground">Select an object.</p>
          )}
          {selected && selected.id !== "ground" ? (
            <button
              type="button"
              className="rounded-md px-2 py-1 text-destructive hover:bg-destructive/10"
              onClick={() => {
                apply({ op: "remove_object", id: selected.id });
                setSelectedId(CAMERA_ID);
              }}
            >
              Delete
            </button>
          ) : null}
          <label className="mt-2 flex flex-col gap-1 text-muted-foreground">
            Duration (s)
            <input
              type="number"
              min={0.2}
              max={60}
              step={0.1}
              value={doc.durationMs / 1000}
              onChange={(e) =>
                apply({ op: "set_duration", durationMs: Number(e.target.value) * 1000 })
              }
              className="h-7 rounded-md border border-border/60 bg-background/40 px-2 text-foreground"
            />
          </label>
        </aside>
      </div>

      <BlockingTimeline
        doc={doc}
        playheadMs={playheadMs}
        selectedId={selectedId}
        playing={playing}
        onScrub={(ms) => {
          setPlaying(false);
          setPlayheadMs(ms);
        }}
        onTogglePlay={() => setPlaying((p) => !p)}
        onSetKey={() => {
          if (selectedId === CAMERA_ID) {
            apply({
              op: "set_camera",
              position: camAt.position,
              lookAt: camAt.lookAt,
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
}: {
  title: string;
  rows: [string, number, (v: number) => void][];
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="font-medium text-foreground">{title}</p>
      {rows.map(([label, value, onChange]) => (
        <label key={label} className="flex items-center gap-2 text-muted-foreground">
          <span className="w-12 shrink-0">{label}</span>
          <input
            type="number"
            step={0.1}
            value={Number(value.toFixed(3))}
            onChange={(e) => onChange(Number(e.target.value))}
            className="h-6 w-full rounded-md border border-border/60 bg-background/40 px-1 text-foreground"
          />
        </label>
      ))}
    </div>
  );
}
