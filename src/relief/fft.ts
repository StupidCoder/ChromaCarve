/*
 * Free FFT and convolution (TypeScript)
 *
 * Copyright (c) 2020 Project Nayuki. (MIT License)
 * https://www.nayuki.io/page/free-small-fft-in-multiple-languages
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 * - The above copyright notice and this permission notice shall be included in
 *   all copies or substantial portions of the Software.
 * - The Software is provided "as is", without warranty of any kind, express or
 *   implied, including but not limited to the warranties of merchantability,
 *   fitness for a particular purpose and noninfringement. In no event shall the
 *   authors or copyright holders be liable for any claim, damages or other
 *   liability, whether in an action of contract, tort or otherwise, arising from,
 *   out of or in connection with the Software or the use or other dealings in the
 *   Software.
 *
 * Ported to TypeScript / typed arrays for ChromaCarve. Supports arbitrary N via
 * radix-2 Cooley-Tukey (power-of-two lengths) or Bluestein's algorithm (any
 * length). Chosen over a power-of-two-only library so the DCT-based Poisson
 * solver can run at the exact image size, keeping the Neumann boundary on the
 * true image edge.
 */

/**
 * Computes the discrete Fourier transform (DFT) of the given complex vector,
 * storing the result back into the vectors. Runs in-place. The vectors' lengths
 * must be equal and may be any value (a power of 2 is fastest).
 */
export function transform(real: Float64Array, imag: Float64Array): void {
  const n = real.length;
  if (n !== imag.length) throw new RangeError('Mismatched lengths');
  if (n === 0) return;
  else if ((n & (n - 1)) === 0) transformRadix2(real, imag);
  else transformBluestein(real, imag);
}

/**
 * Computes the inverse discrete Fourier transform (IDFT) of the given complex
 * vector, storing the result back into the vectors. Runs in-place. This
 * transform does NOT divide by the length, so it is unscaled.
 */
export function inverseTransform(real: Float64Array, imag: Float64Array): void {
  transform(imag, real);
}

/** Cooley-Tukey decimation-in-time radix-2 FFT. Length must be a power of 2. */
function transformRadix2(real: Float64Array, imag: Float64Array): void {
  const n = real.length;
  if (n === 1) return; // Trivial transform
  let levels = -1;
  for (let i = 0; i < 32; i++) {
    if (1 << i === n) levels = i; // n = 2^levels
  }
  if (levels === -1) throw new RangeError('Length is not a power of 2');

  // Trigonometric tables
  const cosTable = new Float64Array(n / 2);
  const sinTable = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cosTable[i] = Math.cos((2 * Math.PI * i) / n);
    sinTable[i] = Math.sin((2 * Math.PI * i) / n);
  }

  // Bit-reversed addressing permutation
  for (let i = 0; i < n; i++) {
    const j = reverseBits(i, levels);
    if (j > i) {
      let temp = real[i];
      real[i] = real[j];
      real[j] = temp;
      temp = imag[i];
      imag[i] = imag[j];
      imag[j] = temp;
    }
  }

  // Cooley-Tukey decimation-in-time radix-2 FFT
  for (let size = 2; size <= n; size *= 2) {
    const halfsize = size / 2;
    const tablestep = n / size;
    for (let i = 0; i < n; i += size) {
      for (let j = i, k = 0; j < i + halfsize; j++, k += tablestep) {
        const l = j + halfsize;
        const tpre = real[l] * cosTable[k] + imag[l] * sinTable[k];
        const tpim = -real[l] * sinTable[k] + imag[l] * cosTable[k];
        real[l] = real[j] - tpre;
        imag[l] = imag[j] - tpim;
        real[j] += tpre;
        imag[j] += tpim;
      }
    }
    if (size === n) break; // Prevent overflow in 'size *= 2'
  }

  function reverseBits(x: number, bits: number): number {
    let y = 0;
    for (let i = 0; i < bits; i++) {
      y = (y << 1) | (x & 1);
      x >>>= 1;
    }
    return y;
  }
}

/**
 * Bluestein's chirp-z transform. Works for any length, including primes, by
 * expressing the DFT as a convolution. Uses non-root-of-two convolution.
 */
function transformBluestein(real: Float64Array, imag: Float64Array): void {
  const n = real.length;
  let m = 1;
  while (m < n * 2 + 1) m *= 2; // Smallest power of 2 >= n*2 + 1

  // Trigonometric tables
  const cosTable = new Float64Array(n);
  const sinTable = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const j = (i * i) % (n * 2); // This is more accurate than j = i * i
    cosTable[i] = Math.cos((Math.PI * j) / n);
    sinTable[i] = Math.sin((Math.PI * j) / n);
  }

  // Temporary vectors and preprocessing
  const areal = new Float64Array(m);
  const aimag = new Float64Array(m);
  for (let i = 0; i < n; i++) {
    areal[i] = real[i] * cosTable[i] + imag[i] * sinTable[i];
    aimag[i] = -real[i] * sinTable[i] + imag[i] * cosTable[i];
  }
  const breal = new Float64Array(m);
  const bimag = new Float64Array(m);
  breal[0] = cosTable[0];
  bimag[0] = sinTable[0];
  for (let i = 1; i < n; i++) {
    breal[i] = breal[m - i] = cosTable[i];
    bimag[i] = bimag[m - i] = sinTable[i];
  }

  // Convolution
  const creal = new Float64Array(m);
  const cimag = new Float64Array(m);
  convolveComplex(areal, aimag, breal, bimag, creal, cimag);

  // Postprocessing
  for (let i = 0; i < n; i++) {
    real[i] = creal[i] * cosTable[i] + cimag[i] * sinTable[i];
    imag[i] = -creal[i] * sinTable[i] + cimag[i] * cosTable[i];
  }
}

/**
 * Circularly convolves the given complex vectors, storing the result into the
 * out vectors. All arrays must have the same power-of-2 length.
 */
function convolveComplex(
  xreal: Float64Array,
  ximag: Float64Array,
  yreal: Float64Array,
  yimag: Float64Array,
  outreal: Float64Array,
  outimag: Float64Array,
): void {
  const n = xreal.length;
  xreal = xreal.slice();
  ximag = ximag.slice();
  yreal = yreal.slice();
  yimag = yimag.slice();
  transform(xreal, ximag);
  transform(yreal, yimag);
  for (let i = 0; i < n; i++) {
    const temp = xreal[i] * yreal[i] - ximag[i] * yimag[i];
    ximag[i] = ximag[i] * yreal[i] + xreal[i] * yimag[i];
    xreal[i] = temp;
  }
  inverseTransform(xreal, ximag);
  for (let i = 0; i < n; i++) {
    // Scaling (because this FFT implementation omits it)
    outreal[i] = xreal[i] / n;
    outimag[i] = ximag[i] / n;
  }
}
