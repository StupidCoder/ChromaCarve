import { useEffect, useRef, useState, type RefObject, type ReactNode } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { ModelAsset } from '../assets/assetStore';
import { createStudioEnvironment } from '../three/studioEnvironment';
import { physicalModelMatrix } from './geometry/plywood';
import type { SliceResult, SliceSetup } from './geometry/types';
import { mm } from './PhysicalSetup';

export interface AssemblyView { gapMm: number; layersShown: number; selectedPiece: number; highlightWarnings: boolean; omittedIds?: string[]; showOmitted?: boolean; reviewIds?: string[] }
export type ComparisonView = { position: THREE.Vector3; up: THREE.Vector3; target: THREE.Vector3 };

export function ComparisonViewport({ asset, setup, result, showColors, viewQuaternion, savedView, inspection, controlsSlot }: {
  inspection?: AssemblyView; controlsSlot?: ReactNode;
  asset: ModelAsset; setup: SliceSetup; result: SliceResult; showColors: boolean;
  viewQuaternion: [number, number, number, number]; savedView: RefObject<ComparisonView | undefined>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const left = useRef<HTMLDivElement>(null), right = useRef<HTMLDivElement>(null);
  const [built, setBuilt] = useState<{ result: SliceResult; geometry?: THREE.BufferGeometry; error?: string }>();
  const [renderError, setRenderError] = useState('');
  const inspect = useRef(inspection); inspect.current = inspection;
  const colors = useRef(showColors); colors.current = showColors;
  const refresh = useRef<(() => void) | null>(null), reset = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!result.valid) return;
    let geometry: THREE.BufferGeometry | undefined;
    let worker: Worker;
    try { worker = new Worker(new URL('./plywoodWorker.ts', import.meta.url), { type: 'module' }); }
    catch { setBuilt({ result, error: 'Could not start the plywood preview. Reload to try again.' }); return; }
    worker.onmessage = ({ data }) => {
      if (data.error) setBuilt({ result, error: data.error });
      else {
        geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
        geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
        geometry.setAttribute('slicePiece', new THREE.BufferAttribute(data.pieceIds, 1));
        geometry.setAttribute('sliceLayer', new THREE.BufferAttribute(data.layerIds, 1));
        const warnings = new Float32Array(data.pieceIds.length);
        for (let i = 0; i < warnings.length; i++) warnings[i] = result.assembly?.pieces[data.pieceIds[i]]?.warnings.length ? 1 : 0;
        geometry.setAttribute('sliceWarning', new THREE.BufferAttribute(warnings, 1));
        geometry.setAttribute('sliceOmitted', new THREE.BufferAttribute(new Float32Array(data.pieceIds.length), 1));
        geometry.computeBoundingBox();
        setBuilt({ result, geometry });
      }
      worker.terminate();
    };
    worker.onerror = () => { setBuilt({ result, error: 'Could not build the plywood preview. Reload to try again.' }); worker.terminate(); };
    worker.postMessage(result);
    return () => { worker.terminate(); geometry?.dispose(); };
  }, [result]);
  const geometry = built?.result === result ? built.geometry : undefined;

  useEffect(() => {
    if (!geometry || !host.current) return;
    const element = host.current;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); }
    catch { setRenderError('The comparison needs WebGL. Enable hardware acceleration or try another browser.'); return; }
    setRenderError('');
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setClearColor(0x16171a);
    element.prepend(renderer.domElement);
    const scenes = [new THREE.Scene(), new THREE.Scene()];
    const cameras = scenes.map(() => {
      const camera = new THREE.PerspectiveCamera(38, 1, 0.001, 100);
      camera.up.set(0, 1, 0).applyQuaternion(new THREE.Quaternion(...viewQuaternion).normalize());
      return camera;
    });
    const panes = [left.current!, right.current!];
    const controls = cameras.map((camera, i) => new OrbitControls(camera, panes[i]));
    controls.forEach((control, i) => {
      control.minDistance = 0.03; control.maxDistance = 20;
      control.listenToKeyEvents(panes[i]);
    });
    const neutral = new THREE.MeshStandardMaterial({ color: 0xb9bec9, roughness: 0.8, side: THREE.DoubleSide });
    const wood = new THREE.MeshStandardMaterial({ color: 0xc8aa7d, roughness: 0.9 });
    const uniforms = { gapMm: { value: 0 }, layersShown: { value: result.layers.length }, selectedPiece: { value: -1 }, highlightWarnings: { value: 0 }, showOmitted: { value: 1 } };
    wood.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = 'attribute float sliceOmitted; varying float vSliceOmitted; attribute float sliceLayer; attribute float slicePiece; attribute float sliceWarning; uniform float gapMm; varying float vSliceLayer; varying float vSlicePiece; varying float vSliceWarning;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vSliceOmitted = sliceOmitted; transformed.y += sliceLayer * gapMm; vSliceLayer = sliceLayer; vSlicePiece = slicePiece; vSliceWarning = sliceWarning;');
      shader.fragmentShader = 'varying float vSliceOmitted; uniform float showOmitted; uniform float layersShown; uniform float selectedPiece; uniform float highlightWarnings; varying float vSliceLayer; varying float vSlicePiece; varying float vSliceWarning;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n if (vSliceLayer >= layersShown) discard; if (highlightWarnings > 0.5 && vSliceWarning > 0.5) diffuseColor.rgb = vec3(0.95,0.36,0.12); if (abs(vSlicePiece-selectedPiece) < 0.25) diffuseColor.rgb = vec3(0.12,0.7,1.0); if (vSliceOmitted > 0.5) { if (showOmitted < 0.5 || mod(floor(gl_FragCoord.x) + floor(gl_FragCoord.y), 2.0) < 1.0) discard; diffuseColor.rgb = vec3(1.0,0.03,0.03); }');
    };
    const source: THREE.Mesh = new THREE.Mesh(asset.geometry, neutral);
    source.matrixAutoUpdate = false;
    source.matrix.copy(physicalModelMatrix(asset.geometry, setup)).premultiply(new THREE.Matrix4().makeScale(1 / setup.sizeMm, 1 / setup.sizeMm, 1 / setup.sizeMm));
    const plywood = new THREE.Mesh(geometry, wood);
    plywood.frustumCulled = false; // Exploded positions are moved in the vertex shader.
    plywood.scale.setScalar(1 / setup.sizeMm);
    scenes[0].add(source); scenes[1].add(plywood);
    const lights = scenes.map((scene, i) => {
      const ambient = new THREE.AmbientLight(0xffffff, 1.2);
      const key = new THREE.DirectionalLight(0xffffff, 2.6);
      key.position.set(-3, 4, 5);
      cameras[i].add(key, key.target); scene.add(cameras[i], ambient);
      return { ambient, key };
    });
    let studio: THREE.WebGLRenderTarget | undefined;
    const bounds = new THREE.Box3().setFromObject(source).union(new THREE.Box3().setFromObject(plywood));
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    let previousInspection: AssemblyView | undefined;
    const sourcePieces = result.layers.flatMap(l => l.pieces);
    const render = () => {
      if (previousInspection !== inspect.current) {
        previousInspection = inspect.current;
        const omitted = new Set(inspect.current?.omittedIds ?? []);
        const review = inspect.current?.reviewIds && new Set(inspect.current.reviewIds);
        const ids = geometry.getAttribute('slicePiece');
        const flags = geometry.getAttribute('sliceOmitted'), warnings = geometry.getAttribute('sliceWarning');
        for (let i = 0; i < ids.count; i++) {
          const index = ids.getX(i), id = sourcePieces[index].id;
          flags.setX(i, omitted.has(id) ? 1 : 0);
          warnings.setX(i, (review ? review.has(id) : !!result.assembly?.pieces[index]?.warnings.length) ? 1 : 0);
        }
        flags.needsUpdate = true; warnings.needsUpdate = true;
      }
      uniforms.showOmitted.value = inspect.current?.showOmitted === false ? 0 : 1;
      uniforms.gapMm.value = inspect.current?.gapMm ?? 0;
      uniforms.layersShown.value = inspect.current?.layersShown ?? result.layers.length;
      uniforms.selectedPiece.value = inspect.current?.selectedPiece ?? -1;
      uniforms.highlightWarnings.value = inspect.current?.highlightWarnings ? 1 : 0;
      const useStudio = colors.current && !!asset.studioMaterials;
      if (useStudio) studio ??= createStudioEnvironment(renderer);
      source.material = (colors.current ? asset.studioMaterials ?? asset.materials : undefined) ?? neutral;
      scenes[0].environment = useStudio ? studio!.texture : null;
      scenes[0].environmentRotation.copy(cameras[0].rotation);
      lights[0].ambient.visible = lights[0].key.visible = !useStudio;
      renderer.setScissorTest(true);
      const outer = element.getBoundingClientRect();
      panes.forEach((pane, i) => {
        const rect = pane.getBoundingClientRect();
        const x = rect.left - outer.left, y = outer.bottom - rect.bottom;
        renderer.setViewport(x, y, rect.width, rect.height);
        renderer.setScissor(x, y, rect.width, rect.height);
        renderer.render(scenes[i], cameras[i]);
      });
    };
    let syncing = false;
    const sync = (index: number) => {
      if (syncing) return;
      syncing = true;
      const other = 1 - index;
      cameras[other].position.copy(cameras[index].position);
      cameras[other].quaternion.copy(cameras[index].quaternion);
      cameras[other].up.copy(cameras[index].up);
      controls[other].target.copy(controls[index].target);
      controls[other].update();
      syncing = false;
      render();
    };
    const callbacks = controls.map((control, i) => { const callback = () => sync(i); control.addEventListener('change', callback); return callback; });
    const resetView = () => {
      const fitted = bounds.clone();
      const last = Math.max(0, Math.min(result.layers.length, inspect.current?.layersShown ?? result.layers.length) - 1);
      fitted.max.y = Math.max(fitted.max.y, (result.layers[last].topMm + (inspect.current?.gapMm ?? 0) * last) / setup.sizeMm);
      fitted.getBoundingSphere(sphere);
      const camera = cameras[0];
      const half = THREE.MathUtils.degToRad(camera.fov / 2);
      const angle = Math.min(half, Math.atan(Math.tan(half) * camera.aspect));
      const q = new THREE.Quaternion(...viewQuaternion).normalize();
      camera.position.set(0, 0, 1.1 * sphere.radius / Math.sin(angle)).applyQuaternion(q).add(sphere.center);
      camera.up.set(0, 1, 0).applyQuaternion(q);
      controls[0].target.copy(sphere.center); controls[0].update(); sync(0);
    };
    let firstSize = true;
    const resize = new ResizeObserver(() => {
      renderer.setSize(element.clientWidth, element.clientHeight, false);
      cameras.forEach((camera, i) => { camera.aspect = panes[i].clientWidth / Math.max(1, panes[i].clientHeight); camera.updateProjectionMatrix(); });
      if (firstSize) {
        firstSize = false;
        if (savedView.current) {
          cameras[0].position.copy(savedView.current.position); cameras[0].up.copy(savedView.current.up);
          controls[0].target.copy(savedView.current.target); controls[0].update(); sync(0);
        } else resetView();
      } else render();
    });
    resize.observe(element);
    panes.forEach(pane => resize.observe(pane));
    const lost = (event: Event) => { event.preventDefault(); setRenderError('The 3D preview was interrupted. Reload to restore it.'); };
    renderer.domElement.addEventListener('webglcontextlost', lost);
    refresh.current = render; reset.current = resetView;
    return () => {
      savedView.current = { position: cameras[0].position.clone(), up: cameras[0].up.clone(), target: controls[0].target.clone() };
      refresh.current = reset.current = null;
      resize.disconnect(); controls.forEach((control, i) => { control.removeEventListener('change', callbacks[i]); control.dispose(); });
      neutral.dispose(); wood.dispose(); studio?.dispose();
      renderer.domElement.removeEventListener('webglcontextlost', lost);
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    };
  }, [geometry, asset, setup, viewQuaternion, savedView]);
  useEffect(() => { refresh.current?.(); }, [showColors, inspection]);

  const error = !result.pieceCount ? 'All pieces are omitted. Restore pieces in Assembly to preview the model.' : !result.valid ? 'Resolve the errors in Cross-sections to preview the complete plywood model.' : built?.result === result ? built.error : undefined;
  const dimensions = geometry?.boundingBox?.getSize(new THREE.Vector3());
  return <div className="slice-comparison">
    <div className="comparison-toolbar"><span>Same scale · Linked cameras</span><button onClick={() => reset.current?.()} disabled={!geometry}>Reset view</button></div>
    {controlsSlot}
    <div className="comparison-canvas" ref={host}>
      <div className="comparison-pane" ref={left} tabIndex={0} role="img" aria-label="Original model. Drag to rotate both models. Arrow keys to pan."><span>Original</span></div>
      <div className="comparison-pane" ref={right} tabIndex={0} role="img" aria-label="Plywood model. Drag to rotate both models. Arrow keys to pan."><span>Plywood · {mm(setup.thicknessMm)} mm layers</span></div>
      {(error || renderError || !geometry) && <div className="comparison-status" role="status">{error || renderError || 'Building plywood preview…'}</div>}
    </div>
    <p className="comparison-caption">{dimensions ? `${result.layers.length} layers · ${result.pieceCount - (inspection?.omittedIds?.length ?? 0)} retained pieces · ${mm(dimensions.x)} × ${mm(dimensions.y)} × ${mm(dimensions.z)} mm (W × H × D)` : 'Exact slice contours at measured material thickness.'}{inspection && ' · Original stack dimensions; omissions and exploded gaps are visualized above.'}<br />Drag either model to orbit · Scroll to zoom · Right-drag or arrow keys to pan</p>
  </div>;
}
