import { calcRMSConsistency } from '@/utils/dsp/rms';
import {
  calcCentroidStdSmoothness,
  computeSpectralCentroid,
} from '@/utils/dsp/spectral';

export interface WaveformSmoothnessMeasurement {
  centroidSmoothnessPct: number;
  amplitudeStabilityPct: number;
  averageCentroidHz: number;
}

export function measureWaveformSmoothness(
  samples: Float32Array,
  fftFrames: Float32Array[],
  sampleRate: number,
  fftSize = 1024,
): WaveformSmoothnessMeasurement {
  const centroidArray = fftFrames
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
    centroidArray.length > 0
      ? centroidArray.reduce(
          (sum, centroid) =>
            sum + centroid,
          0,
        ) / centroidArray.length
      : 0;

  return {
    centroidSmoothnessPct:
      calcCentroidStdSmoothness(
        centroidArray,
      ),
    amplitudeStabilityPct:
      calcRMSConsistency(
        samples,
        50,
        sampleRate,
      ),
    averageCentroidHz,
  };
}