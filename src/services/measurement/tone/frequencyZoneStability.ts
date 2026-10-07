import {
  calcFrequencyZoneStability,
  classifyFrequencyZone,
  type FrequencyZone,
  trackDominantFrequency,
} from '@/utils/dsp/spectral';

export interface FrequencyZoneStabilityMeasurement {
  zoneSequence: FrequencyZone[];
  stabilityPct: number;
  durationSec: number;
}

export function measureFrequencyZoneStability(
  samples: Float32Array,
  sampleRate: number,
  fftFn: (frame: Float32Array) => Float32Array,
): FrequencyZoneStabilityMeasurement {
  const frequencies = trackDominantFrequency(
    samples,
    30,
    sampleRate,
    fftFn,
  );

  const zoneSequence = frequencies.map(
    classifyFrequencyZone,
  );

  return {
    zoneSequence,
    stabilityPct:
      calcFrequencyZoneStability(
        zoneSequence,
      ),
    durationSec:
      samples.length / sampleRate,
  };
}