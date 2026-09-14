// src/services/measurement/pitch/scaleAccuracyDrill.ts

import {
    calcTransitionSmoothness,
    filterByClarity,
    trackPitchOverTime,
} from '@/utils/dsp/pitch';

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
  console.log(
    '🎼 SCALE MEASUREMENT START:',
    {
      segments: noteSegments.length,
      targets: targetFreqs.length,
      sampleRate,
      minClarity,
    }
  );

  const detectedFreqs: number[] = [];
  const clarityValues: number[] = [];

  for (
    let index = 0;
    index < noteSegments.length;
    index++
  ) {
    const segment =
      noteSegments[index];

    console.log(
      `🎵 ANALYZING SEGMENT ${index + 1}:`,
      {
        length: segment.length,
        duration:
          sampleRate > 0
            ? segment.length / sampleRate
            : 0,
      }
    );

    if (
      !segment ||
      segment.length === 0
    ) {
      console.warn(
        `⚠️ SEGMENT ${index + 1} IS EMPTY`
      );

      detectedFreqs.push(0);
      continue;
    }

    let frames;

    try {
      frames =
        trackPitchOverTime(
          segment,
          30,
          sampleRate
        );
    } catch (error) {
      console.error(
        `❌ trackPitchOverTime FAILED ON SEGMENT ${index + 1}:`,
        error
      );

      detectedFreqs.push(0);
      continue;
    }

    console.log(
      `🔎 SEGMENT ${index + 1} FRAMES:`,
      frames?.length
    );

    if (!Array.isArray(frames)) {
      console.error(
        `❌ trackPitchOverTime DID NOT RETURN AN ARRAY`
      );

      detectedFreqs.push(0);
      continue;
    }

    let voicedFrames;

    try {
      voicedFrames =
        filterByClarity(
          frames,
          minClarity
        );
    } catch (error) {
      console.error(
        `❌ filterByClarity FAILED ON SEGMENT ${index + 1}:`,
        error
      );

      detectedFreqs.push(0);
      continue;
    }

    console.log(
      `🎤 SEGMENT ${index + 1} VOICED FRAMES:`,
      voicedFrames?.length
    );

    if (
      !Array.isArray(voicedFrames) ||
      voicedFrames.length === 0
    ) {
      detectedFreqs.push(0);
      continue;
    }

    const validFrequencies =
      voicedFrames
        .map(
          frame =>
            frame.frequency
        )
        .filter(
          frequency =>
            Number.isFinite(
              frequency
            ) &&
            frequency > 0
        );

    if (
      validFrequencies.length === 0
    ) {
      detectedFreqs.push(0);
      continue;
    }

    /*
     * Median pitch is used so that a few
     * incorrect pitch frames do not heavily
     * affect the detected note.
     */
    const sorted =
      [...validFrequencies].sort(
        (a, b) => a - b
      );

    const middle =
      Math.floor(
        sorted.length / 2
      );

    const median =
      sorted.length % 2 === 0
        ? (
            sorted[middle - 1] +
            sorted[middle]
          ) / 2
        : sorted[middle];

    detectedFreqs.push(
      Number.isFinite(median)
        ? median
        : 0
    );

    for (
      const frame of voicedFrames
    ) {
      if (
        Number.isFinite(
          frame.clarity
        ) &&
        frame.clarity > 0
      ) {
        clarityValues.push(
          frame.clarity
        );
      }
    }
  }

  console.log(
    '🎼 DETECTED FREQUENCIES:',
    detectedFreqs
  );

  /*
   * Calculate transition smoothness.
   */
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
    console.error(
      '❌ TRANSITION SMOOTHNESS FAILED:',
      error
    );

    /*
     * A single-note or completely
     * undetected result should not crash
     * the entire exercise.
     */
    transitionSmoothness =
      detectedFreqs.length <= 1
        ? 100
        : 0;
  }

  const averageClarity =
    clarityValues.length > 0
      ? clarityValues.reduce(
          (sum, value) =>
            sum + value,
          0
        ) /
        clarityValues.length
      : 0;

  const voicedNotes =
    detectedFreqs.filter(
      frequency =>
        Number.isFinite(
          frequency
        ) &&
        frequency > 0
    ).length;

  console.log(
    '✅ SCALE MEASUREMENT COMPLETE:',
    {
      detectedFreqs,
      transitionSmoothness,
      averageClarity,
      voicedNotes,
    }
  );

  return {
    detectedFreqs,
    targetFreqs,
    transitionSmoothness,
    averageClarity,
    voicedNotes,
  };
}