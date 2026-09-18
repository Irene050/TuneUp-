// src/utils/dsp/fft.ts

export function computeFFTMagnitudes(
  frame: Float32Array
): Float32Array {
  const n = frame.length;

  const real = new Float32Array(n);
  const imag = new Float32Array(n);

  real.set(frame);

  // ============================================================
  // BIT-REVERSAL PERMUTATION
  // ============================================================

  for (
    let i = 1, j = 0;
    i < n;
    i++
  ) {
    let bit = n >> 1;

    for (; j & bit; bit >>= 1) {
      j ^= bit;
    }

    j ^= bit;

    if (i < j) {
      [real[i], real[j]] = [
        real[j],
        real[i],
      ];

      [imag[i], imag[j]] = [
        imag[j],
        imag[i],
      ];
    }
  }

  // ============================================================
  // ITERATIVE COOLEY-TUKEY FFT
  // ============================================================

  for (
    let len = 2;
    len <= n;
    len <<= 1
  ) {
    const angle =
      (-2 * Math.PI) / len;

    const wReal =
      Math.cos(angle);

    const wImag =
      Math.sin(angle);

    for (
      let i = 0;
      i < n;
      i += len
    ) {
      let curReal = 1;
      let curImag = 0;

      for (
        let j = 0;
        j < len / 2;
        j++
      ) {
        const uReal =
          real[i + j];

        const uImag =
          imag[i + j];

        const vReal =
          real[
            i +
              j +
              len / 2
          ] *
            curReal -
          imag[
            i +
              j +
              len / 2
          ] *
            curImag;

        const vImag =
          real[
            i +
              j +
              len / 2
          ] *
            curImag +
          imag[
            i +
              j +
              len / 2
          ] *
            curReal;

        real[i + j] =
          uReal + vReal;

        imag[i + j] =
          uImag + vImag;

        real[
          i +
            j +
            len / 2
        ] =
          uReal - vReal;

        imag[
          i +
            j +
            len / 2
        ] =
          uImag - vImag;

        const nextReal =
          curReal * wReal -
          curImag * wImag;

        const nextImag =
          curReal * wImag +
          curImag * wReal;

        curReal =
          nextReal;

        curImag =
          nextImag;
      }
    }
  }

  // ============================================================
  // MAGNITUDES
  // ============================================================

  const magnitudes =
    new Float32Array(
      n / 2
    );

  for (
    let i = 0;
    i < n / 2;
    i++
  ) {
    magnitudes[i] =
      Math.sqrt(
        real[i] * real[i] +
          imag[i] * imag[i]
      );
  }

  return magnitudes;
}

// ============================================================
// PCM SAMPLES → FFT MAGNITUDE FRAMES
// ============================================================

export function samplesToFFTFrames(
  samples: Float32Array,
  fftSize = 1024,
  hopSize = 512
): Float32Array[] {
  if (
    samples.length === 0 ||
    fftSize <= 0 ||
    hopSize <= 0
  ) {
    return [];
  }

  /*
   * The current FFT implementation requires
   * the frame size to be a power of two.
   */
  if (
    (fftSize &
      (fftSize - 1)) !==
    0
  ) {
    throw new Error(
      'fftSize must be a power of two.'
    );
  }

  const frames: Float32Array[] =
    [];

  for (
    let start = 0;
    start + fftSize <=
      samples.length;
    start += hopSize
  ) {
    /*
     * Copy the raw audio into a separate frame.
     * This keeps the original recording untouched.
     */
    const frame =
      new Float32Array(
        fftSize
      );

    frame.set(
      samples.subarray(
        start,
        start + fftSize
      )
    );

    /*
     * Hann window reduces spectral leakage.
     */
    for (
      let i = 0;
      i < fftSize;
      i++
    ) {
      const window =
        0.5 *
        (
          1 -
          Math.cos(
            (2 * Math.PI * i) /
              (fftSize - 1)
          )
        );

      frame[i] *= window;
    }

    /*
     * Convert the windowed audio frame
     * into frequency magnitudes.
     */
    frames.push(
      computeFFTMagnitudes(
        frame
      )
    );
  }

  return frames;
}