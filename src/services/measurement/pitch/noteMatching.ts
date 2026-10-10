import {
  filterByClarity,
  trackPitchOverTime,
} from '@/utils/dsp/pitch';

export interface NoteMatchingMeasurement {
  detectedFrequency: number;
  averageClarity: number;
  voicedFrames: number;
  totalFrames: number;
  frequencies: number[];
}

function calculateMedian(
  values: number[],
): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort(
    (a, b) => a - b,
  );

  const middle =
    Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (
      sorted[middle - 1] +
      sorted[middle]
    ) / 2;
  }

  return sorted[middle];
}

export function measureNoteMatching(
  samples: Float32Array,
  sampleRate: number,
  minClarity = 0.70,
): NoteMatchingMeasurement {
  if (
    samples.length === 0 ||
    sampleRate <= 0
  ) {
    return {
      detectedFrequency: 0,
      averageClarity: 0,
      voicedFrames: 0,
      totalFrames: 0,
      frequencies: [],
    };
  }

  // Analyze pitch across the complete recording.
  const frames =
    trackPitchOverTime(
      samples,
      30,
      sampleRate,
    );

  const totalFrames =
    frames.length;

  if (totalFrames === 0) {
    return {
      detectedFrequency: 0,
      averageClarity: 0,
      voicedFrames: 0,
      totalFrames: 0,
      frequencies: [],
    };
  }

  // Keep only reasonably reliable pitch frames.
  const voiced =
    filterByClarity(
      frames,
      minClarity,
    );

  const frequencies =
    voiced
      .map(
        frame => frame.frequency,
      )
      .filter(
        frequency =>
          Number.isFinite(
            frequency,
          ) &&
          frequency > 0,
      );

  if (frequencies.length === 0) {
    return {
      detectedFrequency: 0,
      averageClarity: 0,
      voicedFrames: 0,
      totalFrames,
      frequencies: [],
    };
  }

  const detectedFrequency =
    calculateMedian(
      frequencies,
    );

  const averageClarity =
    voiced.reduce(
      (sum, frame) =>
        sum + frame.clarity,
      0,
    ) / voiced.length;

  return {
    detectedFrequency,
    averageClarity,
    voicedFrames:
      frequencies.length,
    totalFrames,
    frequencies,
  };
}