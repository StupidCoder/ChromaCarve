import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { renderPreviewComposite } from '../pipeline/composite';
import { useProjectStore } from '../state/store';
import { VIEWER_FRAG, VIEWER_VERT } from './viewerShaders';

const MIN_SEG = 256; // minimum plane subdivisions per axis
const MAX_SEG = 768; // cap so the per-frame mesh stays fast

/** Mesh subdivisions scaled to the composite resolution so higher preview
 * resolution yields a higher-resolution displacement mesh (capped). */
function meshSegments(w: number, h: number): number {
  return Math.min(MAX_SEG, Math.max(MIN_SEG, Math.round(Math.max(w, h) / 2)));
}

function makeDataTexture(w: number, h: number, data: Float32Array) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tex = new THREE.DataTexture(data as any, w, h, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Lit 3D relief preview. Uses its own renderer/context for the display and
 * pulls the composite (at preview resolution) from the pipeline. Displaces a
 * high-res plane by the depth map, shaded by an orbiting point light + specular.
 *
 * Fills its parent container (which should establish a size / positioning
 * context) and tracks resizes via a `ResizeObserver`, keeping the renderer and
 * camera aspect in sync so the preview can occupy the whole viewport.
 */
export function Viewer3D() {
  const project = useProjectStore((s) => s.project);
  const assetVersion = useProjectStore((s) => s.assetVersion);
  const reliefVersion = useProjectStore((s) => s.reliefVersion);
  const mountRef = useRef<HTMLDivElement>(null);

  const engine = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    material: THREE.ShaderMaterial;
    mesh: THREE.Mesh;
    depthTex: THREE.DataTexture | null;
    colorTex: THREE.DataTexture | null;
    texW: number;
    texH: number;
    planeW: number;
    planeH: number;
    seg: number;
  } | null>(null);

  // One-time setup + animation loop.
  useEffect(() => {
    const mount = mountRef.current!;
    const initW = Math.max(1, mount.clientWidth);
    const initH = Math.max(1, mount.clientHeight);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(initW, initH, false);
    renderer.setClearColor(0x0c0d10, 1);
    mount.appendChild(renderer.domElement);
    // Let the canvas track the mount box; sizing is driven by the observer below.
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, initW / initH, 0.01, 100);
    camera.up.set(0, 0, 1);
    camera.position.set(0, -2.6, 2.0);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0);
    // Left-drag / one finger rotates, scroll / pinch zooms, right-drag / two
    // fingers pan (OrbitControls' default TWO-touch = DOLLY_PAN).
    controls.enablePan = true;

    const material = new THREE.ShaderMaterial({
      vertexShader: VIEWER_VERT,
      fragmentShader: VIEWER_FRAG,
      uniforms: {
        uDepth: { value: null },
        uColor: { value: null },
        uHeightScale: { value: 0 },
        uStepUv: { value: new THREE.Vector2() },
        uStepWorld: { value: new THREE.Vector2() },
        uLightPos: { value: new THREE.Vector3() },
        uCamPos: { value: new THREE.Vector3() },
        uAmbient: { value: 0.25 },
        uSpecular: { value: 0.6 },
        uShininess: { value: 32 },
      },
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, MIN_SEG, MIN_SEG), material);
    scene.add(mesh);

    engine.current = {
      renderer, scene, camera, controls, material, mesh,
      depthTex: null, colorTex: null, texW: 0, texH: 0, planeW: 0, planeH: 0, seg: 0,
    };

    // Keep the renderer + camera in sync with the mount box (full-viewport).
    const resize = () => {
      const w = Math.max(1, mount.clientWidth);
      const h = Math.max(1, mount.clientHeight);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    let raf = 0;
    const start = performance.now();
    const loop = () => {
      const t = (performance.now() - start) / 1000;
      const angle = t * 0.8;
      material.uniforms.uLightPos.value.set(Math.cos(angle) * 1.4, Math.sin(angle) * 1.4, 2.2);
      material.uniforms.uCamPos.value.copy(camera.position);
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      controls.dispose();
      mesh.geometry.dispose();
      engine.current?.depthTex?.dispose();
      engine.current?.colorTex?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      engine.current = null;
    };
  }, []);

  // Pull the preview composite and update the mesh.
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    const { depth: depthBuf, color: colorBuf, width: w, height: h, displayMax } =
      renderPreviewComposite(project);

    if (!e.depthTex || e.texW !== w || e.texH !== h) {
      e.depthTex?.dispose();
      e.colorTex?.dispose();
      e.depthTex = makeDataTexture(w, h, depthBuf);
      e.colorTex = makeDataTexture(w, h, colorBuf);
      e.texW = w;
      e.texH = h;
    } else {
      e.depthTex.image.data = depthBuf as unknown as Uint8Array;
      e.colorTex!.image.data = colorBuf as unknown as Uint8Array;
      e.depthTex.needsUpdate = true;
      e.colorTex!.needsUpdate = true;
    }

    // Rebuild the plane to the output aspect (normalized so the long side = 2)
    // only when the dimensions actually change — not on every slider tick.
    const { widthMm, heightMm, previewMaxDepthMm } = project.output;
    const s = 2 / Math.max(widthMm, heightMm);
    const pw = widthMm * s;
    const ph = heightMm * s;
    const seg = meshSegments(w, h);
    if (pw !== e.planeW || ph !== e.planeH || seg !== e.seg) {
      e.mesh.geometry.dispose();
      e.mesh.geometry = new THREE.PlaneGeometry(pw, ph, seg, seg);
      e.planeW = pw;
      e.planeH = ph;
      e.seg = seg;
    }

    const u = e.material.uniforms;
    u.uDepth.value = e.depthTex;
    u.uColor.value = e.colorTex;
    // displayMax maps to previewMaxDepthMm; convert mm to plane units via s.
    u.uHeightScale.value = (previewMaxDepthMm * s) / displayMax;
    // Normals are sampled at the mesh vertex spacing (1/seg), not the texel size.
    u.uStepUv.value.set(1 / seg, 1 / seg);
    u.uStepWorld.value.set(pw / seg, ph / seg);
  }, [project, assetVersion, reliefVersion]);

  return <div ref={mountRef} title="drag to orbit" className="viewer3d" />;
}
