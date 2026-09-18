// src/services/measurement/tone/toneConsistencyExercise.ts

import { computeSpectralCentroid } from '@/utils/dsp/spectral';
import { calcRMS } from '@/utils/dsp/rms';

export interface ToneConsistencyMeasurement {
  centroids: number[];
  amplitudes: number[];
}

export function measureToneConsistency(
  repetitionSamples: Float32Array[],
  repetitionFFTFrames: Float32Array[][],
  sampleRate: number,
  fftSize = 1024,
): ToneConsistencyMeasurement {
  const centroids = repetitionFFTFrames.map((frames) => {
    const perFrame = frames.map((f) =>
      computeSpectralCentroid(f, sampleRate, fftSize),
    );

    return perFrame.reduce((a, b) => a + b, 0) / perFrame.length;
  });

  const amplitudes = repetitionSamples.map((s) => calcRMS(s));

  return { centroids, amplitudes };
}
