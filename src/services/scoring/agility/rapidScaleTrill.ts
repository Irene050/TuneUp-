import type { RapidScaleTrillMeasurement } from '@/services/measurement/agility/rapidScaleTrill';
import { clamp } from '@/utils/math';

export type RapidScaleTrillScore = {
  overall: number;
  pitchScore: number;
  sequenceScore: number;
  transitionScore: number;
  speedScore: number;
  passed: boolean;
  repetitionScores: {
    repetition: number;
    score: number;
    components: { label: string; value: string }[];
  }[];
};

function calculateSpeedScore(
  notesPerSecond: number,
): number {
  if (
    !Number.isFinite(notesPerSecond) ||
    notesPerSecond <= 1
  ) {
    return 0;
  }

  if (notesPerSecond >= 5) {
    return 100;
  }

  return clamp(
    ((notesPerSecond - 1) / 4) * 100,
    0,
    100,
  );
}

export function scoreRapidScaleTrill(
  measurement: RapidScaleTrillMeasurement,
  accuracyThreshold = 70,
): RapidScaleTrillScore {
  const pitchScore = clamp(
    measurement.pitchAccuracy,
    0,
    100,
  );

  const sequenceScore = clamp(
    measurement.sequenceAccuracy,
    0,
    100,
  );

  const transitionScore = clamp(
    measurement.transitionAccuracy,
    0,
    100,
  );

  const speedScore = calculateSpeedScore(
    measurement.notesPerSecond,
  );

  const overall =
    pitchScore * 0.35 +
    sequenceScore * 0.3 +
    transitionScore * 0.2 +
    speedScore * 0.15;

  const roundedOverall =
    Math.round(overall * 100) / 100;

  const threshold = clamp(
    Number.isFinite(accuracyThreshold)
      ? accuracyThreshold
      : 70,
    0,
    100,
  );

  const passed =
    roundedOverall >= threshold &&
    pitchScore >= 60 &&
    sequenceScore >= 60;

  const repetitionCount = Math.max(
    1,
    measurement.repetitionCount,
  );
  const notesPerRepetition = Math.ceil(
    measurement.targetNotes.length / repetitionCount,
  );
  const repetitionScores = Array.from(
    { length: repetitionCount },
    (_, index) => {
      const start = index * notesPerRepetition;
      const targetNotes = measurement.targetNotes.slice(
        start,
        start + notesPerRepetition,
      );
      const detectedNotes = measurement.detectedNotes.slice(
        start,
        start + notesPerRepetition,
      );
      const comparedCount = Math.min(
        targetNotes.length,
        detectedNotes.length,
      );
      let correctNotes = 0;
      let totalSemitoneError = 0;

      for (let noteIndex = 0; noteIndex < comparedCount; noteIndex++) {
        const error = Math.abs(
          detectedNotes[noteIndex] - targetNotes[noteIndex],
        );
        totalSemitoneError += error;
        if (error <= 1) {
          correctNotes++;
        }
      }

      const repetitionPitchScore =
        comparedCount > 0
          ? clamp(
              100 -
                (totalSemitoneError / comparedCount) * 50,
              0,
              100,
            )
          : 0;
      const repetitionSequenceScore =
        targetNotes.length > 0
          ? (correctNotes / targetNotes.length) * 100
          : 0;
      let correctTransitions = 0;

      for (
        let noteIndex = 1;
        noteIndex < comparedCount;
        noteIndex++
      ) {
        const detectedInterval =
          detectedNotes[noteIndex] -
          detectedNotes[noteIndex - 1];
        const targetInterval =
          targetNotes[noteIndex] -
          targetNotes[noteIndex - 1];
        if (Math.abs(detectedInterval - targetInterval) <= 1) {
          correctTransitions++;
        }
      }

      const targetTransitionCount = Math.max(
        0,
        targetNotes.length - 1,
      );
      const repetitionTransitionScore =
        targetTransitionCount > 0
          ? (correctTransitions / targetTransitionCount) * 100
          : 0;
      const repetitionDurationSeconds =
        measurement.durationMs / repetitionCount / 1000;
      const repetitionSpeedScore = calculateSpeedScore(
        repetitionDurationSeconds > 0
          ? detectedNotes.length / repetitionDurationSeconds
          : 0,
      );
      const repetitionOverall =
        repetitionPitchScore * 0.35 +
        repetitionSequenceScore * 0.3 +
        repetitionTransitionScore * 0.2 +
        repetitionSpeedScore * 0.15;

      return {
        repetition: index + 1,
        score: Math.round(repetitionOverall),
        components: [
          {
            label: 'Pitch accuracy',
            value: `${Math.round(repetitionPitchScore)}%`,
          },
          {
            label: 'Sequence accuracy',
            value: `${Math.round(repetitionSequenceScore)}%`,
          },
          {
            label: 'Transition accuracy',
            value: `${Math.round(repetitionTransitionScore)}%`,
          },
          {
            label: 'Speed',
            value: `${Math.round(repetitionSpeedScore)}%`,
          },
        ],
      };
    },
  );

  return {
    overall: roundedOverall,
    pitchScore,
    sequenceScore,
    transitionScore,
    speedScore,
    passed,
    repetitionScores,
  };
}
