import { calcBandStability, classifyResonanceBand, ResonanceBand, trackDominantFrequency } from '@/utils/dsp/spectral';

export interface ResonanceStabilizationMeasurement {
  bandSequence: ResonanceBand[];
  stabilityPct: number;
  durationSec: number;
}

export function measureResonanceStabilization(
  samples: Float32Array,
  sampleRate: number,
  fftFn: (frame: Float32Array) => Float32Array
): ResonanceStabilizationMeasurement {
  const frequencies = trackDominantFrequency(samples, 30, sampleRate, fftFn);
  const bandSequence = frequencies.map(classifyResonanceBand);

  return {
    bandSequence,
    stabilityPct: calcBandStability(bandSequence),
    durationSec: samples.length / sampleRate,
  };
}