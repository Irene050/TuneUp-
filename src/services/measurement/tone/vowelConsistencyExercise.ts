import {
  calcSmoothness,
  computeSpectralCentroid,
} from '@/utils/dsp/spectral';

export interface VowelConsistencyMeasurement {
  centroidOverTime: number[];
  smoothnessPct: number;
}

export function measureVowelConsistency(
  fftFrames: Float32Array[],
  sampleRate: number,
  fftSize = 1024,
): VowelConsistencyMeasurement {
  const centroidOverTime =
    fftFrames.map((frame) =>
      computeSpectralCentroid(
        frame,
        sampleRate,
        fftSize,
      ),
    );

  return {
    centroidOverTime,
    smoothnessPct:
      calcSmoothness(
        centroidOverTime,
      ),
  };
}