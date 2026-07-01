import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { geometryKey, resolveModel } from '../obj/modelSource';
import { useProjectStore, type ModelSettings } from '../state/store';

type Quat = [number, number, number, number];

/**
 * Small interactive viewport. The user orbits the camera around the model; the
 * camera orientation is reported via `onQuat` and reused verbatim by the depth
 * pass, so the depth map matches this view ("what you see is what you get").
 */
export function ObjRotationViewport({
  model,
  onQuat,
  width = 248,
  height = 186,
}: {
  model: ModelSettings;
  onQuat: (q: Quat) => void;
  width?: number;
  height?: number;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const assetVersion = useProjectStore((s) => s.assetVersion);
  const onQuatRef = useRef(onQuat);
  onQuatRef.current = onQuat;
  const geoKey = geometryKey(model);

  const engine = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    mesh: THREE.Mesh;
    render: () => void;
  } | null>(null);

  // One-time setup.
  useEffect(() => {
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height, false);
    renderer.setClearColor(0x111317, 1);
    mountRef.current!.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const dir = new THREE.DirectionalLight(0xffffff, 1.2);
    dir.position.set(1, 1, 2);
    scene.add(dir);

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 1000);
    camera.position.set(0, 0, 3);

    const mesh = new THREE.Mesh(
      undefined,
      new THREE.MeshStandardMaterial({ color: 0x9fb0c0, roughness: 0.6, side: THREE.DoubleSide }),
    );
    scene.add(mesh);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    const render = () => renderer.render(scene, camera);
    controls.addEventListener('change', () => {
      render();
      const q = camera.quaternion;
      onQuatRef.current([q.x, q.y, q.z, q.w]);
    });

    engine.current = { renderer, scene, camera, controls, mesh, render };
    render();

    return () => {
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
    e.mesh.geometry = asset.geometry;

    const q = new THREE.Quaternion(...model.rotationQuat);
    const dist = asset.radius * model.scale * 2.6 + 0.5;
    const dirVec = new THREE.Vector3(0, 0, 1).applyQuaternion(q).multiplyScalar(dist);
    e.camera.position.copy(dirVec);
    e.camera.quaternion.copy(q);
    e.controls.target.set(0, 0, 0);
    e.controls.update();
    e.mesh.scale.setScalar(model.scale);
    e.render();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geoKey, assetVersion]);

  // Keep model scale in sync without re-framing the camera.
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    e.mesh.scale.setScalar(model.scale);
    e.render();
  }, [model.scale]);

  return <div ref={mountRef} style={{ width, height, border: '1px solid var(--border)' }} />;
}
