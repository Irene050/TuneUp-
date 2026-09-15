import {
    MELODIC_PATTERN_MATCHING_PARAMS,
    Tier,
} from '@/constants/exercises/pitch';

import {
    MelodicPatternMeasurement,
} from '@/services/measurement/pitch/melodicPatternMatching';

import {
    calcPitchAccuracy,
} from '@/utils/dsp/pitch';

export interface MelodicPatternScoreResult {
  score: number;
  passed: boolean;

  noteAccuracies: number[];
  notesHit: boolean[];

  patternAccuracy: number;
  rhythmAccuracy: number;
}

export function scoreMelodicPatternMatching(
  measurement: MelodicPatternMeasurement,
  targetFreqs: number[],
  targetTimestamps: number[],
  tier: Tier
): MelodicPatternScoreResult {
  const params =
    MELODIC_PATTERN_MATCHING_PARAMS[tier];

  const noteCount = Math.min(
    targetFreqs.length,
    measurement.detectedFreqs.length
  );

  if (noteCount === 0) {
    return {
      score: 0,
      passed: false,
      noteAccuracies: [],
      notesHit: [],
      patternAccuracy: 0,
      rhythmAccuracy: 0,
    };
  }

  const noteAccuracies: number[] = [];
  const notesHit: boolean[] = [];

  for (let i = 0; i < noteCount; i++) {
    const detected =
      measurement.detectedFreqs[i];

    const target =
      targetFreqs[i];

    if (
      !Number.isFinite(detected) ||
      detected <= 0 ||
      !Number.isFinite(target) ||
      target <= 0
    ) {
      noteAccuracies.push(0);
      notesHit.push(false);
      continue;
    }

    const accuracy = Math.max(
      0,
      calcPitchAccuracy(
        detected,
        target
      )
    );

    const deviationPct =
      (Math.abs(
        detected - target
      ) /
        target) *
      100;

    noteAccuracies.push(accuracy);

    notesHit.push(
      deviationPct <=
        params.tolerancePct
    );
  }

  const patternAccuracy =
    noteAccuracies.reduce(
      (sum, accuracy) =>
        sum + accuracy,
      0
    ) / noteAccuracies.length;

  const hitCount =
    notesHit.filter(Boolean).length;

  /*
   * Timing is calculated from the detected
   * note start relative to the target start.
   *
   * A 250 ms timing window is used here so
   * small microphone / singing delays do not
   * immediately destroy the score.
   */
  const timingScores =
    targetTimestamps
      .slice(0, noteCount)
      .map((targetTime, index) => {
        const detectedTime =
          measurement.noteTimestamps[
            index
          ];

        if (
          !Number.isFinite(
            detectedTime
          )
        ) {
          return 0;
        }

        const differenceMs =
          Math.abs(
            detectedTime -
              targetTime
          ) * 1000;

        return Math.max(
          0,
          100 -
            (differenceMs /
              250) *
              100
        );
      });

  const rhythmAccuracy =
    timingScores.length > 0
      ? timingScores.reduce(
          (sum, value) =>
            sum + value,
          0
        ) / timingScores.length
      : 0;

  const score = Math.round(
    patternAccuracy * 0.7 +
      rhythmAccuracy * 0.3
  );

  const passed =
    hitCount / noteCount >=
    0.7;

  return {
    score,
    passed,
    noteAccuracies,
    notesHit,
    patternAccuracy,
    rhythmAccuracy,
  };
}