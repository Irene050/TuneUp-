import {
  calcCentroidStdSmoothness,
  computeSpectralCentroid,
} from '@/utils/dsp/spectral';

export interface VowelConsistencyMeasurement {
  centroidOverTime: number[];
  averageCentroidHz: number;
  smoothnessPct: number;
}

export function measureVowelConsistency(
  fftFrames: Float32Array[],
  sampleRate: number,
  fftSize = 1024,
): VowelConsistencyMeasurement {
  const centroidOverTime =
    fftFrames
      .map((frame) =>
        computeSpectralCentroid(
          frame,
          sampleRate,
          fftSize,
        ),
      )
      .filter(
        (centroid) =>
          Number.isFinite(centroid) &&
          centroid > 0,
      );

  const averageCentroidHz =
    centroidOverTime.length > 0
      ? centroidOverTime.reduce(
          (sum, centroid) =>
            sum + centroid,
          0,
        ) / centroidOverTime.length
      : 0;

  return {
    centroidOverTime,
    averageCentroidHz,
    smoothnessPct:
      calcCentroidStdSmoothness(
        centroidOverTime,
      ),
  };
}