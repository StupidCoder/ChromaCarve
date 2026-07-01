/** Map a normalized value t in [0,1] into the part's relative [min,max] range. */
export function remap(t: number, min: number, max: number): number {
  return min + t * (max - min);
}

/** GLSL helper, injected into shaders that need the same mapping. */
export const GLSL_REMAP = /* glsl */ `
float remap(float t, float lo, float hi) { return lo + t * (hi - lo); }
`;
