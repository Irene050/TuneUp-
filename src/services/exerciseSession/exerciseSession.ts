// ============================================================
// EXERCISE SESSION MANAGER
// ============================================================

import type {
    ParameterBoundsMap,
    Tier,
} from '@/services/adaptiveDifficultyScaling/adaptiveDifficultyScaling';


// ============================================================
// VOCAL RANGE
// ============================================================

export interface VocalRange {
  lowHz: number;
  highHz: number;
}


// ============================================================
// EXERCISE INSTANCE
// ============================================================

export interface ExerciseInstance {
  templateId: string;
  componentId: string;
  tier: Tier;
  params: Record<string, unknown>;
}


// ============================================================
// EXERCISE TEMPLATE DEFINITION
// ============================================================

export interface ExerciseTemplateDefinition {
  templateId: string;

  componentId: string;

  /**
   * Whether this template contains a discrete
   * set of required elements.
   */
  hasDiscreteSet: boolean;

  /**
   * Number of instances generated for a normal
   * randomized template.
   */
  defaultInstanceCount: number;

  /**
   * Generates one exercise instance.
   *
   * vocalRange is available for Pitch, Tone,
   * Volume, and Agility exercises.
   *
   * Breath Control templates can simply ignore it.
   *
   * biasedBounds contains ADS-adjusted parameters.
   *
   * discreteIndex is used by templates that need
   * deterministic coverage of a fixed set.
   */
  generateParams: (
    tier: Tier,
    vocalRange: VocalRange,
    biasedBounds?: ParameterBoundsMap,
    discreteIndex?: number
  ) => Record<string, unknown>;

  /**
   * Number of required discrete elements.
   */
  discreteSetSize?: (
    tier: Tier
  ) => number;
}


// ============================================================
// SESSION SIZE
// ============================================================

export const MAX_SESSION_SIZE = 10;


// ============================================================
// BUILD EXERCISE QUEUE
// ============================================================

export function buildExerciseQueue(
  templates: ExerciseTemplateDefinition[],
  tier: Tier,
  vocalRange: VocalRange,
  biasedBoundsByTemplate:
    Record<
      string,
      ParameterBoundsMap
    > = {}
): ExerciseInstance[] {
  const requiredInstances:
    ExerciseInstance[] = [];

  const optionalInstances:
    ExerciseInstance[] = [];

  for (
    const template of templates
  ) {
    const biasedBounds =
      biasedBoundsByTemplate[
        template.templateId
      ];

    // --------------------------------------------------------
    // DISCRETE TEMPLATE
    // --------------------------------------------------------

    if (
      template.hasDiscreteSet &&
      template.discreteSetSize
    ) {
      const requiredCount =
        template.discreteSetSize(
          tier
        );

      for (
        let index = 0;
        index < requiredCount;
        index++
      ) {
        requiredInstances.push({
          templateId:
            template.templateId,

          componentId:
            template.componentId,

          tier,

          params:
            template.generateParams(
              tier,
              vocalRange,
              biasedBounds,
              index
            ),
        });
      }

      continue;
    }

    // --------------------------------------------------------
    // NORMAL TEMPLATE
    // --------------------------------------------------------

    for (
      let index = 0;
      index <
      template.defaultInstanceCount;
      index++
    ) {
      optionalInstances.push({
        templateId:
          template.templateId,

        componentId:
          template.componentId,

        tier,

        params:
          template.generateParams(
            tier,
            vocalRange,
            biasedBounds
          ),
      });
    }
  }

  // ----------------------------------------------------------
  // RANDOMIZE OPTIONAL INSTANCES
  // ----------------------------------------------------------

  const shuffledOptional =
    shuffle(
      optionalInstances
    );

  // ----------------------------------------------------------
  // REQUIRED INSTANCES GET PRIORITY
  // ----------------------------------------------------------

  const remainingSlots =
    Math.max(
      0,
      MAX_SESSION_SIZE -
        requiredInstances.length
    );

  const selectedOptional =
    shuffledOptional.slice(
      0,
      remainingSlots
    );

  // ----------------------------------------------------------
  // SHUFFLE FINAL SESSION
  // ----------------------------------------------------------

  return shuffle([
    ...requiredInstances,
    ...selectedOptional,
  ]).slice(
    0,
    MAX_SESSION_SIZE
  );
}


// ============================================================
// SHUFFLE
// ============================================================

function shuffle<T>(
  array: T[]
): T[] {
  const result = [
    ...array,
  ];

  for (
    let i =
      result.length - 1;
    i > 0;
    i--
  ) {
    const j =
      Math.floor(
        Math.random() *
          (i + 1)
      );

    [
      result[i],
      result[j],
    ] = [
      result[j],
      result[i],
    ];
  }

  return result;
}