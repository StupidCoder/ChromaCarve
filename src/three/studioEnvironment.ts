import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/** A local HDR studio: softboxes and neutral walls, with no external image assets. */
export function createStudioEnvironment(renderer: THREE.WebGLRenderer): THREE.WebGLRenderTarget {
  const room = new RoomEnvironment();
  const generator = new THREE.PMREMGenerator(renderer);
  try {
    return generator.fromScene(room, 0.02);
  } finally {
    room.dispose();
    generator.dispose();
  }
}

/** Bake display-ready studio lighting consistently in the gizmo and color map.
 * The pipeline uses numeric float targets, so tone mapping must be explicit.
 */
export function studioMaterial(source: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  const material = source.clone();
  material.transparent = false;
  material.alphaTest = Math.max(source.alphaTest, source.transparent ? 0.5 : 0);
  material.depthWrite = true;
  material.toneMapped = false;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.toneMappingExposure = { value: 1 };
    shader.fragmentShader = THREE.ShaderChunk.tonemapping_pars_fragment + '\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <dithering_fragment>',
      'gl_FragColor = sRGBTransferOETF(vec4(ACESFilmicToneMapping(outgoingLight), 1.0));');
  };
  material.customProgramCacheKey = () => 'studio-color-aces';
  return material;
}
