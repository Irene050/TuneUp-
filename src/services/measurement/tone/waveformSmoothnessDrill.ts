import { calcRMSVariance } from '@/utils/dsp/rms';
import { calcCentroidStdSmoothness, computeSpectralCentroid } from '@/utils/dsp/spectral';

export interface WaveformSmoothnessMeasurement {
  centroidSmoothnessPct: number;
  amplitudeStabilityPct: number;
}

export function measureWaveformSmoothness(
  samples: Float32Array,
  fftFrames: Float32Array[],
  sampleRate: number,
  fftSize = 1024
): WaveformSmoothnessMeasurement {
  const centroidArray = fftFrames.map((f) => computeSpectralCentroid(f, sampleRate, fftSize));
  return {
    centroidSmoothnessPct: calcCentroidStdSmoothness(centroidArray),
    amplitudeStabilityPct: calcRMSVariance(samples, 50, sampleRate),
  };
}