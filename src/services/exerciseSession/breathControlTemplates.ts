// ============================================================
// BREATH CONTROL EXERCISE TEMPLATES
// ============================================================

import type {
    ExerciseTemplateDefinition,
} from '@/services/exerciseSession/exerciseSession';

import {
    generateControlledBreathReleaseParams,
    generateDiaphragmaticBreathingParams,
    generateSteadyAirflowParams,
    generateSustainedExhaleParams,
    generateSustainedSSSSParams,
} from '@/services/exerciseSession/generateParams/breathControl';


// ============================================================
// BREATH CONTROL TEMPLATES
// ============================================================

export const BREATH_CONTROL_TEMPLATES:
  ExerciseTemplateDefinition[] = [

  // ----------------------------------------------------------
  // 1. SUSTAINED EXHALE
  // ----------------------------------------------------------

  {
    templateId:
      'sustainedExhale',

    componentId:
      'breathControl',

    hasDiscreteSet:
      false,

    defaultInstanceCount:
      2,

    generateParams: (
      tier,
      vocalRange,
      biasedBounds
    ) =>
      generateSustainedExhaleParams(
        tier,
        biasedBounds
      ),
  },


  // ----------------------------------------------------------
  // 2. SUSTAINED SSSS
  // ----------------------------------------------------------

  {
    templateId:
      'sustainedSSSS',

    componentId:
      'breathControl',

    hasDiscreteSet:
      false,

    defaultInstanceCount:
      2,

    generateParams: (
      tier,
      vocalRange,
      biasedBounds
    ) =>
      generateSustainedSSSSParams(
        tier,
        biasedBounds
      ),
  },


  // ----------------------------------------------------------
  // 3. DIAPHRAGMATIC BREATHING
  // ----------------------------------------------------------

  {
    templateId:
      'diaphragmaticBreathing',

    componentId:
      'breathControl',

    hasDiscreteSet:
      false,

    defaultInstanceCount:
      2,

    generateParams: (
      tier,
      vocalRange,
      biasedBounds
    ) =>
      generateDiaphragmaticBreathingParams(
        tier,
        biasedBounds
      ),
  },


  // ----------------------------------------------------------
  // 4. STEADY AIRFLOW
  // ----------------------------------------------------------

  {
    templateId:
      'steadyAirflow',

    componentId:
      'breathControl',

    hasDiscreteSet:
      false,

    defaultInstanceCount:
      2,

    generateParams: (
      tier,
      vocalRange,
      biasedBounds
    ) =>
      generateSteadyAirflowParams(
        tier,
        biasedBounds
      ),
  },


  // ----------------------------------------------------------
  // 5. CONTROLLED BREATH RELEASE
  // ----------------------------------------------------------

  {
    templateId:
      'controlledBreathRelease',

    componentId:
      'breathControl',

    hasDiscreteSet:
      false,

    defaultInstanceCount:
      2,

    generateParams: (
      tier,
      vocalRange,
      biasedBounds
    ) =>
      generateControlledBreathReleaseParams(
        tier,
        biasedBounds
      ),
  },
];