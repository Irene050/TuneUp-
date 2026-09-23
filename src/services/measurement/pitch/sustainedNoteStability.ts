import {
    filterByClarity,
    trackPitchOverTime,
} from '@/utils/dsp/pitch';

export interface SustainedNoteStabilityMeasurement {
  stabilityCents: number;
  durationSec: number;
  averagePitchHz: number;
}

export function measureSustainedNoteStability(
  samples: Float32Array,
  sampleRate: number,
  minClarity = 0.7
): SustainedNoteStabilityMeasurement {
  if (!(samples instanceof Float32Array)) {
    throw new Error('Invalid audio samples.');
  }

  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error('Invalid sample rate.');
  }

  if (samples.length === 0) {
    throw new Error('No audio samples were recorded.');
  }

  const frames = trackPitchOverTime(
    samples,
    30,
    sampleRate
  );

  const voicedFrames = filterByClarity(
    frames,
    minClarity
  ).filter(
    (frame) =>
      Number.isFinite(frame.frequency) &&
      frame.frequency > 0
  );

  const durationSec = samples.length / sampleRate;

  if (voicedFrames.length === 0) {
    return {
      stabilityCents: 1000,
      durationSec,
      averagePitchHz: 0,
    };
  }

  const frequencies = voicedFrames.map(
    (frame) => frame.frequency
  );

  const averagePitchHz =
    frequencies.reduce(
      (sum, frequency) => sum + frequency,
      0
    ) / frequencies.length;

  if (
    !Number.isFinite(averagePitchHz) ||
    averagePitchHz <= 0
  ) {
    return {
      stabilityCents: 1000,
      durationSec,
      averagePitchHz: 0,
    };
  }

  const centsDeviations = frequencies.map((frequency) =>
    Math.abs(
      1200 *
        Math.log2(frequency / averagePitchHz)
    )
  );

  const stabilityCents =
    centsDeviations.reduce(
      (sum, value) => sum + value,
      0
    ) / centsDeviations.length;

  return {
    stabilityCents,
    durationSec,
    averagePitchHz,
  };
}