import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { ModelAsset } from '../assets/assetStore';
import { createStudioEnvironment } from './studioEnvironment';

const DEFAULT_VIEW: [number, number, number, number] = [0, 0, 0, 1];

/** Store-independent source viewer. Assets remain owned by the caller. */
export function ModelViewport({ asset, viewQuaternion = DEFAULT_VIEW, showColors = true }: {
  asset: ModelAsset;
  viewQuaternion?: [number, number, number, number];
  showColors?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const current = useRef({ asset, showColors, viewQuaternion });
  current.current = { asset, showColors, viewQuaternion };
  const engine = useRef<{ update: () => void; reset: () => void } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const element = host.current!;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); }
    catch { setError('The 3D preview needs WebGL. Enable hardware acceleration or try another browser.'); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x16171a);
    element.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.minDistance = 0.2;
    controls.maxDistance = 20;
    const material = new THREE.MeshStandardMaterial({ color: 0xb9bec9, roughness: 0.65, side: THREE.DoubleSide });
    const placeholder = new THREE.BufferGeometry();
    const mesh: THREE.Mesh = new THREE.Mesh(placeholder, material);
    scene.add(mesh);
    const ambient = new THREE.AmbientLight(0xffffff, 1.1);
    const key = new THREE.DirectionalLight(0xffffff, 2.3);
    key.position.set(2, 3, 4);
    camera.add(key, key.target);
    scene.add(camera, ambient);
    let studio: THREE.WebGLRenderTarget | undefined;
    let aspect = 1;
    const render = () => renderer.render(scene, camera);
    const update = () => {
      const { asset: model, showColors: colors } = current.current;
      mesh.geometry = model.geometry;
      mesh.scale.setScalar(1 / Math.max(model.radius, 1e-8));
      const useStudio = colors && !!model.studioMaterials;
      if (useStudio) studio ??= createStudioEnvironment(renderer);
      scene.environment = useStudio ? studio!.texture : null;
      scene.environmentRotation.copy(camera.rotation);
      mesh.material = (colors ? model.studioMaterials ?? model.materials : undefined) ?? material;
      ambient.visible = key.visible = !useStudio;
      render();
    };
    const reset = () => {
      const q = new THREE.Quaternion(...current.current.viewQuaternion).normalize();
      // Fit a unit bounding sphere even in a tall, narrow viewport.
      const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
      const limitingFov = Math.min(halfFov, Math.atan(Math.tan(halfFov) * aspect));
      camera.position.set(0, 0, 1.12 / Math.sin(limitingFov)).applyQuaternion(q);
      camera.up.set(0, 1, 0).applyQuaternion(q);
      controls.target.set(0, 0, 0);
      controls.update();
      update();
    };
    let firstSize = true;
    const resize = new ResizeObserver(() => {
      const width = Math.max(1, element.clientWidth);
      const height = Math.max(1, element.clientHeight);
      aspect = width / height;
      renderer.setSize(width, height, false);
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      if (firstSize) { firstSize = false; reset(); }
      else render();
    });
    resize.observe(element);
    controls.addEventListener('change', update);
    const onContextLost = (event: Event) => {
      event.preventDefault();
      setError('The 3D preview was interrupted. Reload the page to restore it.');
    };
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);
    engine.current = { update, reset };
    reset();
    return () => {
      engine.current = null;
      resize.disconnect();
      controls.dispose();
      studio?.dispose();
      placeholder.dispose();
      material.dispose();
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, []);

  useEffect(() => { engine.current?.update(); }, [asset, showColors]);
  useEffect(() => { engine.current?.reset(); }, [viewQuaternion]);

  return <div className="model-viewport-shell">
    <div className="model-viewport" ref={host} role="img" aria-label="Interactive 3D source model" />
    {error ? <p className="model-viewport-error" role="alert">{error}</p> :
      <button className="model-viewport-reset" onClick={() => engine.current?.reset()}>Reset view</button>}
  </div>;
}
