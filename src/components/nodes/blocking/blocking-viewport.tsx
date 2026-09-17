"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";

import { BlockingWorld } from "@/lib/blocking/world";
import { CAMERA_ID, type BlockingDocument, type Vec3 } from "@/types/blocking";

export type GizmoMode = "translate" | "rotate" | "scale";

export function BlockingViewport({
  doc,
  playheadMs,
  selectedId,
  gizmoMode,
  onSelect,
  onTransformEnd,
  shotView = false,
}: {
  doc: BlockingDocument;
  playheadMs: number;
  selectedId: string | null;
  gizmoMode: GizmoMode;
  onSelect: (id: string | null) => void;
  onTransformEnd: (
    id: string,
    next: { position?: Vec3; rotation?: Vec3; scale?: Vec3 },
  ) => void;
  /** Look through the playblast camera (node-body preview). */
  shotView?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<BlockingWorld | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const orbitRef = useRef<OrbitControls | null>(null);
  const gizmoRef = useRef<TransformControls | null>(null);
  const viewCamRef = useRef<THREE.PerspectiveCamera | null>(null);
  const helperRef = useRef<THREE.CameraHelper | null>(null);
  const selectedRef = useRef(selectedId);
  const onSelectRef = useRef(onSelect);
  const onEndRef = useRef(onTransformEnd);
  const playheadRef = useRef(playheadMs);
  const docRef = useRef(doc);

  useEffect(() => {
    selectedRef.current = selectedId;
    onSelectRef.current = onSelect;
    onEndRef.current = onTransformEnd;
    playheadRef.current = playheadMs;
    docRef.current = doc;
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(host.clientWidth, host.clientHeight);
    host.appendChild(renderer.domElement);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    renderer.domElement.addEventListener("pointerdown", (e) => e.stopPropagation());
    renderer.domElement.addEventListener("wheel", (e) => e.stopPropagation(), {
      passive: true,
    });

    const world = new BlockingWorld();
    const viewCam = new THREE.PerspectiveCamera(
      50,
      host.clientWidth / Math.max(1, host.clientHeight),
      0.1,
      400,
    );
    viewCam.position.set(6, 5, 9);
    viewCam.lookAt(0, 1, 0);

    const orbit = shotView
      ? null
      : new OrbitControls(viewCam, renderer.domElement);
    if (orbit) {
      orbit.enableDamping = true;
      orbit.target.set(0, 1, 0);
    }

    const gizmo = shotView
      ? null
      : new TransformControls(viewCam, renderer.domElement);
    if (gizmo && orbit) {
      gizmo.addEventListener("dragging-changed", (e) => {
        orbit.enabled = !e.value;
      });
      gizmo.addEventListener("mouseUp", () => {
        const obj = gizmo.object;
        const id = selectedRef.current;
        if (!obj || !id || id === CAMERA_ID) return;
        onEndRef.current(id, {
          position: [obj.position.x, obj.position.y, obj.position.z],
          rotation: [
            THREE.MathUtils.radToDeg(obj.rotation.x),
            THREE.MathUtils.radToDeg(obj.rotation.y),
            THREE.MathUtils.radToDeg(obj.rotation.z),
          ],
          scale: [obj.scale.x, obj.scale.y, obj.scale.z],
        });
      });
      world.scene.add(gizmo.getHelper());
    }

    const helper = shotView ? null : new THREE.CameraHelper(world.playblastCamera);
    if (helper) world.scene.add(helper);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const onClick = (ev: MouseEvent) => {
      if (shotView || gizmo?.dragging) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, viewCam);
      const hits = raycaster.intersectObjects([...world.nodes.values()], true);
      if (hits[0]) {
        let cur: THREE.Object3D | null = hits[0].object;
        while (cur && !world.nodes.has(cur.name) && cur.parent) cur = cur.parent;
        onSelectRef.current(cur && world.nodes.has(cur.name) ? cur.name : null);
      } else {
        onSelectRef.current(null);
      }
    };
    renderer.domElement.addEventListener("click", onClick);

    let raf = 0;
    const tick = () => {
      orbit?.update();
      helper?.update();
      renderer.render(
        world.scene,
        shotView ? world.playblastCamera : viewCam,
      );
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const onResize = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (w < 2 || h < 2) return;
      viewCam.aspect = w / h;
      viewCam.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(host);

    worldRef.current = world;
    rendererRef.current = renderer;
    orbitRef.current = orbit;
    gizmoRef.current = gizmo;
    viewCamRef.current = viewCam;
    helperRef.current = helper;

    void world.sync(docRef.current, playheadRef.current);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("click", onClick);
      gizmo?.dispose();
      orbit?.dispose();
      world.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      worldRef.current = null;
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    void worldRef.current?.sync(doc, playheadMs);
  }, [doc, playheadMs]);

  useEffect(() => {
    const gizmo = gizmoRef.current;
    const world = worldRef.current;
    if (!gizmo || !world) return;
    gizmo.setMode(gizmoMode);
    if (!selectedId || selectedId === CAMERA_ID) {
      gizmo.detach();
      return;
    }
    const node = world.nodes.get(selectedId);
    if (node) gizmo.attach(node);
    else gizmo.detach();
  }, [selectedId, gizmoMode, doc, playheadMs]);

  return <div ref={hostRef} className="h-full w-full bg-[#16161a]" />;
}
