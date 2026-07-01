/**
 * Shaders for the 3D relief preview. The vertex stage displaces a high-res
 * plane by the composite depth texture and derives per-vertex normals from
 * finite differences of that texture; the fragment stage does ambient +
 * diffuse + specular shading for a single (orbiting) point light.
 */

export const VIEWER_VERT = /* glsl */ `
uniform sampler2D uDepth;
uniform float uHeightScale;
uniform vec2 uStepUv;    // uv distance between adjacent mesh vertices (1/segments)
uniform vec2 uStepWorld; // world (plane) distance between adjacent mesh vertices
varying vec3 vNormal;
varying vec3 vWorldPos;
varying vec2 vUv;

// Normals are derived by CENTRAL differences sampled at the VERTEX spacing (not
// the finer texel size), so they match the mesh facets and stay consistent at
// any depth-texture resolution. The gradient's tilt is clamped so near-vertical
// cliffs (hard composite steps) don't collapse to sideways normals, which would
// otherwise read as flickering too-dark / too-bright specular pixels along edges.
void main() {
  vUv = uv;
  float hC = texture2D(uDepth, uv).r * uHeightScale;
  float hL = texture2D(uDepth, uv - vec2(uStepUv.x, 0.0)).r * uHeightScale;
  float hR = texture2D(uDepth, uv + vec2(uStepUv.x, 0.0)).r * uHeightScale;
  float hD = texture2D(uDepth, uv - vec2(0.0, uStepUv.y)).r * uHeightScale;
  float hU = texture2D(uDepth, uv + vec2(0.0, uStepUv.y)).r * uHeightScale;

  vec2 grad = vec2((hR - hL) / (2.0 * uStepWorld.x), (hU - hD) / (2.0 * uStepWorld.y));
  float maxG = 5.67; // tan(80deg): cap the wall steepness used for shading
  float gLen = length(grad);
  if (gLen > maxG) grad *= maxG / gLen;
  vNormal = normalize(vec3(-grad, 1.0));

  vec3 pos = position;
  pos.z += hC;
  vec4 world = modelMatrix * vec4(pos, 1.0);
  vWorldPos = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const VIEWER_FRAG = /* glsl */ `
uniform sampler2D uColor;
uniform vec3 uLightPos;
uniform vec3 uCamPos;
uniform float uAmbient;
uniform float uSpecular;
uniform float uShininess;
varying vec3 vNormal;
varying vec3 vWorldPos;
varying vec2 vUv;
void main() {
  vec3 N = normalize(vNormal);
  vec3 L = normalize(uLightPos - vWorldPos);
  vec3 V = normalize(uCamPos - vWorldPos);
  vec3 R = reflect(-L, N);
  float diff = max(dot(N, L), 0.0);
  float spec = pow(max(dot(R, V), 0.0), uShininess);
  vec3 base = texture2D(uColor, vUv).rgb;
  vec3 col = base * (uAmbient + diff * (1.0 - uAmbient)) + vec3(1.0) * spec * uSpecular;
  gl_FragColor = vec4(col, 1.0);
}
`;
