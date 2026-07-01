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
 * Shared procedural core for all volumetric materials (wood, stone, …). Pure
 * functions only — they take explicit args and read no uniforms, so every
 * material generator can compose them. Includes: Ashima/Gustavson 3D simplex
 * noise (MIT webgl-noise), FBM, ridged turbulence, 3D Voronoi/Worley, domain
 * warp, the volumetric sample point, a ring/band tone, and a color ramp.
 *
 * The materials all sample a 3D point P = vec3(uv*scaleXY, depth*depthScale), so
 * veins / rings / strata / cracks carve correctly through raised and recessed
 * relief (the depth map is the Z axis of a solid block).
 */
export const GLSL_CORE = /* glsl */ `
#define MAX_STOPS 6
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
// FBM in [0,1]. Octave loop bound is a compile-time constant (6); oct cuts it
// short at runtime. lac = per-octave frequency mult, gain = amplitude mult.
float fbm(vec3 p, int oct, float lac, float gain) {
  float v = 0.0, a = 0.5, norm = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= oct) break;
    v += a * snoise(p);
    norm += a;
    p *= lac; a *= gain;
  }
  return 0.5 + 0.5 * (v / max(norm, 1e-5));
}
// Classic 2x/0.5 FBM — kept so existing wood calls read the same.
float fbm3(vec3 p, int oct) { return fbm(p, oct, 2.0, 0.5); }

// Ridged turbulence: summing abs(signed noise) folds each octave at zero, which
// is what creates the sharp creases marble veins ride along. Returns ~[0,1].
float turbulence(vec3 p, int oct, float lac, float gain) {
  float v = 0.0, a = 0.5, norm = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= oct) break;
    v += a * abs(snoise(p));
    norm += a;
    p *= lac; a *= gain;
  }
  return v / max(norm, 1e-5);
}

// A vec3 of decorrelated noise, for domain warping.
vec3 warpVec(vec3 p) { return vec3(snoise(p), snoise(p + 31.4), snoise(p + 47.1)); }

// Coarse + fine domain warp (each vec2 = freq, amp); turb boosts the coarse
// amplitude (shared "turbulence" knob). Generalizes the wood warp.
vec3 domainWarp(vec3 p, vec2 coarse, vec2 fine, float turb) {
  vec3 w = p;
  w += coarse.y * (0.5 + turb) * warpVec(p * coarse.x);
  w += fine.y * warpVec(p * fine.x + 11.3);
  return w;
}

// The volumetric sample point: XY = rotated mm / feature size, Z = height*scale,
// offset by a per-seed vector so the same seed reproduces the same material.
vec3 buildP(vec2 pMm, float z, float scaleMm, float angle, vec3 seed, float depthScale) {
  float ca = cos(angle), sa = sin(angle);
  vec2 pr = vec2(ca * pMm.x - sa * pMm.y, sa * pMm.x + ca * pMm.y);
  return vec3(pr / max(scaleMm, 0.1), z * depthScale) + seed;
}

// Growth-ring / band / strata "tone" from a scalar coordinate: 0 = broad light
// band interior, 1 = thin dark boundary line. contrast controls line width.
float ringTone(float coord, float density, float contrast) {
  float t = fract(coord * density);
  float d = min(t, 1.0 - t) * 2.0;               // 1 at band center, 0 at boundary
  return 1.0 - smoothstep(0.0, mix(0.6, 0.05, contrast), d);
}

// 3D Voronoi / Worley over a 3x3x3 neighborhood (hash-based, license-clean).
// Returns F1, F2 (nearest / second-nearest feature distances) and a stable
// per-cell id in [0,1] — one function powers speckles, chips and crack nets.
struct Voro { float f1; float f2; float id; };
vec3 voroHash(vec3 c) {
  float j = 4096.0 * sin(dot(c, vec3(17.0, 59.4, 15.0)));
  vec3 r;
  r.z = fract(512.0 * j); j *= 0.125;
  r.x = fract(512.0 * j); j *= 0.125;
  r.y = fract(512.0 * j);
  return r;
}
Voro voronoi3(vec3 p) {
  vec3 ip = floor(p);
  vec3 fp = fract(p);
  float f1 = 9.0, f2 = 9.0;
  float id = 0.0;
  for (int k = -1; k <= 1; k++)
  for (int j = -1; j <= 1; j++)
  for (int i = -1; i <= 1; i++) {
    vec3 g = vec3(float(i), float(j), float(k));
    vec3 o = voroHash(ip + g);
    vec3 d = g + o - fp;
    float dist = dot(d, d);
    if (dist < f1) {
      f2 = f1; f1 = dist;
      id = fract(dot(ip + g, vec3(7.0, 113.0, 157.0)) * 0.031);
    } else if (dist < f2) {
      f2 = dist;
    }
  }
  Voro v; v.f1 = sqrt(f1); v.f2 = sqrt(f2); v.id = id; return v;
}

// Piecewise-linear color ramp across count stops (count in [1,MAX_STOPS]).
vec3 rampN(vec3 stops[MAX_STOPS], int count, float t) {
  if (count <= 1) return stops[0];
  t = clamp(t, 0.0, 1.0) * float(count - 1);
  int idx = int(floor(t));
  float f = fract(t);
  vec3 a = stops[0], b = stops[0];
  for (int i = 0; i < MAX_STOPS; i++) {
    if (i == idx) a = stops[i];
    if (i == idx + 1) b = stops[i];
  }
  return mix(a, b, f);
}
`;

/**
 * Volumetric wood material. Real grain is the intersection of the board face
 * with the tree's concentric growth-ring *cylinders*, so the core coordinate is
 * the RADIAL DISTANCE to a (wandering) pith axis — not parallel bands. Cathedral
 * arches, flame tips and the tight/wide bunching of the grain all fall out of
 * that distance function for free (Ebert/Perlin solid-texture wood; see the
 * "Procedural wood textures" literature). Layered like a node graph:
 *   block coords -> pith distance (+turbulence) -> thin latewood lines ->
 *   per-ring variation -> heart colour zoning + figure streak -> pores/fibre.
 * The Z of the sample point comes from the depth map, so raised/recessed relief
 * slices through different layers of the block.
 */
export const GLSL_WOOD = /* glsl */ `
uniform float uWoodDepthScale; // Z (depth) scale relative to XY — master "slice" knob
uniform float uWoodMode;       // 0 flat-sawn (pith line), 1 end-grain (concentric)
uniform float uWoodRingDensity;
uniform float uWoodPithDepth;  // board depth from pith; small => tight cathedral flame
uniform vec2 uWoodWarpCoarse;  // pith wander (freq, amp) — overall figure/flow
uniform vec2 uWoodWarpFine;    // radial grain turbulence (freq, amp)
uniform float uWoodContrast;   // latewood line sharpness (thin<->thick)
uniform vec3 uWoodColorMid;    // middle color stop (mid heart tone)
uniform float uWoodTint;       // large-scale heart colour zoning strength
uniform float uWoodPore;
uniform float uWoodStreak;     // bright figure/sap streak strength
uniform float uWoodFleck;      // per-ring darkness variation
uniform float uWoodSaturation;
uniform vec3 uWoodSeed;        // deterministic offset into the noise field

float woodHash(float n) { return fract(sin(n * 127.1) * 43758.5453); }
float sfbm3(vec3 p, int o) { return (fbm3(p, o) - 0.5) * 2.0; }

// Thin, seam-continuous latewood line: 1 at the ring boundary, 0 at ring centre,
// identical on both sides of the fract() seam so there is no bright/dark jump.
float woodRingLine(float g, float width) {
  float ph = fract(g);
  float d = min(ph, 1.0 - ph) * 2.0;
  return 1.0 - smoothstep(0.0, width, d);
}

// Sample point in grain units (x = along grain, y = across, z = depth slice).
vec3 woodBlockCoord(vec2 pMm, float z) {
  return buildP(pMm, z, uFillScale, uFillAngle, uWoodSeed, uWoodDepthScale);
}

// Radial distance from the (wandering) pith axis -> concentric growth rings.
// Flat-sawn: pith is a line along the grain (x) at depth uWoodPithDepth, drifting
// in lateral position and depth so the board flows between straight grain and
// cathedral flame. End-grain: concentric rings around a wandering centre point.
float woodRingCoord(vec3 q) {
  vec2 wc = uWoodWarpCoarse;              // pith wander (freq, amp)
  vec2 wf = uWoodWarpFine;                // grain turbulence (freq, amp)
  float ta = wf.y * (0.5 + uFillTurb);    // turbulence amplitude (fill turb boosts it)
  float turb = ta * sfbm3(vec3(q.x * wf.x, q.y * wf.x * 3.0, q.z) + 3.0, 4)
             + 0.3 * ta * sfbm3(vec3(q.x * wf.x * 3.0, q.y * wf.x * 8.0, q.z) + 7.0, 4);
  if (uWoodMode < 0.5) {
    float pithY = wc.y * sfbm3(vec3(q.x * wc.x, 1.0, q.z) + 2.0, 4);
    float depth = uWoodPithDepth + wc.y * 3.0 * sfbm3(vec3(q.x * wc.x * 0.8, 5.0, q.z) + 8.0, 3);
    depth = max(depth, 0.25);
    float dy = q.y - pithY;
    return sqrt(dy * dy + depth * depth) + turb;
  }
  vec2 c = wc.y * vec2(sfbm3(vec3(q.x * wc.x, 1.0, q.z) + 2.0, 3),
                       sfbm3(vec3(q.y * wc.x, 4.0, q.z) + 5.0, 3));
  return length(q.xy - c) + turb;
}

// Growth-ring "tone": 0 = broad light earlywood, 1 = thin dark latewood line.
float woodTone(vec3 q) {
  float g = woodRingCoord(q) * uWoodRingDensity;
  float width = mix(0.24, 0.06, uWoodContrast);
  float strong = woodRingLine(g, width);
  strong *= (1.0 - uWoodFleck) + uWoodFleck * woodHash(floor(g)); // some rings darker
  float fineG = g * 3.3 + 0.5 * sfbm3(vec3(q.x * 0.8, q.y * 2.0, q.z) + 7.0, 3);
  float fine = woodRingLine(fineG, width * 0.7) * 0.30;           // faint fine grain
  return clamp(strong * 0.9 + fine, 0.0, 1.0);
}

// Latewood mask at a point — reused to emboss depth micro-grooves.
float woodGrainLine(vec2 pMm, float z) {
  return woodTone(woodBlockCoord(pMm, z));
}

vec3 evalWood(vec2 pMm, float z) {
  vec3 q = woodBlockCoord(pMm, z);
  float tone = woodTone(q);

  // Large-scale heart colour zoning (earlywood C1 <-> mid), amplitude = uWoodTint.
  float zone = fbm3(vec3(q.x * 0.35, q.y * 0.55, q.z) + 20.0, 4);
  float zoneMix = clamp(smoothstep(0.30, 0.72, zone) * uWoodTint * 2.5, 0.0, 1.0);
  vec3 base = mix(uFillC1, uWoodColorMid, zoneMix);
  // Bright figure/sap streak: pale bands elongated along the grain.
  float streak = fbm3(vec3(q.x * 0.14, q.y * 0.85, q.z) + 60.0, 3);
  vec3 pale = clamp(uFillC1 * 1.18, 0.0, 1.0);
  base = mix(base, pale, smoothstep(0.52, 0.82, streak) * uWoodStreak);
  // Latewood lines pull toward the dark stop.
  vec3 col = mix(base, uFillC2, tone * 0.85);

  // High-frequency pores concentrated in the earlywood (1 - tone), stretched
  // hard along the grain — the dense fine texture between the growth lines.
  float pore = fbm3(vec3(q.x * 2.2, q.y * 75.0, q.z * 32.0), 3);
  col *= 1.0 - uWoodPore * smoothstep(0.52, 0.78, pore) * (1.0 - 0.6 * tone);
  // Fine fibre value noise (breaks up uniform bands).
  col *= 1.0 + 0.06 * sfbm3(vec3(q.x * 1.2, q.y * 26.0, q.z * 8.0), 3);
  // Chatoyance / large-scale luster.
  col *= 1.0 + 0.04 * sfbm3(vec3(q.x * 0.25, q.y * 5.0, q.z) + 40.0, 3);

  // Rein in saturation for a printable (CMYK-ish) gamut, then clamp.
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, uWoodSaturation);
  return clamp(col, 0.0, 1.0);
}
`;

/**
 * Volumetric stone materials (marble, onyx, sandstone, granite, terrazzo,
 * travertine, cracked) — all sampled at the same 3D point P = (uv*scale, depth*
 * depthScale) so veins/strata/cracks carve through the relief. Built from the
 * shared core (turbulence, voronoi3, domainWarp, ringTone, rampN).
 */
export const GLSL_STONE = /* glsl */ `
uniform float uStoneType;      // 0 marble,1 onyx,2 sandstone,3 granite,4 terrazzo,5 travertine,6 cracked
uniform float uStoneDepthScale;
uniform vec3 uStoneSeed;
uniform vec2 uStoneWarpCoarse; // (freq, amp)
uniform vec2 uStoneWarpFine;   // (freq, amp)
uniform float uStoneContrast;
uniform float uStoneTint;
uniform float uStoneSaturation;
uniform vec3 uStops[MAX_STOPS]; uniform int uStopCount;         // primary color ramp
uniform vec3 uAggPalette[MAX_STOPS]; uniform int uAggCount;     // terrazzo chip palette
uniform vec3 uMatrixColor;
uniform vec3 uVeinColor;
// marble
uniform float uVeinFreqPrimary;
uniform float uVeinFreqSecondary;
uniform float uSecondaryVeinStrength;
uniform float uTurbFreq;
uniform float uTurbAmp;
uniform float uVeinSharpness;
uniform float uInvert;
// voronoi (granite / terrazzo / travertine / cracked)
uniform float uCellScale;
uniform float uCellScale2;
uniform float uCellScale3;
uniform float uSpeckleIntensity;
uniform float uEdgeWidth;
uniform float uCrackIntensity;
// strata (onyx / sandstone / travertine)
uniform float uStrataDensity;
uniform float uStrataAxis;     // 0 = Z (default), 1 = Y, 2 = X
uniform float uStrataWaviness;

vec3 stoneP(vec2 pMm, float z) {
  return buildP(pMm, z, uFillScale, uFillAngle, uStoneSeed, uStoneDepthScale);
}

// Marble vein mask in [0,1]: bright thin ridges along the zero-crossings of a
// sine whose argument is turbulence-distorted. Two scales (bold + hairline).
float marbleVein(vec3 P) {
  float t = turbulence(P * uTurbFreq, 5, 2.0, 0.5);
  float s1 = sin((P.x + uTurbAmp * t) * uVeinFreqPrimary);
  float vein = pow(1.0 - abs(s1), mix(1.0, 12.0, uVeinSharpness));
  float s2 = sin((P.y + uTurbAmp * t) * uVeinFreqSecondary);
  float vein2 = pow(1.0 - abs(s2), mix(1.0, 18.0, uVeinSharpness));
  return clamp(vein + uSecondaryVeinStrength * vein2, 0.0, 1.0);
}

// Sedimentary strata coordinate, axis-locked and warped into wavy layers.
float strataCoord(vec3 P) {
  float axis = uStrataAxis < 0.5 ? P.z : (uStrataAxis < 1.5 ? P.y : P.x);
  return axis + uStrataWaviness * (fbm3(P * 0.3, 4) - 0.5);
}

// Cellular void / pit mask (travertine) — 1 at cell centers.
float stoneVoid(vec3 P) { return smoothstep(0.28, 0.0, voronoi3(P * uCellScale).f1); }
// Crack/edge network mask — 1 on the thin lines between Voronoi cells.
float stoneCrack(vec3 P) { Voro v = voronoi3(P * uCellScale); return smoothstep(uEdgeWidth, 0.0, v.f2 - v.f1); }

vec3 generateStone(vec2 pMm, float z) {
  vec3 P = stoneP(pMm, z);
  vec3 W = domainWarp(P, uStoneWarpCoarse, uStoneWarpFine, uFillTurb);
  vec3 col;

  if (uStoneType < 0.5) {                        // marble
    float vein = marbleVein(W);
    vec3 mcol = uInvert > 0.5 ? uVeinColor : uMatrixColor;
    vec3 vcol = uInvert > 0.5 ? uMatrixColor : uVeinColor;
    col = mix(mcol, vcol, vein);
  } else if (uStoneType < 1.5) {                 // onyx: warped agate bands
    float layer = fract(length(W.yz) * uStrataDensity * 0.5);
    col = rampN(uStops, uStopCount, layer);
    col = mix(col, uVeinColor, ringTone(length(W.yz), uStrataDensity, uStoneContrast) * 0.3);
  } else if (uStoneType < 2.5) {                 // sandstone: strata + grain
    float sc = strataCoord(W);
    col = rampN(uStops, uStopCount, fract(sc * uStrataDensity));
    col *= 1.0 - 0.25 * ringTone(sc, uStrataDensity, uStoneContrast);
    col *= 1.0 - 0.12 * (fbm3(P * 30.0, 2) - 0.5); // fine grain
  } else if (uStoneType < 3.5) {                 // granite: matrix + mineral speckles
    col = uMatrixColor;
    Voro v1 = voronoi3(P * uCellScale);
    Voro v2 = voronoi3(P * uCellScale2 + 5.0);
    Voro v3 = voronoi3(P * uCellScale3 + 9.0);
    col = mix(col, rampN(uStops, uStopCount, v1.id), uSpeckleIntensity * smoothstep(0.22, 0.0, v1.f1));
    col = mix(col, uVeinColor, uSpeckleIntensity * smoothstep(0.15, 0.0, v2.f1));
    col = mix(col, rampN(uStops, uStopCount, v3.id), 0.7 * uSpeckleIntensity * smoothstep(0.12, 0.0, v3.f1));
    float sp = snoise(P * 120.0);                // salt & pepper
    col *= 1.0 + 0.12 * uSpeckleIntensity * sign(sp) * step(0.6, abs(sp));
  } else if (uStoneType < 4.5) {                 // terrazzo: chips + matrix lines
    Voro v = voronoi3(P * uCellScale);
    col = rampN(uAggPalette, uAggCount, v.id);
    col = mix(col, uMatrixColor, smoothstep(uEdgeWidth, 0.0, v.f2 - v.f1));
  } else if (uStoneType < 5.5) {                 // travertine: strata + pitting
    float sc = strataCoord(W);
    col = rampN(uStops, uStopCount, fract(sc * uStrataDensity));
    col *= 1.0 - 0.5 * stoneVoid(P);
  } else {                                       // cracked: crack net over base
    col = rampN(uStops, uStopCount, fbm3(W * 0.5, 4));
    col = mix(col, uVeinColor, uCrackIntensity * stoneCrack(P));
  }

  // Large-scale tint + saturation limiter (shared conventions with wood).
  col *= 1.0 + uStoneTint * (fbm3(P * 0.15, 3) - 0.5);
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, uStoneSaturation);
  return clamp(col, 0.0, 1.0);
}

// Unsigned micro-relief mask per stone: veins (marble) sit proud, voids
// (travertine) and cracks (cracked) sit recessed; the +/- sign is applied by
// the depth pass from the material's microRelief mode. Others: no relief.
float stoneReliefMask(vec2 pMm, float z) {
  vec3 P = stoneP(pMm, z);
  vec3 W = domainWarp(P, uStoneWarpCoarse, uStoneWarpFine, uFillTurb);
  if (uStoneType < 0.5) return marbleVein(W);          // marble veins
  if (uStoneType > 4.5 && uStoneType < 5.5) return stoneVoid(P); // travertine
  if (uStoneType > 5.5) return stoneCrack(P);          // cracked
  return 0.0;
}
`;

/**
 * Procedural fill evaluated in canvas XY (mm): solid color, volumetric wood, or
 * volumetric stone. Shared by the background, border and model color shaders.
 * `evalFill(pMm, z)` takes a Z (height) for the volumetric materials; the
 * `evalFill(pMm)` overload passes z = 0 (flat parts, e.g. background/border).
 * `materialReliefMask` returns the (unsigned) height perturbation for the depth
 * micro-relief pass.
 */
export const GLSL_FILL = /* glsl */ `
uniform float uFillType;  // 0 solid, 1 wood, 2 stone
uniform vec3 uFillC1;
uniform vec3 uFillC2;
uniform float uFillScale; // feature size (mm)
uniform float uFillTurb;
uniform float uFillAngle; // radians
${GLSL_CORE}
${GLSL_WOOD}
${GLSL_STONE}
vec3 evalFill(vec2 pMm, float z) {
  if (uFillType < 0.5) return uFillC1;              // solid
  if (uFillType < 1.5) return evalWood(pMm, z);     // volumetric wood
  return generateStone(pMm, z);                     // volumetric stone
}
vec3 evalFill(vec2 pMm) { return evalFill(pMm, 0.0); }
float materialReliefMask(vec2 pMm, float z) {
  if (uFillType < 1.5) return woodGrainLine(pMm, z); // wood grooves
  return stoneReliefMask(pMm, z);                    // stone veins/voids/cracks
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

  // Volumetric fill: pass the height (hC) as the Z of the 3D sample point so the
  // wood grain is carved out of a solid block (flat fills ignore z).
  vec3 base = evalFill(vUv * uSizeMm, hC);
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
uniform vec2 uSizeMm;         // canvas size (mm), for the material micro-relief coords
uniform float uMatReliefAmount; // material micro-relief amount (0 = off)
uniform float uMatReliefSign;   // +1 = proud (veins), -1 = recessed (grooves/voids/cracks)
${GLSL_FILL}
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

  // Optional material micro-relief: perturb the normalized height by the
  // material's relief mask (wood grooves, marble veins proud, travertine voids /
  // cracks recessed). Applied before the [min,max] remap and clamped to [0,1] so
  // the overall relief stays intact and within the printable range. The Z fed to
  // the mask matches the color pass (raw normalized model height).
  if (uMatReliefAmount > 0.0) {
    float mask = materialReliefMask(vUv * uSizeMm, texture2D(uModel, vUv).r);
    g = clamp(g + uMatReliefSign * mask * uMatReliefAmount, 0.0, 1.0);
  }
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
