export function fftComplex(
  real: Float64Array,
  imag: Float64Array,
  inverse = false,
): void {
  const n = real.length;

  if (
    n === 0 ||
    real.length !== imag.length ||
    (n & (n - 1)) !== 0
  ) {
    throw new Error(
      'FFT arrays must have equal, nonzero power-of-two lengths.',
    );
  }

  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;

    while (j & bit) {
      j ^= bit;
      bit >>= 1;
    }

    j ^= bit;

    if (i < j) {
      const realTemp = real[i];
      real[i] = real[j];
      real[j] = realTemp;

      const imagTemp = imag[i];
      imag[i] = imag[j];
      imag[j] = imagTemp;
    }
  }

  for (let size = 2; size <= n; size <<= 1) {
    const halfSize = size >> 1;

    const angle =
      (inverse ? 2 : -2) * Math.PI / size;

    const stepReal = Math.cos(angle);
    const stepImag = Math.sin(angle);

    for (let start = 0; start < n; start += size) {
      let twiddleReal = 1;
      let twiddleImag = 0;

      for (let j = 0; j < halfSize; j++) {
        const evenIndex = start + j;
        const oddIndex = evenIndex + halfSize;

        const oddReal =
          real[oddIndex] * twiddleReal -
          imag[oddIndex] * twiddleImag;

        const oddImag =
          real[oddIndex] * twiddleImag +
          imag[oddIndex] * twiddleReal;

        const evenReal = real[evenIndex];
        const evenImag = imag[evenIndex];

        real[evenIndex] = evenReal + oddReal;
        imag[evenIndex] = evenImag + oddImag;

        real[oddIndex] = evenReal - oddReal;
        imag[oddIndex] = evenImag - oddImag;

        const nextTwiddleReal =
          twiddleReal * stepReal -
          twiddleImag * stepImag;

        const nextTwiddleImag =
          twiddleReal * stepImag +
          twiddleImag * stepReal;

        twiddleReal = nextTwiddleReal;
        twiddleImag = nextTwiddleImag;
      }
    }
  }

  if (inverse) {
    for (let i = 0; i < n; i++) {
      real[i] /= n;
      imag[i] /= n;
    }
  }
}

export function computeFFTMagnitudes(
  frame: Float32Array,
): Float32Array {
  const n = frame.length;

  if (
    n === 0 ||
    (n & (n - 1)) !== 0
  ) {
    throw new Error(
      'Frame length must be a nonzero power of two.',
    );
  }

  const real = new Float64Array(n);
  const imag = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    real[i] = frame[i];
  }

  fftComplex(real, imag);

  const magnitudes = new Float32Array(n / 2);

  for (let i = 0; i < n / 2; i++) {
    magnitudes[i] = Math.sqrt(
      real[i] * real[i] +
      imag[i] * imag[i],
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
        (1 -
          Math.cos(
            (2 * Math.PI * i) / (fftSize - 1),
          ));

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
      minObservedRms === Infinity
        ? null
        : minObservedRms,
    maxObservedRms,
  });

  return frames;
}