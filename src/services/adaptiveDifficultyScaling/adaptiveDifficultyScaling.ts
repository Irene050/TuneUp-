// ============================================================
// ADAPTIVE DIFFICULTY SCALING
// ============================================================

export interface ParameterBounds {
  min: number;
  max: number;
}

/**
 * A collection of adjustable parameter bounds for one exercise.
 *
 * Example:
 *
 * {
 *   durationSec: {
 *     min: 10,
 *     max: 12,
 *   },
 * }
 */
export type ParameterBoundsMap = Record<
  string,
  ParameterBounds
>;

export type Tier =
  | 'beginner'
  | 'intermediate'
  | 'advanced';


// ============================================================
// TIER PROGRESSION REQUIREMENTS
// ============================================================

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


// ============================================================
// REFERENCE PERFORMANCE
// ============================================================

export function getReferenceValue(
  recentScores: number[],
  assessmentScoreForComponent: number
): number {
  if (recentScores.length === 0) {
    return assessmentScoreForComponent;
  }

  const lastFive =
    recentScores.slice(-5);

  return (
    lastFive.reduce(
      (sum, score) =>
        sum + score,
      0
    ) /
    lastFive.length
  );
}


// ============================================================
// PARAMETER BIASING
// ============================================================

/**
 * Applies the ADS formula:
 *
 * d = (R - 67) / 100
 *
 * S = (Pmax - Pmin) * d * 0.5
 *
 * The resulting bounds are clamped to
 * the original tier limits.
 */
export function biasParameterBounds(
  baseBounds: ParameterBounds,
  referenceValue: number,
  tierBaselinePct = 67
): ParameterBounds {
  const range =
    baseBounds.max -
    baseBounds.min;

  const deviation =
    (referenceValue -
      tierBaselinePct) /
    100;

  const shiftAmount =
    range *
    deviation *
    0.5;

  const biasedMin =
    clamp(
      baseBounds.min +
        shiftAmount,
      baseBounds.min,
      baseBounds.max
    );

  const biasedMax =
    clamp(
      baseBounds.max +
        shiftAmount,
      baseBounds.min,
      baseBounds.max
    );

  return {
    min: Math.min(
      biasedMin,
      biasedMax
    ),

    max: Math.max(
      biasedMin,
      biasedMax
    ),
  };
}


// ============================================================
// MULTIPLE PARAMETER BOUNDS
// ============================================================

export function biasParameterBoundsMap(
  baseBounds: ParameterBoundsMap,
  referenceValue: number,
  tierBaselinePct = 67
): ParameterBoundsMap {
  const result: ParameterBoundsMap =
    {};

  for (
    const [
      parameterName,
      bounds,
    ] of Object.entries(baseBounds)
  ) {
    result[parameterName] =
      biasParameterBounds(
        bounds,
        referenceValue,
        tierBaselinePct
      );
  }

  return result;
}


// ============================================================
// COMPLETE ADS CALCULATION
// ============================================================

export function calculateAdjustedParameterBounds(
  recentScores: number[],
  assessmentScoreForComponent: number,
  baseBounds: ParameterBounds
): ParameterBounds {
  const referenceValue =
    getReferenceValue(
      recentScores,
      assessmentScoreForComponent
    );

  return biasParameterBounds(
    baseBounds,
    referenceValue
  );
}


export function calculateAdjustedParameterBoundsMap(
  recentScores: number[],
  assessmentScoreForComponent: number,
  baseBounds: ParameterBoundsMap
): ParameterBoundsMap {
  const referenceValue =
    getReferenceValue(
      recentScores,
      assessmentScoreForComponent
    );

  return biasParameterBoundsMap(
    baseBounds,
    referenceValue
  );
}


// ============================================================
// TIER PROGRESSION
// ============================================================

export interface TierProgressionHistoryEntry {
  templateId: string;
  scorePct: number;
  tier: Tier;
}

export function checkTierProgression(
  currentTier: Tier,
  exerciseHistory: TierProgressionHistoryEntry[]
): {
  canUnlock: boolean;
  nextTier: Tier | null;
} {
  if (
    currentTier ===
    'advanced'
  ) {
    return {
      canUnlock: false,
      nextTier: null,
    };
  }

  const requirements =
    currentTier ===
    'beginner'
      ? TIER_PROGRESSION_REQUIREMENTS
          .beginnerToIntermediate
      : TIER_PROGRESSION_REQUIREMENTS
          .intermediateToAdvanced;

  /*
   * Only exercises completed
   * during the CURRENT tier count
   * toward progression.
   */
  const currentTierHistory =
    exerciseHistory.filter(
      (exercise) =>
        exercise.tier ===
        currentTier
    );

  const qualifying =
    currentTierHistory.filter(
      (exercise) =>
        exercise.scorePct >=
        requirements.minAccuracyPct
    );

  const templatesCovered =
    new Set(
      qualifying.map(
        (exercise) =>
          exercise.templateId
      )
    );

  const perTemplateCounts =
    new Map<
      string,
      number
    >();

  for (
    const exercise of qualifying
  ) {
    perTemplateCounts.set(
      exercise.templateId,
      (
        perTemplateCounts.get(
          exercise.templateId
        ) ?? 0
      ) + 1
    );
  }

  const templatesWithMinimum =
    [
      ...perTemplateCounts.values(),
    ].filter(
      (count) =>
        count >=
        requirements.minPerTemplate
    ).length;

  const canUnlock =
    qualifying.length >=
      requirements.minExercises &&
    templatesCovered.size >=
      requirements.minTemplatesCovered &&
    templatesWithMinimum >=
      requirements.minTemplatesCovered;

  return {
    canUnlock,

    nextTier:
      canUnlock
        ? currentTier ===
          'beginner'
          ? 'intermediate'
          : 'advanced'
        : null,
  };
}


// ============================================================
// HELPER
// ============================================================

function clamp(
  value: number,
  min: number,
  max: number
): number {
  return Math.max(
    min,
    Math.min(
      max,
      value
    )
  );
}