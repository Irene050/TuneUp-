import {
  calcCentroidStdSmoothness,
  computeSpectralCentroid,
} from '@/utils/dsp/spectral';

import { calcRMSConsistency } from '@/utils/dsp/rms';

import {
  calcLiveStability,
  filterByClarity,
  trackPitchOverTime,
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
  if (
    samples.length === 0 ||
    fftFrames.length === 0 ||
    sampleRate <= 0
  ) {
    return {
      smoothnessPct: 0,
      amplitudeStabilityPct: 0,
      pitchStabilityPct: 0,
      durationSec: 0,
    };
  }

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

  const smoothnessPct =
    calcCentroidStdSmoothness(
      centroidArray,
    );

  const amplitudeStabilityPct =
    calcRMSConsistency(
      samples,
      50,
      sampleRate,
    );

  const pitchFrames =
    filterByClarity(
      trackPitchOverTime(
        samples,
        30,
        sampleRate,
      ),
      0.8,
    );

  const pitchStabilityPct =
    calcLiveStability(
      pitchFrames.map(
        (frame) =>
          frame.frequency,
      ),
    );

  const durationSec =
    samples.length / sampleRate;

  return {
    smoothnessPct,
    amplitudeStabilityPct,
    pitchStabilityPct,
    durationSec,
  };
}