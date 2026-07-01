import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { geometryKey, resolveModel } from '../obj/modelSource';
import { useProjectStore, type ModelSettings } from '../state/store';

type Quat = [number, number, number, number];
type Asset = ReturnType<typeof resolveModel>;

const ROLL_AXIS = new THREE.Vector3(0, 0, 1); // camera view axis (local Z)
const SCALE_MIN = 0.1;
const SCALE_MAX = 5;

/**
 * Small interactive viewport. The user orbits the camera around the model; the
 * camera orientation is reported via `onQuat` and reused verbatim by the depth
 * pass, so the depth map matches this view ("what you see is what you get").
 *
 * Uses an ORTHOGRAPHIC camera with the same auto-fit framing as `ModelDepthPass`
 * (mesh stays at scale 1; `scale` zooms the framing), so the gizmo's projection
 * and zoom line up with the rendered depth/color maps. The scroll wheel drives
 * the model `scale` (via `onScale`) instead of dollying. `model.roll` adds a roll
 * about the view axis. The key light is parented to the camera, so the model is
 * lit from the same relative angle at any orbit.
 */
export function ObjRotationViewport({
  model,
  onQuat,
  onScale,
  width = 248,
  height = 186,
}: {
  model: ModelSettings;
  onQuat: (q: Quat) => void;
  onScale?: (scale: number) => void;
  width?: number;
  height?: number;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const assetVersion = useProjectStore((s) => s.assetVersion);
  const onQuatRef = useRef(onQuat);
  onQuatRef.current = onQuat;
  const onScaleRef = useRef(onScale);
  onScaleRef.current = onScale;
  // Live values read by once-registered listeners (wheel handler, orbit change).
  const rollRef = useRef(0);
  rollRef.current = ((model.roll ?? 0) * Math.PI) / 180;
  const scaleRef = useRef(model.scale);
  scaleRef.current = model.scale;
  const assetRef = useRef<Asset>(null);
  const geoKey = geometryKey(model);

  const engine = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.OrthographicCamera;
    controls: OrbitControls;
    mesh: THREE.Mesh;
    render: () => void;
    frameOrtho: () => void;
    applyView: () => void;
    syncView: () => void;
  } | null>(null);

  // One-time setup.
  useEffect(() => {
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height, false);
    renderer.setClearColor(0x111317, 1);
    mountRef.current!.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));

    // Orthographic to match the depth pass. Frustum is set per-view by frameOrtho.
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 1000);
    camera.position.set(0, 0, 3);

    // Parent the key light (and its target) to the camera so the model is always
    // lit from the same angle relative to the view — orbiting never goes dark.
    const dir = new THREE.DirectionalLight(0xffffff, 1.2);
    dir.position.set(0.6, 0.8, 1.0); // camera-local: upper-right, in front
    camera.add(dir);
    camera.add(dir.target); // target at the camera origin -> light aims forward
    scene.add(camera);

    const mesh = new THREE.Mesh(
      undefined,
      new THREE.MeshStandardMaterial({ color: 0x9fb0c0, roughness: 0.6, side: THREE.DoubleSide }),
    );
    scene.add(mesh);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.enableZoom = false; // the wheel drives model scale instead (below)
    const render = () => renderer.render(scene, camera);

    // Fit the orthographic frustum to the model's view-space bounds, zoomed by
    // `scale` — identical framing to ModelDepthPass so the gizmo matches the maps.
    const corners = Array.from({ length: 8 }, () => new THREE.Vector3());
    const vmin = new THREE.Vector3();
    const vmax = new THREE.Vector3();
    const frameOrtho = () => {
      const asset = assetRef.current;
      if (!asset) return;
      const geo = asset.geometry;
      if (!geo.boundingBox) geo.computeBoundingBox();
      const bb = geo.boundingBox!;
      camera.updateMatrixWorld(true);
      const view = camera.matrixWorldInverse;
      const xs = [bb.min.x, bb.max.x];
      const ys = [bb.min.y, bb.max.y];
      const zs = [bb.min.z, bb.max.z];
      let n = 0;
      for (const x of xs) for (const y of ys) for (const z of zs) corners[n++].set(x, y, z);
      vmin.set(Infinity, Infinity, Infinity);
      vmax.set(-Infinity, -Infinity, -Infinity);
      for (const c of corners) {
        c.applyMatrix4(view);
        vmin.min(c);
        vmax.max(c);
      }
      const cx = (vmin.x + vmax.x) / 2;
      const cy = (vmin.y + vmax.y) / 2;
      const half =
        ((Math.max(vmax.x - vmin.x, vmax.y - vmin.y) / 2) * 1.05) / Math.max(scaleRef.current, 1e-3);
      const aspect = width / height;
      const halfX = half * Math.max(1, aspect);
      const halfY = half * Math.max(1, 1 / aspect);
      camera.left = cx - halfX;
      camera.right = cx + halfX;
      camera.top = cy + halfY;
      camera.bottom = cy - halfY;
      camera.near = -vmax.z - 0.01;
      camera.far = -vmin.z + 0.01;
      camera.updateProjectionMatrix();
    };

    // The orbit gives a roll-free base orientation; `model.roll` is layered on top
    // as a rotation about the view axis. The base is recomputed from the camera
    // position (look-at target, up = +Y) rather than read from camera.quaternion,
    // so the roll we apply never contaminates it and never accumulates.
    const baseQuat = new THREE.Quaternion();
    const rollQ = new THREE.Quaternion();
    const lookM = new THREE.Matrix4();
    const applyView = () => {
      rollQ.setFromAxisAngle(ROLL_AXIS, rollRef.current);
      camera.quaternion.copy(baseQuat).multiply(rollQ);
      frameOrtho(); // frustum depends on the final (rolled) orientation
      render();
      const q = camera.quaternion;
      onQuatRef.current([q.x, q.y, q.z, q.w]);
    };
    const syncView = () => {
      lookM.lookAt(camera.position, controls.target, camera.up);
      baseQuat.setFromRotationMatrix(lookM);
      applyView();
    };
    controls.addEventListener('change', syncView);

    // Scroll = zoom the actual model (moves the Zoom slider), not a camera dolly.
    const onWheel = (ev: WheelEvent) => {
      if (!onScaleRef.current) return;
      ev.preventDefault();
      const factor = Math.exp(-ev.deltaY * 0.0015);
      const raw = Math.min(SCALE_MAX, Math.max(SCALE_MIN, scaleRef.current * factor));
      onScaleRef.current(Math.round(raw * 100) / 100); // keep the stored value tidy (2 dp)
    };
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false });

    engine.current = { renderer, scene, camera, controls, mesh, render, frameOrtho, applyView, syncView };
    render();

    return () => {
      renderer.domElement.removeEventListener('wheel', onWheel);
      controls.dispose();
      renderer.dispose();
      // dispose() alone leaves the GL context alive until GC; release it now so
      // repeatedly mounting this gizmo (e.g. switching settings tabs) doesn't
      // exhaust the browser's WebGL context limit and evict the main preview.
      renderer.forceContextLoss();
      renderer.domElement.remove();
      engine.current = null;
    };
  }, [width, height]);

  // Load / replace geometry and frame the camera from the stored orientation.
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    const asset = resolveModel(model);
    if (!asset) return;
    assetRef.current = asset;
    e.mesh.geometry = asset.geometry;
    e.mesh.scale.setScalar(1); // model is never physically scaled; framing zooms

    const q = new THREE.Quaternion(...model.rotationQuat);
    const dist = asset.radius * 2 + 1; // match ModelDepthPass camera distance
    const dirVec = new THREE.Vector3(0, 0, 1).applyQuaternion(q).multiplyScalar(dist);
    e.camera.position.copy(dirVec);
    e.controls.target.set(0, 0, 0);
    e.controls.update(); // settle OrbitControls' spherical state from the new position
    e.syncView(); // re-derive base orientation, apply roll + framing, report the quat
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geoKey, assetVersion]);

  // Re-zoom the framing when scale changes (no re-framing of the orientation).
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    e.frameOrtho();
    e.render();
  }, [model.scale]);

  // Re-apply roll when the slider changes (no orbit interaction needed).
  useEffect(() => {
    engine.current?.applyView();
  }, [model.roll]);

  return <div ref={mountRef} style={{ width, height, border: '1px solid var(--border)' }} />;
}
