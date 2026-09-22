import {
    filterByClarity,
    trackPitchOverTime,
} from '@/utils/dsp/pitch';

export interface MelodicPatternMeasurement {
  detectedFreqs: number[];
  noteTimestamps: number[];
}

export function measureMelodicPatternMatching(
  noteSegments: Float32Array[],
  sampleRate: number,
  segmentStartTimes: number[],
  minClarity = 0.7
): MelodicPatternMeasurement {
  const detectedFreqs: number[] = [];
  const noteTimestamps: number[] = [];

  noteSegments.forEach((segment, index) => {
    const frames = filterByClarity(
      trackPitchOverTime(
        segment,
        30,
        sampleRate
      ),
      minClarity
    ).filter(
      (frame) =>
        Number.isFinite(frame.frequency) &&
        frame.frequency > 0
    );

    if (frames.length === 0) {
      detectedFreqs.push(0);
      noteTimestamps.push(
        segmentStartTimes[index] ?? 0
      );
      return;
    }

    const averageFrequency =
      frames.reduce(
        (sum, frame) =>
          sum + frame.frequency,
        0
      ) / frames.length;

    detectedFreqs.push(
      averageFrequency
    );

    const firstVoicedFrame =
      frames[0];

    noteTimestamps.push(
      (segmentStartTimes[index] ?? 0) +
        firstVoicedFrame.timestamp
    );
  });

  return {
    detectedFreqs,
    noteTimestamps,
  };
}