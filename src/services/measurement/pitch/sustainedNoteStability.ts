import {
  filterByClarity,
  trackPitchOverTime,
} from '@/utils/dsp/pitch';

export interface SustainedNoteStabilityMeasurement {
  stabilityCents: number;
  durationSec: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function measureSustainedNoteStability(
  samples: Float32Array,
  sampleRate: number,
  minClarity = 0.7,
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

  const durationSec = samples.length / sampleRate;

  const frames = trackPitchOverTime(
    samples,
    30,
    sampleRate,
  );

  const voicedFrames = filterByClarity(
    frames,
    minClarity,
  ).filter(
    frame =>
      Number.isFinite(frame.frequency) &&
      frame.frequency > 0,
  );

  if (voicedFrames.length === 0) {
    return {
      stabilityCents: 1000,
      durationSec,
    };
  }

  const frequencies = voicedFrames.map(
    frame => frame.frequency,
  );

  // Find the central pitch.
  const medianFrequency = median(frequencies);

  if (
    !Number.isFinite(medianFrequency) ||
    medianFrequency <= 0
  ) {
    return {
      stabilityCents: 1000,
      durationSec,
    };
  }

  // Remove obvious pitch-detection outliers.
  const stableFrequencies = frequencies.filter(
    frequency => {
      const relativeDeviation =
        Math.abs(frequency - medianFrequency) /
        medianFrequency;

      return relativeDeviation <= 0.08;
    },
  );

  if (stableFrequencies.length === 0) {
    return {
      stabilityCents: 1000,
      durationSec,
    };
  }

  // Use the central portion of the remaining pitch values
  // to reduce the influence of extreme pitch detections.
  const sortedStable = [...stableFrequencies].sort(
    (a, b) => a - b,
  );

  const trimCount = Math.floor(
    sortedStable.length * 0.10,
  );

  const trimmedFrequencies =
    sortedStable.length - trimCount * 2 >= 3
      ? sortedStable.slice(
          trimCount,
          sortedStable.length - trimCount,
        )
      : sortedStable;

  // Use the median of the remaining pitch values
  // as the reference pitch.
  const referenceFrequency = median(
    trimmedFrequencies,
  );

  // Calculate mean absolute pitch deviation in cents.
  const centsDeviations = trimmedFrequencies.map(
    frequency =>
      Math.abs(
        1200 *
          Math.log2(
            frequency / referenceFrequency,
          ),
      ),
  );

  const stabilityCents =
    centsDeviations.reduce(
      (sum, value) => sum + value,
      0,
    ) / centsDeviations.length;

  return {
    stabilityCents: Number.isFinite(stabilityCents)
      ? stabilityCents
      : 1000,
    durationSec,
  };
}