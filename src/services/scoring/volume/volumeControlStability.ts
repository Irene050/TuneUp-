import type {
  VolumeControlStabilityMeasurement,
} from '@/services/measurement/volume/volumeControlStability';

export interface VolumeControlStabilityScore {
  overallScore: number;
  stabilityScore: number;
  durationScore: number;
  passed: boolean;
  hasAudio: boolean;
  feedback: string;
}

const DEFAULT_TARGET_STABILITY = 70;
const MIN_VOICED_COVERAGE = 20;

export interface VolumeControlStabilityScoreOptions {
  passingScore?: number;
}

function clamp(
  value: number,
  min = 0,
  max = 100,
): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(
    min,
    Math.min(max, value),
  );
}

export function scoreVolumeControlStability(
  measurement: VolumeControlStabilityMeasurement,
  options: VolumeControlStabilityScoreOptions = {},
): VolumeControlStabilityScore {
  const targetStability = clamp(
    options.passingScore ?? DEFAULT_TARGET_STABILITY,
  );

  const stabilityScore = clamp(
    measurement.stability,
  );

  const durationScore = clamp(
    measurement.durationScore,
  );

  const voicedCoverage = clamp(
    measurement.voicedCoveragePercent,
  );

  const averageDb = measurement.averageDb;

  const hasAudio =
    Number.isFinite(averageDb) &&
    averageDb >= -60 &&
    averageDb <= 0 &&
    voicedCoverage > 0;

  const overallScore = clamp(
    stabilityScore * 0.7 +
    durationScore * 0.3,
  );

  const passed =
    hasAudio &&
    voicedCoverage >= MIN_VOICED_COVERAGE &&
    overallScore >= targetStability;

  let feedback: string;

  if (!hasAudio) {
    feedback =
      'No usable vocal signal was detected. Check your microphone and try singing C4 steadily at a comfortable volume.';
  } else if (
    voicedCoverage < MIN_VOICED_COVERAGE
  ) {
    feedback =
      'Not enough vocal audio was detected throughout the exercise. Try maintaining your voice for the full recording.';
  } else if (overallScore >= 85) {
    feedback =
      'Excellent volume control. Your vocal volume remained very stable.';
  } else if (overallScore >= targetStability) {
    feedback =
      'Good volume control. Continue practicing a steady vocal output.';
  } else {
    feedback =
      'Your volume fluctuated during the exercise. Focus on consistent breath support and vocal output.';
  }

  return {
    overallScore,
    stabilityScore,
    durationScore,
    passed,
    hasAudio,
    feedback,
  };
}