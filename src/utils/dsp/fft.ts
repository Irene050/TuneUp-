export function computeFFTMagnitudes(
  frame: Float32Array
): Float32Array {
  const n = frame.length;

  const real = new Float32Array(n);
  const imag = new Float32Array(n);

  real.set(frame);

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

export function samplesToFFTFrames(
  samples: Float32Array,
  fftSize = 1024,
  hopSize = 512,
  minFrameRms = 0.01,
): Float32Array[] {
  if (
    samples.length === 0 ||
    !Number.isInteger(fftSize) ||
    fftSize <= 0 ||
    !Number.isInteger(hopSize) ||
    hopSize <= 0 ||
    !Number.isFinite(minFrameRms) ||
    minFrameRms < 0
  ) {
    return [];
  }

  if ((fftSize & (fftSize - 1)) !== 0) {
    throw new Error('fftSize must be a power of two.');
  }

  if (hopSize > fftSize) {
    throw new Error('hopSize should not exceed fftSize.');
  }

  const frames: Float32Array[] = [];

  let processedFrames = 0;
  let skippedQuietFrames = 0;
  let skippedInvalidFrames = 0;
  let minObservedRms = Infinity;
  let maxObservedRms = 0;

  for (
    let start = 0;
    start + fftSize <= samples.length;
    start += hopSize
  ) {
    const rawFrame = samples.subarray(
      start,
      start + fftSize,
    );

    processedFrames++;

    let sumSquares = 0;
    let isFiniteFrame = true;

    for (let i = 0; i < fftSize; i++) {
      const sample = rawFrame[i];

      if (!Number.isFinite(sample)) {
        isFiniteFrame = false;
        break;
      }

      sumSquares += sample * sample;
    }

    if (!isFiniteFrame || !Number.isFinite(sumSquares)) {
      skippedInvalidFrames++;
      continue;
    }

    const frameRms = Math.sqrt(sumSquares / fftSize);

    if (!Number.isFinite(frameRms)) {
      skippedInvalidFrames++;
      continue;
    }

    minObservedRms = Math.min(minObservedRms, frameRms);
    maxObservedRms = Math.max(maxObservedRms, frameRms);

    if (frameRms < minFrameRms) {
      skippedQuietFrames++;
      continue;
    }

    const windowedFrame = new Float32Array(fftSize);

    for (let i = 0; i < fftSize; i++) {
      const window =
        0.5 *
        (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));

      windowedFrame[i] = rawFrame[i] * window;
    }

    const magnitudes = computeFFTMagnitudes(windowedFrame);

    let hasValidSpectrum = true;

    for (let i = 0; i < magnitudes.length; i++) {
      if (
        !Number.isFinite(magnitudes[i]) ||
        magnitudes[i] < 0
      ) {
        hasValidSpectrum = false;
        break;
      }
    }

    if (!hasValidSpectrum) {
      skippedInvalidFrames++;
      continue;
    }

    frames.push(magnitudes);
  }

  console.log('🎤 FFT FRAME VALIDATION DEBUG:', {
    processedFrames,
    retainedFrames: frames.length,
    skippedQuietFrames,
    skippedInvalidFrames,
    minFrameRms,
    minObservedRms:
      minObservedRms === Infinity ? null : minObservedRms,
    maxObservedRms,
  });

  return frames;
}