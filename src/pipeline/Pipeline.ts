import * as THREE from 'three';
import type { ModelAsset } from '../assets/assetStore';
import type { Fill, ModelSettings, Project } from '../state/store';
import { outputResolution } from '../state/store';
import { getImageAsset } from '../assets/assetStore';
import { ModelDepthPass } from '../obj/ModelDepthPass';
import { resolveModel } from '../obj/modelSource';
import { sampleProfile } from '../spline/profile';
import { basRelief } from '../relief/basRelief';
import {
  BG_COLOR_FS,
  BLUR_FS,
  BORDER_COLOR_FS,
  BORDER_DEPTH_FS,
  COMPOSITE_FS,
  FLAT_DEPTH_FS,
  IMAGE_COLOR_FS,
  MODEL_COLOR_FS,
  MODEL_DEPTH_FS,
  TILE_FS,
  VERT,
} from './shaders';

const PROFILE_LUT = 256; // resolution of the border profile lookup texture

const TILE_TEX = 1024; // resolution of the single-tile height map

// Cap the bas-relief Poisson solve to this dimension for interactive previews
// (the solve is a CPU readback + spectral solve; full resolution is reserved for
// export). Relief is low-frequency, so upsampling the capped result looks close.
const RELIEF_MAX_SOLVE_DIM = 1024;

// Pass raw image bytes / target values through without automatic sRGB
// conversion so the previewed/exported values are predictable (WYSIWYG).
THREE.ColorManagement.enabled = false;

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const FILL_TYPE_ID: Record<Fill['type'], number> = { solid: 0, wood: 1, marble: 2, noise: 3 };

/** Uniform definitions for the shared procedural fill (one set per material). */
function fillUniformDefs(): Record<string, THREE.IUniform> {
  return {
    uFillType: { value: 0 },
    uFillC1: { value: new THREE.Color() },
    uFillC2: { value: new THREE.Color() },
    uFillScale: { value: 1 },
    uFillTurb: { value: 0 },
    uFillAngle: { value: 0 },
  };
}

function makeTarget(w: number, h: number, depthBuffer = false): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(w, h, {
    type: THREE.FloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer,
  });
}

/** Area-average downsample of a single-channel field to sw*sh (relief solve cap). */
function boxDownsample(
  src: Float32Array,
  w: number,
  h: number,
  sw: number,
  sh: number,
): Float32Array {
  const out = new Float32Array(sw * sh);
  for (let y = 0; y < sh; y++) {
    const y0 = Math.floor((y * h) / sh);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * h) / sh));
    for (let x = 0; x < sw; x++) {
      const x0 = Math.floor((x * w) / sw);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * w) / sw));
      let sum = 0;
      let count = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          sum += src[yy * w + xx];
          count++;
        }
      }
      out[y * sw + x] = count > 0 ? sum / count : 0;
    }
  }
  return out;
}

/** Bilinear upsample of a single-channel field from sw*sh back to w*h. */
function bilinearUpsample(
  src: Float32Array,
  sw: number,
  sh: number,
  w: number,
  h: number,
): Float32Array {
  const out = new Float32Array(w * h);
  const sx = sw > 1 ? (sw - 1) / Math.max(1, w - 1) : 0;
  const sy = sh > 1 ? (sh - 1) / Math.max(1, h - 1) : 0;
  for (let y = 0; y < h; y++) {
    const fy = y * sy;
    const y0 = Math.floor(fy);
    const y1 = Math.min(sh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = x * sx;
      const x0 = Math.floor(fx);
      const x1 = Math.min(sw - 1, x0 + 1);
      const tx = fx - x0;
      const a = src[y0 * sw + x0];
      const b = src[y0 * sw + x1];
      const c = src[y1 * sw + x0];
      const d = src[y1 * sw + x1];
      const top = a + (b - a) * tx;
      const bot = c + (d - c) * tx;
      out[y * w + x] = top + (bot - top) * ty;
    }
  }
  return out;
}

/** Result of a pipeline render: composite color + depth targets and preview scale. */
export interface CompositeResult {
  color: THREE.WebGLRenderTarget;
  depth: THREE.WebGLRenderTarget;
  /** Reference depth used to normalize the depth preview (max enabled depth). */
  displayMax: number;
}

/**
 * Offscreen WebGL compositing pipeline. Holds a single renderer + render
 * targets, runs the part stages and the priority-replace compositor, and
 * supports reading the results back to CPU for the 2D preview / PNG export.
 */
export class Pipeline {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: THREE.Mesh;

  private width = 0;
  private height = 0;
  private targets: Record<string, THREE.WebGLRenderTarget> = {};

  private mats: {
    bgColor: THREE.ShaderMaterial;
    borderColor: THREE.ShaderMaterial;
    borderDepth: THREE.ShaderMaterial;
    flatDepth: THREE.ShaderMaterial;
    blur: THREE.ShaderMaterial;
    imageColor: THREE.ShaderMaterial;
    modelColor: THREE.ShaderMaterial;
    modelDepth: THREE.ShaderMaterial;
    tile: THREE.ShaderMaterial;
    composite: THREE.ShaderMaterial;
  };

  private modelPass = new ModelDepthPass();
  /** CPU-uploaded processed height for bas-relief; blitted into `reliefDepth`. */
  private reliefTex: THREE.DataTexture | null = null;
  /** Lazily-sized, linear-filtered, depth-buffered targets for supersampling. */
  private ssTargets: Record<string, THREE.WebGLRenderTarget> = {};
  /** Square target holding the single-tile height map for background tiling. */
  private tileTarget = makeTarget(TILE_TEX, TILE_TEX, true);
  private tileScene = new THREE.Scene();
  private tileMesh = new THREE.Mesh();
  /** 1D lookup texture for the border spline profile. */
  private profileTex = (() => {
    const tex = new THREE.DataTexture(
      new Float32Array(PROFILE_LUT * 4),
      PROFILE_LUT,
      1,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    return tex;
  })();

  constructor() {
    const canvas = document.createElement('canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    this.renderer.autoClear = true;

    const geo = new THREE.PlaneGeometry(2, 2);
    this.quad = new THREE.Mesh(geo);
    this.scene.add(this.quad);

    const mat = (fs: string, uniforms: Record<string, THREE.IUniform>) =>
      new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: fs, uniforms });

    this.mats = {
      bgColor: mat(BG_COLOR_FS, {
        uEnabled: { value: 0 },
        uSizeMm: { value: new THREE.Vector2() },
        ...fillUniformDefs(),
      }),
      borderColor: mat(BORDER_COLOR_FS, {
        uEnabled: { value: 0 },
        uSizeMm: { value: new THREE.Vector2() },
        uBorderMm: { value: 0 },
        ...fillUniformDefs(),
      }),
      borderDepth: mat(BORDER_DEPTH_FS, {
        uSizeMm: { value: new THREE.Vector2() },
        uBorderMm: { value: 0 },
        uProfile: { value: this.profileTex },
        uMin: { value: 0 },
        uMax: { value: 1 },
      }),
      flatDepth: mat(FLAT_DEPTH_FS, { uDepth: { value: 0 } }),
      blur: mat(BLUR_FS, {
        uTex: { value: null },
        uDir: { value: new THREE.Vector2() },
        uSigma: { value: 0 },
      }),
      imageColor: mat(IMAGE_COLOR_FS, {
        uTex: { value: null },
        uBrightness: { value: 0 },
        uContrast: { value: 0 },
        uDesat: { value: 0 },
      }),
      modelColor: mat(MODEL_COLOR_FS, {
        uModel: { value: null },
        uAoBlur: { value: null },
        uSizeMm: { value: new THREE.Vector2() },
        uAoStrength: { value: 0 },
        uSurfaceStrength: { value: 0 },
        uSurfaceRadius: { value: new THREE.Vector2() },
        uFullCoverage: { value: 0 },
        ...fillUniformDefs(),
      }),
      modelDepth: mat(MODEL_DEPTH_FS, {
        uModel: { value: null },
        uBlur: { value: null },
        uFeather: { value: null },
        uMin: { value: 0 },
        uMax: { value: 1 },
        uStretchMin: { value: 0 },
        uStretchMax: { value: 1 },
        uDetail: { value: 0 },
        uGamma: { value: 1 },
      }),
      tile: new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: TILE_FS,
        uniforms: { uTile: { value: null } },
        depthTest: false,
        depthWrite: false,
        blending: THREE.CustomBlending,
        blendEquation: THREE.MaxEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneFactor,
      }),
      composite: mat(COMPOSITE_FS, {
        uBgColor: { value: null },
        uBgDepth: { value: null },
        uBorderColor: { value: null },
        uBorderDepth: { value: null },
        uFgColor: { value: null },
        uFgDepth: { value: null },
        uOutputDepth: { value: false },
      }),
    };

    this.tileMesh.material = this.mats.tile;
    this.tileMesh.frustumCulled = false;
    this.tileScene.add(this.tileMesh);
  }

  private ensureSize(w: number, h: number) {
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    for (const key of Object.keys(this.targets)) this.targets[key].dispose();
    this.targets = {};
    for (const key of [
      'bgColor',
      'bgDepth',
      'borderColor',
      'borderDepth',
      'fgColor',
      'fgDepth',
      'blurA',
      'blurB',
      'featherBlur',
      'bgTileAccum',
      'compositeColor',
      'compositeDepth',
    ]) {
      this.targets[key] = makeTarget(w, h);
    }
    // Blur intermediates use linear filtering so the wide-tap blur blends.
    for (const key of ['blurA', 'blurB']) {
      this.targets[key].texture.minFilter = THREE.LinearFilter;
      this.targets[key].texture.magFilter = THREE.LinearFilter;
    }
    // Model depth passes need a real depth buffer so the top surface wins.
    this.targets.modelDepth = makeTarget(w, h, true);
    // Processed bas-relief height (R) + coverage (G), same float format.
    this.targets.reliefDepth = makeTarget(w, h);

    // (Re)allocate the CPU-upload texture that carries the relief result back to
    // the GPU. Float + Nearest to match makeTarget so no quantization sneaks in.
    this.reliefTex?.dispose();
    this.reliefTex = new THREE.DataTexture(
      new Float32Array(w * h * 4),
      w,
      h,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    this.reliefTex.minFilter = THREE.NearestFilter;
    this.reliefTex.magFilter = THREE.NearestFilter;
  }

  private pass(material: THREE.Material, target: THREE.WebGLRenderTarget) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
  }

  /** Apply a Fill to a material's procedural-fill uniforms. */
  private setFill(material: THREE.ShaderMaterial, fill: Fill) {
    const u = material.uniforms;
    u.uFillType.value = FILL_TYPE_ID[fill.type];
    (u.uFillC1.value as THREE.Color).set(...(hexToRgb(fill.color1) as [number, number, number]));
    (u.uFillC2.value as THREE.Color).set(...(hexToRgb(fill.color2) as [number, number, number]));
    u.uFillScale.value = fill.scaleMm;
    u.uFillTurb.value = fill.turbulence;
    u.uFillAngle.value = (fill.angle * Math.PI) / 180;
  }

  /** Sample the border profile spline into the 1D lookup texture. */
  private updateProfileLUT(points: Project['border']['profilePoints']) {
    const lut = sampleProfile(points, PROFILE_LUT);
    const data = this.profileTex.image.data as unknown as Float32Array;
    for (let i = 0; i < PROFILE_LUT; i++) {
      data[i * 4] = lut[i];
      data[i * 4 + 3] = 1;
    }
    this.profileTex.needsUpdate = true;
  }

  /**
   * Splat the single tile across the canvas at `interval` spacing with MAX
   * blending, accumulating per-pixel max height into `bgTileAccum`.
   */
  private renderTiles(model: Project['background']['model'], output: Project['output']) {
    const { widthMm, heightMm } = output;
    const half = model.tileSizeMm / 2;
    const ix = Math.max(model.intervalXmm, 0.01);
    const iy = Math.max(model.intervalYmm, 0.01);

    // Tile centers anchored on the canvas center, covering the whole canvas.
    const centersX: number[] = [];
    const centersY: number[] = [];
    const kx = Math.ceil(widthMm / ix) + 2;
    const ky = Math.ceil(heightMm / iy) + 2;
    for (let k = -kx; k <= kx; k++) {
      const cx = widthMm / 2 + k * ix;
      if (cx + half >= 0 && cx - half <= widthMm) centersX.push(cx);
    }
    for (let k = -ky; k <= ky; k++) {
      const cy = heightMm / 2 + k * iy;
      if (cy + half >= 0 && cy - half <= heightMm) centersY.push(cy);
    }

    const pos: number[] = [];
    const uv: number[] = [];
    const mmToClipX = (mm: number) => (mm / widthMm) * 2 - 1;
    const mmToClipY = (mm: number) => (mm / heightMm) * 2 - 1;
    for (const cy of centersY) {
      for (const cx of centersX) {
        const x0 = mmToClipX(cx - half);
        const x1 = mmToClipX(cx + half);
        const y0 = mmToClipY(cy - half);
        const y1 = mmToClipY(cy + half);
        pos.push(x0, y0, 0, x1, y0, 0, x1, y1, 0, x0, y0, 0, x1, y1, 0, x0, y1, 0);
        uv.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
      }
    }

    const geo = this.tileMesh.geometry;
    geo.dispose();
    const newGeo = new THREE.BufferGeometry();
    newGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    newGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    this.tileMesh.geometry = newGeo;

    this.mats.tile.uniforms.uTile.value = this.tileTarget.texture;
    this.renderer.setRenderTarget(this.targets.bgTileAccum);
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.clear();
    this.renderer.render(this.tileScene, this.camera);
    this.renderer.setRenderTarget(null);
  }

  /**
   * Run the full pipeline for the given project. When `opts.reliefFullRes` is
   * set (exports), the bas-relief solve runs at native resolution; otherwise it
   * is capped for interactive previews.
   */
  render(project: Project, opts: { reliefFullRes?: boolean } = {}): CompositeResult {
    const res = outputResolution(project.output);
    this.ensureSize(res.width, res.height);
    const t = this.targets;
    const { background, border, foreground, output } = project;

    // --- Background stage ---
    const bgImageAsset = getImageAsset(background.image.assetRef);
    const bgModelAsset = resolveModel(background.model);
    const useImage = background.enabled && background.type === 'image' && !!bgImageAsset;
    const useBgModel = background.enabled && background.type === 'model' && !!bgModelAsset;
    const useSolid = background.enabled && background.type === 'solid';
    if (useImage) {
      // Separable Gaussian blur (radius = fraction of the shorter side, so the
      // preview and export match), then color effects.
      const sigmaPx = background.image.blur * Math.min(res.width, res.height);
      this.blurInto(bgImageAsset!.texture, t.blurB, sigmaPx);

      const ic = this.mats.imageColor;
      ic.uniforms.uTex.value = t.blurB.texture;
      ic.uniforms.uBrightness.value = background.image.brightness;
      ic.uniforms.uContrast.value = background.image.contrast;
      ic.uniforms.uDesat.value = background.image.desaturation;
      this.pass(ic, t.bgColor);

      // Background image depth is a flat constant equal to depth.min.
      this.mats.flatDepth.uniforms.uDepth.value = background.image.depth.min;
      this.pass(this.mats.flatDepth, t.bgDepth);
    } else if (useBgModel) {
      // Render one tile, splat it across the canvas with MAX blending, then
      // remap the accumulated height into the part's [min,max].
      this.modelPass.setGeometry(bgModelAsset!);
      this.renderModelDepth(
        'tile',
        background.model,
        bgModelAsset!,
        this.tileTarget,
        new THREE.Quaternion(...background.model.rotationQuat),
      );
      this.renderTiles(background.model, output);

      // Background fills the whole canvas (full coverage); gaps sit at depth.min.
      this.renderModelColor(
        background.model,
        t.bgTileAccum,
        true,
        t.bgColor,
        output.widthMm,
        output.heightMm,
      );

      // Range measured on the single tile; detail/gamma applied to the accum.
      this.finalizeModelDepth(
        background.model,
        t.bgTileAccum,
        this.tileTarget,
        TILE_TEX,
        TILE_TEX,
        t.bgDepth,
        output.widthMm,
      );
    } else if (useSolid) {
      // Fill (solid color or texture) at a constant depth.
      const bgColor = this.mats.bgColor;
      bgColor.uniforms.uEnabled.value = 1;
      (bgColor.uniforms.uSizeMm.value as THREE.Vector2).set(output.widthMm, output.heightMm);
      this.setFill(bgColor, background.solidFill);
      this.pass(bgColor, t.bgColor);
      this.mats.flatDepth.uniforms.uDepth.value = background.solidDepth;
      this.pass(this.mats.flatDepth, t.bgDepth);
    } else {
      // Disabled / no asset: clear the background layer (mask 0).
      this.mats.bgColor.uniforms.uEnabled.value = 0;
      this.pass(this.mats.bgColor, t.bgColor);
    }

    // --- Border stage (spline profile applied to the edge band) ---
    this.updateProfileLUT(border.profilePoints);
    const sizeMm: [number, number] = [output.widthMm, output.heightMm];
    const borderColor = this.mats.borderColor;
    this.setFill(borderColor, border.fill);
    borderColor.uniforms.uEnabled.value = border.enabled ? 1 : 0;
    (borderColor.uniforms.uSizeMm.value as THREE.Vector2).set(...sizeMm);
    borderColor.uniforms.uBorderMm.value = border.widthMm;
    this.pass(borderColor, t.borderColor);

    const bd = this.mats.borderDepth;
    (bd.uniforms.uSizeMm.value as THREE.Vector2).set(...sizeMm);
    bd.uniforms.uBorderMm.value = border.widthMm;
    bd.uniforms.uMin.value = border.depth.min;
    bd.uniforms.uMax.value = border.depth.max;
    this.pass(bd, t.borderDepth);

    // --- Foreground stage (model depth) ---
    const fgAsset = resolveModel(foreground.model);
    if (foreground.enabled && fgAsset) {
      this.modelPass.setGeometry(fgAsset);
      this.renderModelDepth(
        'fg',
        foreground.model,
        fgAsset,
        t.modelDepth,
        new THREE.Quaternion(...foreground.model.rotationQuat),
        foreground.model.offsetXmm / output.widthMm,
        foreground.model.offsetYmm / output.heightMm,
      );

      // Bas-relief: replace the raw height field with gradient-domain relief
      // (dissolves silhouette cliffs, compresses form, keeps detail). Both the
      // color/AO and the depth stages then consume the processed height. When
      // off, the raw path below is unchanged.
      let heightTarget = t.modelDepth;
      let reliefRange: { min: number; max: number } | undefined;
      if (foreground.model.basRelief) {
        reliefRange = this.applyBasRelief(
          t.modelDepth,
          foreground.model,
          t.reliefDepth,
          res.width,
          res.height,
          !!opts.reliefFullRes,
        );
        heightTarget = t.reliefDepth;
      }

      this.renderModelColor(
        foreground.model,
        heightTarget,
        false,
        t.fgColor,
        output.widthMm,
        output.heightMm,
      );

      this.finalizeModelDepth(
        foreground.model,
        heightTarget,
        heightTarget,
        res.width,
        res.height,
        t.fgDepth,
        output.widthMm,
        reliefRange,
      );
    } else {
      // Disabled / no model: clear the foreground layer (mask 0).
      this.mats.bgColor.uniforms.uEnabled.value = 0;
      this.pass(this.mats.bgColor, t.fgColor);
    }

    // --- Composite (priority replace) ---
    const comp = this.mats.composite;
    comp.uniforms.uBgColor.value = t.bgColor.texture;
    comp.uniforms.uBgDepth.value = t.bgDepth.texture;
    comp.uniforms.uBorderColor.value = t.borderColor.texture;
    comp.uniforms.uBorderDepth.value = t.borderDepth.texture;
    comp.uniforms.uFgColor.value = t.fgColor.texture;
    comp.uniforms.uFgDepth.value = t.fgDepth.texture;

    comp.uniforms.uOutputDepth.value = false;
    this.pass(comp, t.compositeColor);
    comp.uniforms.uOutputDepth.value = true;
    this.pass(comp, t.compositeDepth);

    const enabledMaxes: number[] = [];
    if (background.enabled)
      enabledMaxes.push(
        background.type === 'image'
          ? background.image.depth.min
          : background.type === 'solid'
            ? background.solidDepth
            : background.model.depth.max,
      );
    if (border.enabled) enabledMaxes.push(border.depth.max);
    if (foreground.enabled) enabledMaxes.push(foreground.model.depth.max);
    const displayMax = Math.max(1e-4, ...enabledMaxes);

    return { color: t.compositeColor, depth: t.compositeDepth, displayMax };
  }

  /** Read a render target back into a Float32Array (RGBA, row 0 = bottom). */
  readFloat(target: THREE.WebGLRenderTarget): Float32Array {
    const buf = new Float32Array(this.width * this.height * 4);
    this.renderer.readRenderTargetPixels(target, 0, 0, this.width, this.height, buf);
    return buf;
  }

  /**
   * Depth range of a model target's height (r) over covered pixels (g > 0.5),
   * clipped at the given percentile from each end so a few stray near/far
   * pixels don't compress the range. Used to stretch the relief to full range.
   */
  private computeRange(
    target: THREE.WebGLRenderTarget,
    w: number,
    h: number,
    percentile: number,
  ): { min: number; max: number } {
    const buf = new Float32Array(w * h * 4);
    this.renderer.readRenderTargetPixels(target, 0, 0, w, h, buf);
    const BINS = 256;
    const hist = new Int32Array(BINS);
    let total = 0;
    for (let i = 0; i < w * h; i++) {
      if (buf[i * 4 + 1] < 0.5) continue; // skip uncovered pixels
      const v = Math.min(BINS - 1, Math.max(0, Math.floor(buf[i * 4] * (BINS - 1))));
      hist[v]++;
      total++;
    }
    if (total === 0) return { min: 0, max: 1 };
    const loCount = total * percentile;
    const hiCount = total * (1 - percentile);
    let lo = 0;
    let hi = BINS - 1;
    let cum = 0;
    for (let b = 0; b < BINS; b++) {
      if (cum <= loCount) lo = b;
      if (cum <= hiCount) hi = b;
      cum += hist[b];
    }
    const min = lo / (BINS - 1);
    const max = hi / (BINS - 1);
    // Flat (near-constant) surface: fall back to no stretch so it keeps its
    // constant height instead of collapsing to the floor.
    if (!(max - min > 1e-3)) return { min: 0, max: 1 };
    return { min, max };
  }

  private ssTarget(key: string, w: number, h: number): THREE.WebGLRenderTarget {
    let t = this.ssTargets[key];
    if (!t || t.width !== w || t.height !== h) {
      t?.dispose();
      t = new THREE.WebGLRenderTarget(w, h, {
        type: THREE.FloatType,
        format: THREE.RGBAFormat,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: true,
      });
      this.ssTargets[key] = t;
    }
    return t;
  }

  /** Copy a (linear-filtered) source target into dest at dest's resolution. */
  private downsample(src: THREE.WebGLRenderTarget, dest: THREE.WebGLRenderTarget) {
    const blur = this.mats.blur;
    blur.uniforms.uSigma.value = 0; // sigma 0 => single bilinear tap = box downsample
    blur.uniforms.uTex.value = src.texture;
    this.pass(blur, dest);
  }

  /**
   * Render a model's height map into `dest`, optionally supersampled 2x and
   * downsampled to reduce edge aliasing (capped so large exports don't blow up
   * memory; full-res exports are already finely sampled).
   */
  private renderModelDepth(
    key: string,
    model: ModelSettings,
    asset: ModelAsset,
    dest: THREE.WebGLRenderTarget,
    quat: THREE.Quaternion,
    offsetX = 0,
    offsetY = 0,
  ) {
    const canSS = model.supersample && Math.max(dest.width, dest.height) * 2 <= 1600;
    if (canSS) {
      const ss = this.ssTarget(key, dest.width * 2, dest.height * 2);
      this.modelPass.render(this.renderer, ss, quat, model.scale, asset.radius, offsetX, offsetY);
      this.downsample(ss, dest);
    } else {
      this.modelPass.render(this.renderer, dest, quat, model.scale, asset.radius, offsetX, offsetY);
    }
  }

  /**
   * Finalize a model height map into a depth layer: percentile-normalize,
   * unsharp-detail, gamma curve, then remap to the layer's [min,max].
   * `rangeSrc` is the target used to measure the depth range (the single model
   * for the foreground; the single tile for the tiled background).
   */
  /** Separable blur of `src` into `dest` at the given pixel sigma. */
  private blurInto(src: THREE.Texture, dest: THREE.WebGLRenderTarget, sigmaPx: number) {
    const blur = this.mats.blur;
    blur.uniforms.uSigma.value = sigmaPx;
    blur.uniforms.uTex.value = src;
    (blur.uniforms.uDir.value as THREE.Vector2).set(1 / this.width, 0);
    this.pass(blur, this.targets.blurA);
    blur.uniforms.uTex.value = this.targets.blurA.texture;
    (blur.uniforms.uDir.value as THREE.Vector2).set(0, 1 / this.height);
    this.pass(blur, dest);
  }

  /**
   * Render a model layer's color = flat color × cavity AO. `fullCoverage` fills
   * the whole canvas (background) vs the model silhouette (foreground).
   */
  private renderModelColor(
    model: ModelSettings,
    height: THREE.WebGLRenderTarget,
    fullCoverage: boolean,
    out: THREE.WebGLRenderTarget,
    widthMm: number,
    heightMm: number,
  ) {
    let aoTex = height.texture;
    if (model.aoStrength > 0) {
      const sigmaPx = (model.aoRadiusMm / widthMm) * this.width;
      this.blurInto(height.texture, this.targets.blurB, sigmaPx);
      aoTex = this.targets.blurB.texture;
    }
    const mc = this.mats.modelColor;
    mc.uniforms.uModel.value = height.texture;
    mc.uniforms.uAoBlur.value = aoTex;
    (mc.uniforms.uSizeMm.value as THREE.Vector2).set(widthMm, heightMm);
    this.setFill(mc, model.fill);
    mc.uniforms.uAoStrength.value = model.aoStrength;
    mc.uniforms.uSurfaceStrength.value = model.surfaceShade;
    (mc.uniforms.uSurfaceRadius.value as THREE.Vector2).set(
      model.surfaceShadeRadiusMm / widthMm,
      model.surfaceShadeRadiusMm / heightMm,
    );
    mc.uniforms.uFullCoverage.value = fullCoverage ? 1 : 0;
    this.pass(mc, out);
  }

  /**
   * Read back the raw model height field, run the gradient-domain bas-relief
   * solve on the CPU, and blit the processed height (R) + original coverage (G)
   * into `dest`. Returns the stretch range to feed finalizeModelDepth (so it
   * skips its own readback). For previews the solve is capped and upsampled;
   * exports pass `fullRes` to solve at native resolution.
   */
  private applyBasRelief(
    src: THREE.WebGLRenderTarget,
    model: ModelSettings,
    dest: THREE.WebGLRenderTarget,
    w: number,
    h: number,
    fullRes: boolean,
  ): { min: number; max: number } {
    const buf = this.readFloat(src); // RGBA float, w*h*4, bottom-up rows
    const n = w * h;
    const height = new Float32Array(n);
    const mask = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      height[i] = buf[i * 4];
      mask[i] = buf[i * 4 + 1];
    }

    const params = {
      beta: model.reliefBeta,
      tauPercentile: model.reliefTauPct,
      wallGamma: model.reliefWallGamma,
      alphaFactor: model.reliefAlphaFactor,
    };

    // Cap the solve grid for previews; relief is low-frequency so the upsampled
    // result closely matches the full-resolution solve.
    let sw = w;
    let sh = h;
    let solveHeight: Float32Array = height;
    let solveMask: Float32Array = mask;
    const downscale = !fullRes && Math.max(w, h) > RELIEF_MAX_SOLVE_DIM;
    if (downscale) {
      const s = RELIEF_MAX_SOLVE_DIM / Math.max(w, h);
      sw = Math.max(1, Math.round(w * s));
      sh = Math.max(1, Math.round(h * s));
      solveHeight = boxDownsample(height, w, h, sw, sh);
      solveMask = boxDownsample(mask, w, h, sw, sh);
    }

    const result = basRelief(solveHeight, solveMask, sw, sh, params);
    const reliefFull = downscale ? bilinearUpsample(result.data, sw, sh, w, h) : result.data;

    // Repack into the CPU-upload texture: R = relief height, G = original mask.
    const data = this.reliefTex!.image.data as unknown as Float32Array;
    for (let i = 0; i < n; i++) {
      data[i * 4] = reliefFull[i];
      data[i * 4 + 1] = mask[i];
      data[i * 4 + 2] = 0;
      data[i * 4 + 3] = 1;
    }
    this.reliefTex!.needsUpdate = true;

    // Blit into dest via the sigma-0 passthrough (full RGBA copy).
    const blur = this.mats.blur;
    blur.uniforms.uSigma.value = 0;
    blur.uniforms.uTex.value = this.reliefTex;
    this.pass(blur, dest);

    return model.normalizeDepth ? { min: result.min, max: result.max } : { min: 0, max: 1 };
  }

  private finalizeModelDepth(
    model: ModelSettings,
    height: THREE.WebGLRenderTarget,
    rangeSrc: THREE.WebGLRenderTarget,
    rangeW: number,
    rangeH: number,
    out: THREE.WebGLRenderTarget,
    widthMm: number,
    precomputedRange?: { min: number; max: number },
  ) {
    const minDim = Math.min(this.width, this.height);
    const md = this.mats.modelDepth;

    // Unsharp detail blur (height + coverage), radius ~2% of the image.
    let blurTex = height.texture;
    if (model.detail > 0) {
      this.blurInto(height.texture, this.targets.blurB, 0.02 * minDim);
      blurTex = this.targets.blurB.texture;
    }

    // Edge feather: blur the coverage by the falloff distance (mm -> px, so it
    // is resolution-independent), giving a soft 1->0 coverage ramp at edges.
    let featherTex = height.texture;
    if (model.edgeFalloffMm > 0) {
      const sigmaPx = (model.edgeFalloffMm / widthMm) * this.width;
      this.blurInto(height.texture, this.targets.featherBlur, sigmaPx);
      featherTex = this.targets.featherBlur.texture;
    }

    // Bas-relief supplies its range from the CPU solve (measured on the
    // processed field), avoiding a second GPU readback here.
    const range =
      precomputedRange ??
      (model.normalizeDepth ? this.computeRange(rangeSrc, rangeW, rangeH, 0.01) : { min: 0, max: 1 });
    md.uniforms.uModel.value = height.texture;
    md.uniforms.uBlur.value = blurTex;
    md.uniforms.uFeather.value = featherTex;
    md.uniforms.uStretchMin.value = range.min;
    md.uniforms.uStretchMax.value = range.max;
    md.uniforms.uDetail.value = model.detail;
    md.uniforms.uGamma.value = model.gamma;
    md.uniforms.uMin.value = model.depth.min;
    md.uniforms.uMax.value = model.depth.max;
    this.pass(md, out);
  }

  get size() {
    return { width: this.width, height: this.height };
  }
}

let singleton: Pipeline | null = null;
export function getPipeline(): Pipeline {
  if (!singleton) singleton = new Pipeline();
  return singleton;
}
