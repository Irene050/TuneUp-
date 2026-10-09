import {
  filterByClarity,
  trackPitchOverTime,
} from '@/utils/dsp/pitch';

export interface MelodicPatternMeasurement {
  detectedFreqs: number[];
  noteTimestamps: number[];
  segmentFrequencies: number[][];
}

export function measureMelodicPatternMatching(
  noteSegments: Float32Array[],
  sampleRate: number,
  segmentStartTimes: number[],
  minClarity = 0.7,
): MelodicPatternMeasurement {
  const detectedFreqs: number[] = [];
  const noteTimestamps: number[] = [];
  const segmentFrequencies: number[][] = [];

  noteSegments.forEach((segment, index) => {
    const frames = filterByClarity(
      trackPitchOverTime(
        segment,
        30,
        sampleRate,
      ),
      minClarity,
    ).filter(
      frame =>
        Number.isFinite(frame.frequency) &&
        frame.frequency > 0,
    );

    if (frames.length === 0) {
      detectedFreqs.push(0);

      noteTimestamps.push(
        segmentStartTimes[index] ?? 0,
      );

      segmentFrequencies.push([]);

      return;
    }

    const frequencies = frames.map(
      frame => frame.frequency,
    );

    segmentFrequencies.push(
      frequencies,
    );

    /*
     * Keep the average frequency for the
     * existing result/display fields.
     *
     * The scorer uses segmentFrequencies
     * for actual pitch scoring.
     */
    const averageFrequency =
      frequencies.reduce(
        (sum, frequency) =>
          sum + frequency,
        0,
      ) / frequencies.length;

    detectedFreqs.push(
      averageFrequency,
    );

    const firstVoicedFrame =
      frames[0];

    noteTimestamps.push(
      (segmentStartTimes[index] ?? 0) +
        firstVoicedFrame.timestamp,
    );
  });

  return {
    detectedFreqs,
    noteTimestamps,
    segmentFrequencies,
  };
}