// src/services/adaptiveDifficultyScaling/adaptiveDifficultyScaling.ts

export interface ParameterBounds {
  min: number;
  max: number;
}

export type Tier = 'beginner' | 'intermediate' | 'advanced';

export type DifficultyDirection = 'higher' | 'lower';

/**
 * Fixed tier progression requirements.
 * These are independent of continuous ADS adjustment.
 */
export const TIER_PROGRESSION_REQUIREMENTS = {
  beginnerToIntermediate: {
    minExercises: 20,
    minAccuracyPct: 75,
    minTemplatesCovered: 4,
    minPerTemplate: 3,
  },

  intermediateToAdvanced: {
    minExercises: 30,
    minAccuracyPct: 90,
    minTemplatesCovered: 5,
    minPerTemplate: 4,
  },
};

export const ADS_BASELINE_PCT = 75;

/**
 * Determines the reference score used for continuous ADS.
 *
 * Only completed exercise history is used.
 * Assessment results are not used as a continuous ADS fallback.
 */
export function getReferenceValue(
  recentScores: number[],
): number | null {
  if (recentScores.length === 0) {
    return null;
  }

  const lastFive = recentScores.slice(-5);

  return (
    lastFive.reduce((sum, score) => sum + score, 0) /
    lastFive.length
  );
}

/**
 * Normalizes the reference score around the 75% baseline.
 *
 * R < 75:
 *   d = (R - 75) / 75
 *
 * R >= 75:
 *   d = (R - 75) / 25
 *
 * Result is constrained to [-1, 1].
 */
export function calculateNormalizedDeviation(
  referenceValue: number,
): number {
  const deviation =
    referenceValue < ADS_BASELINE_PCT
      ? (referenceValue - ADS_BASELINE_PCT) / ADS_BASELINE_PCT
      : (referenceValue - ADS_BASELINE_PCT) /
        (100 - ADS_BASELINE_PCT);

  return clamp(deviation, -1, 1);
}

/**
 * Adjusts a parameter range according to the user's recent performance.
 *
 * Higher:
 *   Larger values represent greater difficulty.
 *
 * Lower:
 *   Smaller values represent greater difficulty.
 *
 * S = (P_hard - P_easy) × d × 0.5
 *
 * The shift is applied toward the harder/easier direction and
 * each endpoint is clamped to the current tier's original bounds.
 */
export function biasParameterBounds(
  baseBounds: ParameterBounds,
  referenceValue: number,
  difficultyDirection: DifficultyDirection,
): ParameterBounds {
  const range = baseBounds.max - baseBounds.min;

  if (range <= 0) {
    return {
      min: baseBounds.min,
      max: baseBounds.max,
    };
  }

  const deviation =
    calculateNormalizedDeviation(referenceValue);

  const shiftAmount = range * deviation * 0.5;

  const signedShift =
    difficultyDirection === 'higher'
      ? shiftAmount
      : -shiftAmount;

  const adjustedMin = clamp(
    baseBounds.min + signedShift,
    baseBounds.min,
    baseBounds.max,
  );

  const adjustedMax = clamp(
    baseBounds.max + signedShift,
    baseBounds.min,
    baseBounds.max,
  );

  return {
    min: Math.min(adjustedMin, adjustedMax),
    max: Math.max(adjustedMin, adjustedMax),
  };
}

/**
 * Complete continuous ADS calculation.
 *
 * When there is no exercise history, the tier's default parameter
 * range is returned unchanged.
 */
export function calculateAdjustedParameterBounds(
  recentScores: number[],
  baseBounds: ParameterBounds,
  difficultyDirection: DifficultyDirection,
): ParameterBounds {
  const referenceValue = getReferenceValue(recentScores);

  if (referenceValue === null) {
    return {
      min: baseBounds.min,
      max: baseBounds.max,
    };
  }

  return biasParameterBounds(
    baseBounds,
    referenceValue,
    difficultyDirection,
  );
}

/**
 * Checks whether a component qualifies to unlock the next tier.
 *
 * This function does not perform continuous parameter adjustment.
 */
export function checkTierProgression(
  currentTier: Tier,
  exerciseHistory: {
    templateId: string;
    scorePct: number;
  }[],
): {
  canUnlock: boolean;
  nextTier: Tier | null;
} {
  if (currentTier === 'advanced') {
    return {
      canUnlock: false,
      nextTier: null,
    };
  }

  const requirements =
    currentTier === 'beginner'
      ? TIER_PROGRESSION_REQUIREMENTS.beginnerToIntermediate
      : TIER_PROGRESSION_REQUIREMENTS.intermediateToAdvanced;

  const qualifying = exerciseHistory.filter(
    (exercise) =>
      exercise.scorePct >= requirements.minAccuracyPct,
  );

  const templatesCovered = new Set(
    qualifying.map((exercise) => exercise.templateId),
  );

  const perTemplateCounts = new Map<string, number>();

  for (const exercise of qualifying) {
    perTemplateCounts.set(
      exercise.templateId,
      (perTemplateCounts.get(exercise.templateId) ?? 0) + 1,
    );
  }

  const templatesWithMinimum = [
    ...perTemplateCounts.values(),
  ].filter(
    (count) => count >= requirements.minPerTemplate,
  ).length;

  const canUnlock =
    qualifying.length >= requirements.minExercises &&
    templatesCovered.size >= requirements.minTemplatesCovered &&
    templatesWithMinimum >= requirements.minTemplatesCovered;

  return {
    canUnlock,
    nextTier: canUnlock
      ? currentTier === 'beginner'
        ? 'intermediate'
        : 'advanced'
      : null,
  };
}

function clamp(
  value: number,
  min: number,
  max: number,
): number {
  return Math.max(min, Math.min(max, value));
}