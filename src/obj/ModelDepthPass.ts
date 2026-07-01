import * as THREE from 'three';
import type { ModelAsset } from '../assets/assetStore';

/**
 * Renders a model into a float render target as a normalized height map, viewed
 * orthographically from a caller-supplied orientation ("what you see in the
 * gizmo is what you get"). Output: R = height in [0,1] (1 = nearest/top), G = 1
 * where the model covers the pixel, else 0. The render target's depth buffer
 * ensures the topmost surface wins per pixel.
 */

const VERT = /* glsl */ `
varying float vViewZ;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewZ = mv.z; // negative in front of the camera
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
varying float vViewZ;
uniform float uZNear; // view-space z of nearest point (largest, least negative)
uniform float uZFar;  // view-space z of farthest point (smallest, most negative)
void main() {
  float h = clamp((vViewZ - uZFar) / max(uZNear - uZFar, 1e-6), 0.0, 1.0);
  gl_FragColor = vec4(h, 1.0, 0.0, 1.0);
}
`;

export class ModelDepthPass {
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 10);
  private material: THREE.ShaderMaterial;
  private mesh = new THREE.Mesh();
  private corners: THREE.Vector3[] = Array.from({ length: 8 }, () => new THREE.Vector3());

  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.DoubleSide,
      uniforms: { uZNear: { value: 1 }, uZFar: { value: 0 } },
    });
    this.mesh.material = this.material;
    this.scene.add(this.mesh);
  }

  setGeometry(asset: ModelAsset) {
    this.mesh.geometry = asset.geometry;
  }

  /**
   * Render the model depth from the given view orientation (quaternion of the
   * gizmo camera). `scale` uniformly scales the model. Frames a centered square
   * region so the model keeps its aspect ratio.
   */
  render(
    renderer: THREE.WebGLRenderer,
    target: THREE.WebGLRenderTarget,
    quat: THREE.Quaternion,
    scale: number,
    radius: number,
    offsetX = 0, // output-fraction shift (+x = model moves right)
    offsetY = 0, // (+y = model moves up)
  ) {
    // The model is never physically scaled here; `scale` is applied as a zoom
    // of the auto-fit framing below (scale > 1 makes the model fill more of the
    // output, scale < 1 leaves margin), which is the intuitive behavior.
    this.mesh.scale.setScalar(1);
    this.mesh.updateMatrixWorld(true);

    const dist = radius * 2 + 1;
    const camZ = new THREE.Vector3(0, 0, 1).applyQuaternion(quat);
    this.camera.quaternion.copy(quat);
    this.camera.position.copy(camZ.multiplyScalar(dist));
    this.camera.updateMatrixWorld(true);

    // Bounding box of the model in camera (view) space.
    const geo = this.mesh.geometry;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    const view = this.camera.matrixWorldInverse;
    const c = this.corners;
    c[0].set(bb.min.x, bb.min.y, bb.min.z);
    c[1].set(bb.min.x, bb.min.y, bb.max.z);
    c[2].set(bb.min.x, bb.max.y, bb.min.z);
    c[3].set(bb.min.x, bb.max.y, bb.max.z);
    c[4].set(bb.max.x, bb.min.y, bb.min.z);
    c[5].set(bb.max.x, bb.min.y, bb.max.z);
    c[6].set(bb.max.x, bb.max.y, bb.min.z);
    c[7].set(bb.max.x, bb.max.y, bb.max.z);
    const vmin = new THREE.Vector3(Infinity, Infinity, Infinity);
    const vmax = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    for (const corner of c) {
      corner.applyMatrix4(view);
      vmin.min(corner);
      vmax.max(corner);
    }

    // Centered framing that keeps the model un-stretched: a square auto-fit base
    // (scaled by the target aspect so the longer axis just gains empty margin),
    // divided by `scale` so the slider zooms the model within the output.
    const cx = (vmin.x + vmax.x) / 2;
    const cy = (vmin.y + vmax.y) / 2;
    const half =
      ((Math.max(vmax.x - vmin.x, vmax.y - vmin.y) / 2) * 1.05) / Math.max(scale, 1e-3);
    const aspect = target.width / target.height;
    const halfX = half * Math.max(1, aspect);
    const halfY = half * Math.max(1, 1 / aspect);
    // Shift the framing window so the model moves by the requested fraction of
    // the output (moving the window left makes the model appear further right).
    const fcx = cx - offsetX * 2 * halfX;
    const fcy = cy - offsetY * 2 * halfY;
    this.camera.left = fcx - halfX;
    this.camera.right = fcx + halfX;
    this.camera.top = fcy + halfY;
    this.camera.bottom = fcy - halfY;
    this.camera.near = -vmax.z - 0.01;
    this.camera.far = -vmin.z + 0.01;
    this.camera.updateProjectionMatrix();

    this.material.uniforms.uZNear.value = vmax.z;
    this.material.uniforms.uZFar.value = vmin.z;

    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(null);
    renderer.setClearColor(prevClear, prevAlpha);
  }
}
