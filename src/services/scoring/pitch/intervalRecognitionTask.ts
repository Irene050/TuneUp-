import {
    INTERVAL_RECOGNITION_PARAMS,
    Tier,
} from '@/constants/exercises/pitch';

import {
    IntervalRecognitionMeasurement,
} from '@/services/measurement/pitch/intervalRecognitionTask';

export interface IntervalRecognitionScoreResult {
  score: number;
  passed: boolean;

  targetRatio: number;
  detectedRatio: number;

  deviationPct: number;

  intervalName: string;

  freq1: number;
  freq2: number;

  firstNoteDetected: boolean;
  secondNoteDetected: boolean;

  firstNoteClarity: number;
  secondNoteClarity: number;
}

export function scoreIntervalRecognitionTask(
  measurement: IntervalRecognitionMeasurement,
  targetRatio: number,
  intervalName: string,
  tier: Tier
): IntervalRecognitionScoreResult {
  const params =
    INTERVAL_RECOGNITION_PARAMS[tier];

  if (
    !Number.isFinite(targetRatio) ||
    targetRatio <= 0
  ) {
    return {
      score: 0,
      passed: false,
      targetRatio,
      detectedRatio: 0,
      deviationPct: 100,
      intervalName,
      freq1: measurement.freq1,
      freq2: measurement.freq2,
      firstNoteDetected:
        measurement.hasFirstNote,
      secondNoteDetected:
        measurement.hasSecondNote,
      firstNoteClarity:
        measurement.firstNoteClarity,
      secondNoteClarity:
        measurement.secondNoteClarity,
    };
  }

  if (
    !measurement.hasFirstNote ||
    !measurement.hasSecondNote ||
    !Number.isFinite(
      measurement.detectedRatio
    ) ||
    measurement.detectedRatio <= 0
  ) {
    return {
      score: 0,
      passed: false,
      targetRatio,
      detectedRatio:
        measurement.detectedRatio,
      deviationPct: 100,
      intervalName,
      freq1: measurement.freq1,
      freq2: measurement.freq2,
      firstNoteDetected:
        measurement.hasFirstNote,
      secondNoteDetected:
        measurement.hasSecondNote,
      firstNoteClarity:
        measurement.firstNoteClarity,
      secondNoteClarity:
        measurement.secondNoteClarity,
    };
  }

  const deviation =
    Math.abs(
      measurement.detectedRatio -
        targetRatio
    ) / targetRatio;

  const deviationPct =
    deviation * 100;

  const score = Math.round(
    Math.max(
      0,
      Math.min(
        100,
        100 -
          deviationPct
      )
    )
  );

  const passed =
    deviationPct <=
    params.tolerancePct;

  return {
    score,
    passed,

    targetRatio,

    detectedRatio:
      measurement.detectedRatio,

    deviationPct,

    intervalName,

    freq1:
      measurement.freq1,

    freq2:
      measurement.freq2,

    firstNoteDetected:
      measurement.hasFirstNote,

    secondNoteDetected:
      measurement.hasSecondNote,

    firstNoteClarity:
      measurement.firstNoteClarity,

    secondNoteClarity:
      measurement.secondNoteClarity,
  };
}