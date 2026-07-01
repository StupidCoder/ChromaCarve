/**
 * Shader sources for the compositing pipeline.
 *
 * Convention:
 *  - Each part stage writes a COLOR target (rgb = color, a = coverage mask)
 *    and a DEPTH target (r = relative depth). The coverage mask in color.a is
 *    the single authoritative mask; depth values outside the mask are ignored.
 *  - The compositor combines parts by priority replace: fg over border over bg.
 */

export const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * Procedural fill evaluated in canvas XY (mm): solid color, wood grain, marble,
 * or fractal noise. Shared by the background, border and model color shaders.
 */
export const GLSL_FILL = /* glsl */ `
uniform float uFillType;  // 0 solid, 1 wood, 2 marble, 3 noise
uniform vec3 uFillC1;
uniform vec3 uFillC2;
uniform float uFillScale; // feature size (mm)
uniform float uFillTurb;
uniform float uFillAngle; // radians
float fillHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float fillNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(fillHash(i), fillHash(i + vec2(1.0, 0.0)), u.x),
             mix(fillHash(i + vec2(0.0, 1.0)), fillHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fillFbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * fillNoise(p); p *= 2.0; a *= 0.5; }
  return v;
}
vec3 evalFill(vec2 pMm) {
  if (uFillType < 0.5) return uFillC1;
  float ca = cos(uFillAngle), sa = sin(uFillAngle);
  vec2 p = vec2(ca * pMm.x - sa * pMm.y, sa * pMm.x + ca * pMm.y);
  float s = max(uFillScale, 0.1);
  if (uFillType < 1.5) {                       // wood: warped concentric rings
    float rings = length(p) / s + uFillTurb * fillFbm(p / s);
    return mix(uFillC1, uFillC2, 0.5 + 0.5 * sin(rings * 6.2831853));
  } else if (uFillType < 2.5) {                // marble: turbulence-distorted veins
    float v = p.x / s + uFillTurb * 4.0 * fillFbm(p / (s * 2.0));
    float t = pow(0.5 + 0.5 * sin(v * 3.14159265), 2.0);
    return mix(uFillC1, uFillC2, t);
  }
  return mix(uFillC1, uFillC2, clamp(fillFbm(p / s), 0.0, 1.0)); // noise
}
`;

export const BG_COLOR_FS = /* glsl */ `
varying vec2 vUv;
uniform float uEnabled;
uniform vec2 uSizeMm;
${GLSL_FILL}
void main() {
  gl_FragColor = vec4(evalFill(vUv * uSizeMm), uEnabled); // fills the whole canvas
}
`;

/** Distance in mm from the nearest canvas edge at uv. */
const GLSL_EDGE_DIST = /* glsl */ `
float edgeDistMm(vec2 uv, vec2 sizeMm) {
  float dx = min(uv.x, 1.0 - uv.x) * sizeMm.x;
  float dy = min(uv.y, 1.0 - uv.y) * sizeMm.y;
  return min(dx, dy);
}
`;

export const BORDER_COLOR_FS = /* glsl */ `
varying vec2 vUv;
uniform float uEnabled;
uniform vec2 uSizeMm;
uniform float uBorderMm;
${GLSL_EDGE_DIST}
${GLSL_FILL}
void main() {
  float inBand = edgeDistMm(vUv, uSizeMm) < uBorderMm ? 1.0 : 0.0;
  gl_FragColor = vec4(evalFill(vUv * uSizeMm), uEnabled * inBand);
}
`;

/** Border depth: distance-into-band -> spline profile LUT -> remapped height. */
export const BORDER_DEPTH_FS = /* glsl */ `
varying vec2 vUv;
uniform vec2 uSizeMm;
uniform float uBorderMm;
uniform sampler2D uProfile; // 1D LUT (width x 1), height in r
uniform float uMin;
uniform float uMax;
${GLSL_EDGE_DIST}
void main() {
  float t = clamp(edgeDistMm(vUv, uSizeMm) / max(uBorderMm, 1e-4), 0.0, 1.0);
  float h = texture2D(uProfile, vec2(t, 0.5)).r;
  gl_FragColor = vec4(uMin + h * (uMax - uMin), 0.0, 0.0, 1.0);
}
`;

/** Stub depth shaders: write a constant relative depth everywhere (masked later). */
export const FLAT_DEPTH_FS = /* glsl */ `
varying vec2 vUv;
uniform float uDepth;
void main() {
  gl_FragColor = vec4(uDepth, 0.0, 0.0, 1.0);
}
`;

/**
 * Separable Gaussian blur (run once per axis) with a FIXED number of taps
 * spread across ±3σ. Cost is independent of σ and resolution, so a σ expressed
 * as a fraction of image size looks identical in the preview and the export.
 * (Sample the source with linear filtering so the wide taps blend smoothly.)
 */
export const BLUR_FS = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uDir;     // per-pixel uv step along one axis: (1/w,0) or (0,1/h)
uniform float uSigma;  // standard deviation in pixels
const int TAPS = 24;
void main() {
  if (uSigma <= 0.0) { gl_FragColor = texture2D(uTex, vUv); return; }
  float step = (3.0 * uSigma) / float(TAPS); // pixel spacing between taps
  vec4 acc = vec4(0.0);
  float sum = 0.0;
  for (int i = -TAPS; i <= TAPS; i++) {
    float off = float(i) * step;
    float w = exp(-(off * off) / (2.0 * uSigma * uSigma));
    acc += w * texture2D(uTex, vUv + uDir * off);
    sum += w;
  }
  gl_FragColor = acc / sum;
}
`;

/** Brightness / contrast / desaturation. Writes full-coverage color (mask = 1). */
export const IMAGE_COLOR_FS = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uTex;
uniform float uBrightness; // -1..1, additive
uniform float uContrast;   // -1..1
uniform float uDesat;      // 0..1
void main() {
  vec3 col = texture2D(uTex, vUv).rgb;
  col = (col - 0.5) * (1.0 + uContrast) + 0.5;
  col += uBrightness;
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, vec3(lum), uDesat);
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

/**
 * Tile splat. Each tile quad samples the single-tile height map (r = height,
 * g = coverage) and writes it; the material uses MAX blending so overlapping
 * tiles keep the per-pixel maximum height (e.g. layered dragon scales).
 */
export const TILE_FS = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uTile;
void main() {
  vec2 hc = texture2D(uTile, vUv).rg;
  gl_FragColor = vec4(hc.r, hc.g, 0.0, 1.0);
}
`;

/**
 * Model finalize passes. Input is a model-depth texture (r = normalized height,
 * g = coverage). One run writes the layer color (flat color + coverage mask),
 * another writes the layer depth (height remapped into the part's [min,max]).
 */
export const MODEL_COLOR_FS = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uModel;    // r = height, g = coverage
uniform sampler2D uAoBlur;   // blurred height for cavity AO (= uModel when off)
uniform vec2 uSizeMm;
uniform float uAoStrength;
uniform float uSurfaceStrength;  // fine curvature shading
uniform vec2 uSurfaceRadius;     // uv offset for the curvature taps
uniform float uFullCoverage;     // 1 => fill the whole canvas (background)
${GLSL_FILL}

// Edge-aware (bilateral) neighbor tap for the curvature term: weight by height
// similarity so neighbors across a large depth step (e.g. one part occluding
// another) are excluded, while shallow surface grooves are kept. Out-of-
// coverage (background) taps fall back to the center height.
const float CREASE_SIGMA = 0.15; // height step (normalized) treated as an occlusion edge
float creaseTap(vec2 p, float hc, inout float wsum) {
  vec4 t = texture2D(uModel, p);
  float h = t.g > 0.5 ? t.r : hc;
  float dh = h - hc;
  float w = exp(-(dh * dh) / (CREASE_SIGMA * CREASE_SIGMA));
  wsum += w;
  return w * h;
}

void main() {
  vec4 m = texture2D(uModel, vUv);
  float hC = m.r;
  float cov = mix(m.g, 1.0, uFullCoverage);

  // Cavity ambient occlusion: where the surface sits below its local average
  // (a crevice), darken the baked color. Convex/exposed areas and silhouette
  // edges (where the blurred height is pulled toward the 0 background) stay lit.
  float concavity = max(0.0, texture2D(uAoBlur, vUv).r - hC);
  float ao = 1.0 - clamp(concavity * uAoStrength * 4.0, 0.0, 0.85);

  // Fine curvature shading (edge-aware Laplacian): concave creases darken,
  // convex ridges lighten — emphasizes fine surface relief, but ignores large
  // depth steps between parts so they don't cast a hard shadow.
  float wsum = 0.0;
  float acc = creaseTap(vUv + vec2(uSurfaceRadius.x, 0.0), hC, wsum)
            + creaseTap(vUv - vec2(uSurfaceRadius.x, 0.0), hC, wsum)
            + creaseTap(vUv + vec2(0.0, uSurfaceRadius.y), hC, wsum)
            + creaseTap(vUv - vec2(0.0, uSurfaceRadius.y), hC, wsum);
  float lap = wsum > 1e-3 ? acc / wsum - hC : 0.0;
  float crease = clamp(1.0 - lap * uSurfaceStrength * 8.0, 0.4, 1.25);

  vec3 base = evalFill(vUv * uSizeMm);
  gl_FragColor = vec4(base * ao * crease, cov);
}
`;

export const MODEL_DEPTH_FS = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uModel;
uniform sampler2D uBlur;    // blurred height, for unsharp detail (= uModel when off)
uniform sampler2D uFeather; // blurred coverage, for edge feather (= uModel when off)
uniform float uMin;
uniform float uMax;
uniform float uStretchMin;  // rendered depth range (percentile) to stretch to [0,1]
uniform float uStretchMax;
uniform float uDetail;      // unsharp amount
uniform float uGamma;       // depth curve
void main() {
  float range = max(uStretchMax - uStretchMin, 1e-5);
  float hs = clamp((texture2D(uModel, vUv).r - uStretchMin) / range, 0.0, 1.0);
  // Coverage-weighted (normalized) blur: divide blurred height by blurred
  // coverage so the 0-height background outside the silhouette doesn't bleed in
  // and create a bright rim at the edges.
  vec2 b = texture2D(uBlur, vUv).rg;
  float hbRaw = b.r / max(b.g, 1e-3);
  float hb = clamp((hbRaw - uStretchMin) / range, 0.0, 1.0);
  float d = clamp(hs + uDetail * (hs - hb), 0.0, 1.0); // unsharp mask
  float g = pow(d, uGamma);                            // depth curve
  // Edge feather (constant-angle limit): recover distance-from-edge from the
  // blurred coverage (~(cov-0.5)*sigma*sqrt(2pi)); with the feather blur sized
  // to the falloff distance this reduces to a height cap of (cov-0.5)*sqrt(2pi).
  // min() clamps the slope, so every wall ramps down at the same angle.
  float cov = texture2D(uFeather, vUv).g;
  g = min(g, max(cov - 0.5, 0.0) * 2.5066);
  gl_FragColor = vec4(uMin + g * (uMax - uMin), 0.0, 0.0, 1.0);
}
`;

/**
 * Compositor (priority replace). Reads the three parts' color (rgb + mask in a)
 * and depth (r) targets. Two instances are run: one outputs composite color,
 * one outputs composite depth, selected by the same priority logic.
 */
export const COMPOSITE_FS = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uBgColor;
uniform sampler2D uBgDepth;
uniform sampler2D uBorderColor;
uniform sampler2D uBorderDepth;
uniform sampler2D uFgColor;
uniform sampler2D uFgDepth;
uniform bool uOutputDepth; // true: write depth (r) + coverage (g); false: write color

void main() {
  vec4 bgC = texture2D(uBgColor, vUv);
  vec4 bdC = texture2D(uBorderColor, vUv);
  vec4 fgC = texture2D(uFgColor, vUv);

  float fgM = fgC.a;
  float bdM = bdC.a;
  float bgM = bgC.a;

  vec3 color = vec3(0.0);
  float depth = 0.0;
  float coverage = 0.0;

  if (fgM > 0.5) {
    color = fgC.rgb;
    depth = texture2D(uFgDepth, vUv).r;
    coverage = 1.0;
  } else if (bdM > 0.5) {
    color = bdC.rgb;
    depth = texture2D(uBorderDepth, vUv).r;
    coverage = 1.0;
  } else if (bgM > 0.5) {
    color = bgC.rgb;
    depth = texture2D(uBgDepth, vUv).r;
    coverage = 1.0;
  }

  if (uOutputDepth) {
    gl_FragColor = vec4(depth, coverage, 0.0, 1.0);
  } else {
    gl_FragColor = vec4(color, coverage);
  }
}
`;
