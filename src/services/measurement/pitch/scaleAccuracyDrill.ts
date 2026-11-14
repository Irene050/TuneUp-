import {
  calcTransitionSmoothness,
  filterByClarity,
  trackPitchOverTime,
} from '@/utils/dsp/pitch';
import { average, median } from '@/utils/math';

export interface ScaleAccuracyMeasurement {
  detectedFreqs: number[];
  targetFreqs: number[];
  transitionSmoothness: number;
  averageClarity: number;
  voicedNotes: number;
}

export function measureScaleAccuracyDrill(
  noteSegments: Float32Array[],
  targetFreqs: number[],
  sampleRate: number,
  minClarity = 0.70
): ScaleAccuracyMeasurement {
  const detectedFreqs: number[] = [];
  const clarityValues: number[] = [];

  for (
    let index = 0;
    index < noteSegments.length;
    index++
  ) {
    const segment = noteSegments[index];

    if (!segment || segment.length === 0) {
      detectedFreqs.push(0);
      continue;
    }

    let frames;

    try {
      frames = trackPitchOverTime(
        segment,
        30,
        sampleRate
      );
    } catch (error) {
      detectedFreqs.push(0);
      continue;
    }

    if (!Array.isArray(frames)) {
      detectedFreqs.push(0);
      continue;
    }

    let voicedFrames;

    try {
      voicedFrames = filterByClarity(
        frames,
        minClarity
      );
    } catch (error) {
      detectedFreqs.push(0);
      continue;
    }

    if (
      !Array.isArray(voicedFrames) ||
      voicedFrames.length === 0
    ) {
      detectedFreqs.push(0);
      continue;
    }

    const validFrequencies = voicedFrames
      .map(frame => frame.frequency)
      .filter(
        frequency =>
          Number.isFinite(frequency) &&
          frequency > 0
      );

    if (validFrequencies.length === 0) {
      detectedFreqs.push(0);
      continue;
    }

    detectedFreqs.push(median(validFrequencies));

    for (const frame of voicedFrames) {
      if (
        Number.isFinite(frame.clarity) &&
        frame.clarity > 0
      ) {
        clarityValues.push(frame.clarity);
      }
    }
  }

  let transitionSmoothness = 0;

  try {
    if (
      typeof calcTransitionSmoothness !==
      'function'
    ) {
      throw new Error(
        'calcTransitionSmoothness is not available at runtime.'
      );
    }

    transitionSmoothness =
      calcTransitionSmoothness(
        detectedFreqs
      );
  } catch (error) {
    transitionSmoothness =
      detectedFreqs.length <= 1 ? 100 : 0;
  }

  transitionSmoothness = Number(
    transitionSmoothness.toFixed(1)
  );

  const averageClarity = average(clarityValues);

  const roundedAverageClarity = Number(
    averageClarity.toFixed(1)
  );

  const voicedNotes = detectedFreqs.filter(
    frequency =>
      Number.isFinite(frequency) &&
      frequency > 0
  ).length;

  return {
    detectedFreqs,
    targetFreqs,
    transitionSmoothness,
    averageClarity: roundedAverageClarity,
    voicedNotes,
  };
}