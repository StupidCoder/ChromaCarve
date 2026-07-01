import { transform, inverseTransform } from './fft';

/**
 * Discrete cosine transforms (DCT-II / DCT-III) and a Neumann-boundary Poisson
 * solver, built on the arbitrary-N complex FFT in ./fft.
 *
 * The 1D transforms use Makhoul's method: a single length-N complex FFT plus an
 * even/odd reordering and a twiddle, rather than an O(N^2) direct sum or a 2N
 * mirror extension. `dctForward1d` and `dctInverse1d` are an exact inverse pair
 * (up to floating-point error), which is all the Poisson solver needs — the
 * overall scaling of the pair cancels between the forward transform, the
 * eigenvalue division, and the inverse transform.
 *
 * Convention (unnormalized DCT-II, factor 2):
 *   X[k] = 2 * sum_{n=0}^{N-1} x[n] * cos(pi*(2n+1)*k / (2N))
 * The DCT-II even-symmetric extension is exactly the discrete Neumann boundary
 * at the true array edge, which is what "free-floating relief" requires.
 */

/** Forward DCT-II of x[0..N-1], in place. `re`/`im` are scratch of length N. */
function dctForward1d(x: Float64Array, N: number, re: Float64Array, im: Float64Array): void {
  const half = Math.ceil(N / 2);
  // Even/odd reorder: v[n] = x[2n] (front) interleaved with x[odd] in reverse.
  for (let n = 0; n < N; n++) {
    re[n] = n < half ? x[2 * n] : x[2 * N - 2 * n - 1];
    im[n] = 0;
  }
  transform(re, im); // V = FFT(v)
  for (let k = 0; k < N; k++) {
    // w_k = exp(-i*pi*k/(2N)); X[k] = 2 * Re(w_k * V[k]).
    const ang = (-Math.PI * k) / (2 * N);
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    x[k] = 2 * (c * re[k] - s * im[k]);
  }
}

/** Inverse (DCT-III) of X[0..N-1], in place — exact inverse of dctForward1d. */
function dctInverse1d(X: Float64Array, N: number, re: Float64Array, im: Float64Array): void {
  // Reconstruct the complex spectrum V[k] from the real DCT coefficients.
  // Forward gave z_k = w_k V[k] with Re(z_k)=X[k]/2 and Im(z_k)=-X[N-k]/2.
  re[0] = X[0] / 2;
  im[0] = 0;
  for (let k = 1; k < N; k++) {
    const reZ = X[k] / 2;
    const imZ = -X[N - k] / 2;
    // V[k] = w_k^{-1} * z_k, with w_k^{-1} = exp(i*pi*k/(2N)).
    const ang = (Math.PI * k) / (2 * N);
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    re[k] = c * reZ - s * imZ;
    im[k] = s * reZ + c * imZ;
  }
  inverseTransform(re, im); // unscaled IFFT -> divide by N below
  const half = Math.ceil(N / 2);
  for (let n = 0; n < N; n++) {
    const v = re[n] / N; // v is real up to rounding
    if (n < half) X[2 * n] = v;
    else X[2 * N - 2 * n - 1] = v;
  }
}

/** Apply a 1D transform along every row then every column of a w*h array. */
function transformSeparable(
  data: Float64Array,
  w: number,
  h: number,
  fn: (line: Float64Array, N: number, re: Float64Array, im: Float64Array) => void,
): void {
  // Rows
  {
    const line = new Float64Array(w);
    const re = new Float64Array(w);
    const im = new Float64Array(w);
    for (let y = 0; y < h; y++) {
      const off = y * w;
      for (let x = 0; x < w; x++) line[x] = data[off + x];
      fn(line, w, re, im);
      for (let x = 0; x < w; x++) data[off + x] = line[x];
    }
  }
  // Columns
  {
    const line = new Float64Array(h);
    const re = new Float64Array(h);
    const im = new Float64Array(h);
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) line[y] = data[y * w + x];
      fn(line, h, re, im);
      for (let y = 0; y < h; y++) data[y * w + x] = line[y];
    }
  }
}

/** In-place separable 2D DCT-II (row-major, index = y*w + x). */
export function dct2(data: Float64Array, w: number, h: number): void {
  transformSeparable(data, w, h, dctForward1d);
}

/** In-place separable 2D DCT-III (inverse of dct2). */
export function idct2(data: Float64Array, w: number, h: number): void {
  transformSeparable(data, w, h, dctInverse1d);
}

/**
 * Solve the Poisson equation  laplacian(u) = rhs  on a w*h grid with Neumann
 * (zero normal derivative) boundary conditions, using the DCT spectral method.
 * The DCT-II diagonalizes the 3-point Neumann Laplacian; dividing by its
 * eigenvalues and inverting recovers u. The solution is defined only up to an
 * additive constant, so the DC term (eigenvalue 0) is fixed to 0.
 *
 * `rhs` must be the divergence produced by the matching finite-difference
 * stencil (forward-difference gradient, backward-difference divergence).
 */
export function solvePoisson(rhs: Float64Array, w: number, h: number): Float64Array {
  const F = rhs.slice();
  dct2(F, w, h);
  for (let j = 0; j < h; j++) {
    const ay = 2 * Math.cos((Math.PI * j) / h) - 2;
    for (let i = 0; i < w; i++) {
      const idx = j * w + i;
      if (i === 0 && j === 0) {
        F[idx] = 0; // DC undetermined under Neumann BC
        continue;
      }
      const ax = 2 * Math.cos((Math.PI * i) / w) - 2;
      F[idx] /= ax + ay;
    }
  }
  idct2(F, w, h);
  return F;
}
