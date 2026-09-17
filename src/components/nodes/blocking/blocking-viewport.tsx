"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";

import {
  lookAtAlongForward,
  translateLinked,
  type ViewportTransform,
} from "@/lib/blocking/camera-gizmo";
import { evalCameraAt } from "@/lib/blocking/evaluate";
import { cameraAtDoc } from "@/lib/blocking/shots";
import { BlockingWorld } from "@/lib/blocking/world";
import { CAMERA_ID, LOOK_AT_ID, type BlockingDocument, type Vec3 } from "@/types/blocking";

export type GizmoMode = "translate" | "rotate" | "scale";

export type { ViewportTransform };

function toVec3(v: THREE.Vector3): Vec3 {
  return [v.x, v.y, v.z];
}

function isUnder(hit: THREE.Object3D, root: THREE.Object3D | null): boolean {
  let cur: THREE.Object3D | null = hit;
  while (cur) {
    if (cur === root) return true;
    cur = cur.parent;
  }
  return false;
}

export function BlockingViewport({
  doc,
  playheadMs,
  selectedId,
  gizmoMode,
  onSelect,
  onTransformEnd,
  shotView = false,
  linkCameraTarget = false,
}: {
  doc: BlockingDocument;
  playheadMs: number;
  selectedId: string | null;
  gizmoMode: GizmoMode;
  onSelect: (id: string | null, additive?: boolean) => void;
  onTransformEnd: (id: string, next: ViewportTransform) => void;
  /** Look through the playblast camera. */
  shotView?: boolean;
  /** Translate camera and lookAt by the same delta. */
  linkCameraTarget?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<BlockingWorld | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const orbitRef = useRef<OrbitControls | null>(null);
  const gizmoRef = useRef<TransformControls | null>(null);
  const viewCamRef = useRef<THREE.PerspectiveCamera | null>(null);
  const helperRef = useRef<THREE.CameraHelper | null>(null);
  const lookAtRef = useRef<THREE.Mesh | null>(null);
  const camBodyRef = useRef<THREE.Mesh | null>(null);
  const aimLineRef = useRef<THREE.Line | null>(null);
  const selectedRef = useRef(selectedId);
  const onSelectRef = useRef(onSelect);
  const onEndRef = useRef(onTransformEnd);
  const playheadRef = useRef(playheadMs);
  const docRef = useRef(doc);
  const shotViewRef = useRef(shotView);
  const linkRef = useRef(linkCameraTarget);
  const draggingRef = useRef(false);
  const dragStartRef = useRef<{ cam: THREE.Vector3; look: THREE.Vector3 } | null>(
    null,
  );

  useEffect(() => {
    selectedRef.current = selectedId;
    onSelectRef.current = onSelect;
    onEndRef.current = onTransformEnd;
    playheadRef.current = playheadMs;
    docRef.current = doc;
    shotViewRef.current = shotView;
    linkRef.current = linkCameraTarget;
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
    renderer.domElement.style.userSelect = "none";
    renderer.domElement.style.webkitUserSelect = "none";
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

    const orbit = new OrbitControls(viewCam, renderer.domElement);
    orbit.enableDamping = true;
    orbit.target.set(0, 1, 0);

    const lookAtHandle = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xf5c542 }),
    );
    lookAtHandle.name = LOOK_AT_ID;
    world.scene.add(lookAtHandle);

    const camBody = new THREE.Mesh(
      new THREE.ConeGeometry(0.16, 0.36, 4),
      new THREE.MeshBasicMaterial({ color: 0x88aaff, wireframe: true }),
    );
    camBody.rotation.x = Math.PI / 2;
    camBody.name = CAMERA_ID;
    world.playblastCamera.add(camBody);

    const aimGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(),
      new THREE.Vector3(),
    ]);
    const aimLine = new THREE.Line(
      aimGeom,
      new THREE.LineBasicMaterial({ color: 0x88aaff, transparent: true, opacity: 0.55 }),
    );
    world.scene.add(aimLine);

    const helper = new THREE.CameraHelper(world.playblastCamera);
    world.scene.add(helper);

    const gizmo = new TransformControls(viewCam, renderer.domElement);
    gizmo.setSize(0.85);
    gizmo.addEventListener("dragging-changed", (e) => {
      draggingRef.current = Boolean(e.value);
      orbit.enabled = !e.value && !shotViewRef.current;
      if (e.value) {
        dragStartRef.current = {
          cam: world.playblastCamera.position.clone(),
          look: lookAtHandle.position.clone(),
        };
      }
    });
    gizmo.addEventListener("objectChange", () => {
      const start = dragStartRef.current;
      const id = selectedRef.current;
      if (!start || !id) return;
      if (id === CAMERA_ID) {
        if (gizmo.mode === "rotate") return;
        if (linkRef.current && gizmo.mode === "translate") {
          const d = world.playblastCamera.position.clone().sub(start.cam);
          lookAtHandle.position.copy(start.look).add(d);
        }
        world.playblastCamera.lookAt(lookAtHandle.position);
      } else if (id === LOOK_AT_ID) {
        if (linkRef.current) {
          const d = lookAtHandle.position.clone().sub(start.look);
          world.playblastCamera.position.copy(start.cam).add(d);
        }
        world.playblastCamera.lookAt(lookAtHandle.position);
      }
    });
    gizmo.addEventListener("mouseUp", () => {
      const obj = gizmo.object;
      const id = selectedRef.current;
      const start = dragStartRef.current;
      if (!obj || !id) return;
      if (id === CAMERA_ID) {
        const pos = toVec3(obj.position);
        if (gizmo.mode === "rotate") {
          const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(obj.quaternion);
          const dist = start ? start.cam.distanceTo(start.look) : 4;
          onEndRef.current(id, {
            position: pos,
            lookAt: lookAtAlongForward(pos, [fwd.x, fwd.y, fwd.z], dist),
          });
        } else {
          const result = translateLinked(
            start ? toVec3(start.cam) : pos,
            pos,
            start ? toVec3(start.look) : toVec3(lookAtHandle.position),
            linkRef.current,
          );
          onEndRef.current(id, {
            position: result.moved,
            ...(linkRef.current ? { lookAt: result.other } : {}),
          });
        }
        return;
      }
      if (id === LOOK_AT_ID) {
        const look = toVec3(obj.position);
        const result = translateLinked(
          start ? toVec3(start.look) : look,
          look,
          start ? toVec3(start.cam) : toVec3(world.playblastCamera.position),
          linkRef.current,
        );
        onEndRef.current(id, {
          lookAt: result.moved,
          ...(linkRef.current ? { position: result.other } : {}),
        });
        return;
      }
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
    const gizmoHelper = gizmo.getHelper();
    world.scene.add(gizmoHelper);

    const raycaster = new THREE.Raycaster();
    raycaster.params.Line = { threshold: 0.18 };
    const pointer = new THREE.Vector2();
    const onClick = (ev: MouseEvent) => {
      if (shotViewRef.current || gizmo.dragging) return;
      const additive = ev.shiftKey || ev.metaKey || ev.ctrlKey;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, viewCam);
      const hits = raycaster.intersectObjects(
        [...world.pickables(), lookAtHandle, camBody, helper],
        true,
      );
      const hit = hits[0]?.object;
      if (!hit) {
        if (!additive) onSelectRef.current(null);
        return;
      }
      if (isUnder(hit, lookAtHandle)) {
        onSelectRef.current(LOOK_AT_ID, additive);
        return;
      }
      if (isUnder(hit, helper) || isUnder(hit, camBody) || isUnder(hit, world.playblastCamera)) {
        onSelectRef.current(CAMERA_ID, additive);
        return;
      }
      let cur: THREE.Object3D | null = hit;
      while (cur) {
        if (typeof cur.userData.sourceId === "string") {
          onSelectRef.current(cur.userData.sourceId, additive);
          return;
        }
        if (world.nodes.has(cur.name)) {
          onSelectRef.current(cur.name, additive);
          return;
        }
        cur = cur.parent;
      }
      onSelectRef.current(null, additive);
    };
    renderer.domElement.addEventListener("click", onClick);

    const placeChrome = () => {
      const cam = evalCameraAt(
        cameraAtDoc(docRef.current, playheadRef.current),
        playheadRef.current,
        docRef.current.objects,
      );
      lookAtHandle.position.set(cam.lookAt[0], cam.lookAt[1], cam.lookAt[2]);
      const pos = world.playblastCamera.position;
      const pts = aimGeom.getAttribute("position");
      if (pts) {
        pts.setXYZ(0, pos.x, pos.y, pos.z);
        pts.setXYZ(1, cam.lookAt[0], cam.lookAt[1], cam.lookAt[2]);
        pts.needsUpdate = true;
      }
    };

    let raf = 0;
    const tick = () => {
      const throughShot = shotViewRef.current;
      helper.visible = !throughShot;
      lookAtHandle.visible = !throughShot;
      camBody.visible = !throughShot;
      aimLine.visible = !throughShot;
      gizmo.enabled = !throughShot;
      gizmoHelper.visible = !throughShot;
      orbit.enabled = !throughShot && !gizmo.dragging;
      if (throughShot) {
        const w = host.clientWidth;
        const h = Math.max(1, host.clientHeight);
        world.playblastCamera.aspect = w / h;
        world.playblastCamera.updateProjectionMatrix();
      }
      orbit.update();
      helper.update();
      if (!draggingRef.current) {
        const pos = world.playblastCamera.position;
        const look = lookAtHandle.position;
        const pts = aimGeom.getAttribute("position");
        if (pts) {
          pts.setXYZ(0, pos.x, pos.y, pos.z);
          pts.setXYZ(1, look.x, look.y, look.z);
          pts.needsUpdate = true;
        }
      }
      renderer.render(world.scene, throughShot ? world.playblastCamera : viewCam);
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
    lookAtRef.current = lookAtHandle;
    camBodyRef.current = camBody;
    aimLineRef.current = aimLine;

    void world.sync(docRef.current, playheadRef.current).then(placeChrome);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("click", onClick);
      gizmo.dispose();
      orbit.dispose();
      world.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      worldRef.current = null;
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (draggingRef.current) return;
    const world = worldRef.current;
    const handle = lookAtRef.current;
    const gizmo = gizmoRef.current;
    if (!world || !gizmo) return;
    void world.sync(doc, playheadMs).then(() => {
      if (draggingRef.current) return;
      if (handle) {
        const cam = evalCameraAt(cameraAtDoc(doc, playheadMs), playheadMs, doc.objects);
        handle.position.set(cam.lookAt[0], cam.lookAt[1], cam.lookAt[2]);
      }
      if (shotView) {
        gizmo.detach();
        return;
      }
      const mode =
        selectedId === LOOK_AT_ID
          ? "translate"
          : selectedId === CAMERA_ID && gizmoMode === "scale"
            ? "translate"
            : gizmoMode;
      gizmo.setMode(mode);
      if (!selectedId) {
        gizmo.detach();
        return;
      }
      if (selectedId === CAMERA_ID) {
        gizmo.attach(world.playblastCamera);
        gizmo.getHelper().visible = true;
        return;
      }
      if (selectedId === LOOK_AT_ID && handle) {
        gizmo.attach(handle);
        gizmo.getHelper().visible = true;
        return;
      }
      const node = world.nodes.get(selectedId);
      if (node) {
        gizmo.attach(node);
        gizmo.getHelper().visible = true;
      } else {
        gizmo.detach();
      }
    });
  }, [doc, playheadMs, selectedId, gizmoMode, shotView]);

  return (
    <div
      ref={hostRef}
      className="h-full w-full select-none bg-[#16161a]"
    />
  );
}
