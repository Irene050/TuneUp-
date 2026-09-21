import type {
    VolumeControlStabilityMeasurement,
} from '@/services/measurement/volume/volumeControlStability';

/* =========================================================
   SCORE RESULT
   ========================================================= */

export interface VolumeControlStabilityScore {
  overallScore: number;
  stabilityScore: number;
  durationScore: number;
  passed: boolean;
  hasAudio: boolean;
  feedback: string;
}

/* =========================================================
   FIXED BEGINNER TARGET
   ========================================================= */

const TARGET_STABILITY = 70;

/*
 * Minimum amount of detected voice required before
 * the exercise can be considered valid.
 */
const MIN_VOICED_COVERAGE = 20;

/* =========================================================
   CLAMP
   ========================================================= */

function clamp(
  value: number,
  min = 0,
  max = 100
): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(
    min,
    Math.min(max, value)
  );
}

/* =========================================================
   SCORE VOLUME CONTROL STABILITY
   ========================================================= */

export function scoreVolumeControlStability(
  measurement: VolumeControlStabilityMeasurement
): VolumeControlStabilityScore {
  /* =======================================================
     MEASURED VALUES
     ======================================================= */

  const stabilityScore = clamp(
    measurement.stability
  );

  const durationScore = clamp(
    measurement.durationScore
  );

  const voicedCoverage = clamp(
    measurement.voicedCoveragePercent
  );

  /* =======================================================
     AUDIO VALIDATION
     ======================================================= */

  /*
   * The recording must contain an actual usable
   * vocal signal.
   *
   * This prevents silence/background noise from
   * receiving a passing result.
   */

  const hasAudio =
    Number.isFinite(
      measurement.averageDb
    ) &&
    measurement.averageDb > 0 &&
    voicedCoverage > 0;

  /* =======================================================
     OVERALL SCORE
     
     Score =
     (stability × 0.7)
     +
     (duration score × 0.3)
     ======================================================= */

  const overallScore = clamp(
    stabilityScore * 0.7 +
      durationScore * 0.3
  );

  /* =======================================================
     PASS CONDITION
     ======================================================= */

  const passed =
    hasAudio &&
    voicedCoverage >=
      MIN_VOICED_COVERAGE &&
    overallScore >=
      TARGET_STABILITY;

  /* =======================================================
     FEEDBACK
     ======================================================= */

  let feedback: string;

  if (!hasAudio) {
    feedback =
      'A consistent vocal signal was not detected. Try singing C4 steadily and holding the same volume.';
  } else if (
    overallScore >= 85
  ) {
    feedback =
      'Excellent volume control. Your vocal volume remained very stable.';
  } else if (
    overallScore >= TARGET_STABILITY
  ) {
    feedback =
      'Good volume control. Continue practicing a steady vocal output.';
  } else {
    feedback =
      'Your volume fluctuated during the exercise. Focus on consistent breath support and vocal output.';
  }

  /* =======================================================
     RETURN RESULT
     ======================================================= */

  return {
    overallScore,
    stabilityScore,
    durationScore,
    passed,
    hasAudio,
    feedback,
  };
}