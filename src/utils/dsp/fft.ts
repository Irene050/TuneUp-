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

function computeFFTMagnitudesWithWorkspace(
  frame: Float32Array,
  real: Float64Array,
  imag: Float64Array,
): Float32Array {
  for (let i = 0; i < frame.length; i++) {
    real[i] = frame[i];
    imag[i] = 0;
  }

  fftComplex(real, imag);

  const magnitudes = new Float32Array(frame.length / 2);

  for (let i = 0; i < frame.length / 2; i++) {
    magnitudes[i] = Math.sqrt(
      real[i] * real[i] +
      imag[i] * imag[i],
    );
  }

  return magnitudes;
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

  return computeFFTMagnitudesWithWorkspace(
    frame,
    new Float64Array(n),
    new Float64Array(n),
  );
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
  const hannWindow = new Float64Array(fftSize);
  const windowedFrame = new Float32Array(fftSize);
  const real = new Float64Array(fftSize);
  const imag = new Float64Array(fftSize);

  for (let i = 0; i < fftSize; i++) {
    hannWindow[i] =
      0.5 *
      (1 -
        Math.cos(
          (2 * Math.PI * i) / (fftSize - 1),
        ));
  }

  for (
    let start = 0;
    start + fftSize <= samples.length;
    start += hopSize
  ) {
    const rawFrame = samples.subarray(
      start,
      start + fftSize,
    );

    let isFiniteFrame = true;
    let sumSquares = 0;

    for (let i = 0; i < rawFrame.length; i++) {
      const sample = rawFrame[i];

      if (!Number.isFinite(sample)) {
        isFiniteFrame = false;
        break;
      }

      sumSquares += sample * sample;
    }

    if (!isFiniteFrame) {
      continue;
    }

    const frameRms = Math.sqrt(
      sumSquares / rawFrame.length,
    );

    if (!Number.isFinite(frameRms)) {
      continue;
    }

    if (frameRms < minFrameRms) {
      continue;
    }

    for (let i = 0; i < fftSize; i++) {
      windowedFrame[i] =
        rawFrame[i] * hannWindow[i];
    }

    const magnitudes = computeFFTMagnitudesWithWorkspace(
      windowedFrame,
      real,
      imag,
    );

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
      continue;
    }

    frames.push(magnitudes);
  }
  return frames;
}