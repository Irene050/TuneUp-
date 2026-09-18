// src/services/measurement/tone/steadyToneHolding.ts

import {
  computeSpectralCentroid,
  calcCentroidStdSmoothness,
} from '@/utils/dsp/spectral';

import { calcRMSVariance } from '@/utils/dsp/rms';

import {
  trackPitchOverTime,
  filterByClarity,
  calcJitterStability,
} from '@/utils/dsp/pitch';

export interface SteadyToneHoldingMeasurement {
  smoothnessPct: number;
  amplitudeStabilityPct: number;
  pitchStabilityPct: number;
  durationSec: number;
}

export function measureSteadyToneHolding(
  samples: Float32Array,
  fftFrames: Float32Array[],
  sampleRate: number,
  fftSize = 1024,
): SteadyToneHoldingMeasurement {
  const centroidArray = fftFrames.map((f) =>
    computeSpectralCentroid(f, sampleRate, fftSize),
  );

  const smoothnessPct =
    calcCentroidStdSmoothness(centroidArray);

  const amplitudeStabilityPct =
    calcRMSVariance(samples, 50, sampleRate);

  const pitchFrames = filterByClarity(
    trackPitchOverTime(samples, 30, sampleRate),
    0.8,
  );

  const pitchStabilityPct =
    calcJitterStability(
      pitchFrames.map((f) => f.frequency),
    );

  return {
    smoothnessPct,
    amplitudeStabilityPct,
    pitchStabilityPct,
    durationSec: samples.length / sampleRate,
  };
}
