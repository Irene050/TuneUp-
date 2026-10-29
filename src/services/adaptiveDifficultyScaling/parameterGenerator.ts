import {
    CONTROLLED_BREATH_RELEASE_PARAMS,
    DIAPHRAGMATIC_BREATHING_PARAMS,
    STEADY_AIRFLOW_PARAMS,
    SUSTAINED_EXHALE_PARAMS,
    SUSTAINED_SSSS_PARAMS,
    type ControlledBreathReleaseParams,
    type DiaphragmaticBreathingParams,
    type SteadyAirflowParams,
    type SustainedExhaleParams,
    type Tier,
} from '@/constants/params';

import {
    INTERVAL_RECOGNITION_PARAMS,
    MELODIC_PATTERN_MATCHING_PARAMS,
    NOTE_MATCHING_PARAMS,
    SCALE_ACCURACY_PARAMS,
    SUSTAINED_NOTE_STABILITY_PARAMS,
    type IntervalRecognitionParams,
    type MelodicPatternMatchingParams,
    type NoteMatchingParams,
    type ScaleAccuracyParams,
    type SustainedNoteStabilityParams,
} from '@/constants/params';

import {
    FREQUENCY_ZONE_STABILITY_PARAMS,
    STEADY_TONE_HOLDING_PARAMS,
    TONE_CONSISTENCY_PARAMS,
    VOWEL_CONSISTENCY_PARAMS,
    WAVEFORM_SMOOTHNESS_PARAMS,
    type FrequencyZoneStabilityParams,
    type SteadyToneHoldingParams,
    type ToneConsistencyParams,
    type VowelConsistencyParams,
    type WaveformSmoothnessParams,
} from '@/constants/params';

import {
    CONTROLLED_CRESCENDO_PARAMS,
    CONTROLLED_DECRESCENDO_PARAMS,
    DYNAMIC_RANGE_PARAMS,
    VOLUME_BAND_TARGETING_PARAMS,
    VOLUME_CONTROL_STABILITY_PARAMS,
    type ControlledCrescendoParams,
    type ControlledDecrescendoParams,
    type DynamicRangeParams,
    type VolumeBandTargetingParams,
    type VolumeControlStabilityParams,
} from '@/constants/params';

import {
    ARPEGGIO_SPEED_DRILL_PARAMS,
    QUICK_INTERVAL_JUMP_PARAMS,
    RAPID_NOTE_TRANSITION_PARAMS,
    RAPID_SCALE_TRILL_PARAMS,
    VOCAL_RUN_ACCURACY_PARAMS,
} from '@/constants/params';

import {
    calculateAdjustedParameterBounds,
} from './adaptiveDifficultyScaling';


export interface GenerateSustainedExhaleParamsInput {
  tier: Tier;
  recentScores: number[];
}
export function generateSustainedExhaleParams({
  tier,
  recentScores,
}: GenerateSustainedExhaleParamsInput): SustainedExhaleParams {
  const baseParams =
    SUSTAINED_EXHALE_PARAMS[tier];

  const adjustedDuration =
    calculateAdjustedParameterBounds(
      recentScores,
      {
        min: baseParams.durationRangeSec[0],
        max: baseParams.durationRangeSec[1],
      },
      'higher',
    );

  return {
    ...baseParams,

    durationRangeSec: [
      adjustedDuration.min,
      adjustedDuration.max,
    ],
  };
}

export interface GenerateSustainedSSSSParamsInput {
  tier: Tier;
  recentScores: number[];
}
export function generateSustainedSSSSParams({
  tier,
  recentScores,
}: GenerateSustainedSSSSParamsInput): SustainedExhaleParams {
  const baseParams =
    SUSTAINED_SSSS_PARAMS[tier];

  const adjustedDuration =
    calculateAdjustedParameterBounds(
      recentScores,
      {
        min: baseParams.durationRangeSec[0],
        max: baseParams.durationRangeSec[1],
      },
      'higher',
    );

  return {
    ...baseParams,

    durationRangeSec: [
      adjustedDuration.min,
      adjustedDuration.max,
    ],
  };
}

export interface GenerateDiaphragmaticBreathingParamsInput {
  tier: Tier;
  recentScores: number[];
}
export function generateDiaphragmaticBreathingParams({
  tier,
  recentScores,
}: GenerateDiaphragmaticBreathingParamsInput): DiaphragmaticBreathingParams {
  const baseParams =
    DIAPHRAGMATIC_BREATHING_PARAMS[tier];

  const adaptiveRange = {
    min: baseParams.exhaleSec * 0.8,
    max: baseParams.exhaleSec * 1.2,
  };

  const adjustedExhale =
    calculateAdjustedParameterBounds(
      recentScores,
      adaptiveRange,
      'higher',
    );

  const generatedExhaleSec =
    (adjustedExhale.min +
      adjustedExhale.max) /
    2;

  return {
    ...baseParams,

    exhaleSec: Number(
      generatedExhaleSec.toFixed(2),
    ),
  };
}

export interface GenerateSteadyAirflowParamsInput {
  tier: Tier;
  recentScores: number[];
}
export function generateSteadyAirflowParams({
  tier,
  recentScores,
}: GenerateSteadyAirflowParamsInput): SteadyAirflowParams {
  const baseParams =
    STEADY_AIRFLOW_PARAMS[tier];

  const adaptiveRange = {
    min: baseParams.durationSec * 0.8,
    max: baseParams.durationSec * 1.2,
  };

  const adjustedDuration =
    calculateAdjustedParameterBounds(
      recentScores,
      adaptiveRange,
      'higher',
    );

  const generatedDurationSec =
    (adjustedDuration.min +
      adjustedDuration.max) /
    2;

  return {
    ...baseParams,

    durationSec: Number(
      generatedDurationSec.toFixed(2),
    ),
  };
}

export interface GenerateControlledBreathReleaseParamsInput {
  tier: Tier;
  recentScores: number[];
}
export function generateControlledBreathReleaseParams({
  tier,
  recentScores,
}: GenerateControlledBreathReleaseParamsInput): ControlledBreathReleaseParams {
  const baseParams =
    CONTROLLED_BREATH_RELEASE_PARAMS[tier];

  const pulseCountRange = {
    min: baseParams.pulseCount * 0.8,
    max: baseParams.pulseCount * 1.2,
  };

  const intervalRange = {
    min: baseParams.intervalSec * 0.8,
    max: baseParams.intervalSec * 1.2,
  };

  const adjustedPulseCount =
    calculateAdjustedParameterBounds(
      recentScores,
      pulseCountRange,
      'higher',
    );

  const adjustedInterval =
    calculateAdjustedParameterBounds(
      recentScores,
      intervalRange,
      'lower',
    );

  const generatedPulseCount =
    Math.round(
      (
        adjustedPulseCount.min +
        adjustedPulseCount.max
      ) / 2,
    );

  const generatedIntervalSec =
    (
      adjustedInterval.min +
      adjustedInterval.max
    ) / 2;

  return {
    ...baseParams,

    pulseCount: Math.max(
      1,
      generatedPulseCount,
    ),

    intervalSec: Number(
      generatedIntervalSec.toFixed(2),
    ),
  };
}

export interface GenerateNoteMatchingParamsInput {
  tier: Tier;
  recentScores: number[];
}
export function generateNoteMatchingParams({
  tier,
  recentScores,
}: GenerateNoteMatchingParamsInput): NoteMatchingParams {
  const baseParams =
    NOTE_MATCHING_PARAMS[tier];

  const toleranceRange = {
    min: baseParams.tolerancePct * 0.8,
    max: baseParams.tolerancePct * 1.2,
  };

  const clarityRange = {
    min: baseParams.minClarity * 0.8,
    max: baseParams.minClarity * 1.2,
  };

  const voicedFramesRange = {
    min: baseParams.minVoicedFrames * 0.8,
    max: baseParams.minVoicedFrames * 1.2,
  };

  const adjustedTolerance =
    calculateAdjustedParameterBounds(
      recentScores,
      toleranceRange,
      'lower',
    );

  const adjustedClarity =
    calculateAdjustedParameterBounds(
      recentScores,
      clarityRange,
      'higher',
    );

  const adjustedVoicedFrames =
    calculateAdjustedParameterBounds(
      recentScores,
      voicedFramesRange,
      'higher',
    );

  const generatedTolerancePct =
    (
      adjustedTolerance.min +
      adjustedTolerance.max
    ) / 2;

  const generatedMinClarity =
    (
      adjustedClarity.min +
      adjustedClarity.max
    ) / 2;

  const generatedMinVoicedFrames =
    Math.round(
      (
        adjustedVoicedFrames.min +
        adjustedVoicedFrames.max
      ) / 2,
    );

  return {
    ...baseParams,

    tolerancePct:
      Number(
        generatedTolerancePct.toFixed(2),
      ),

    minClarity:
      Number(
        generatedMinClarity.toFixed(2),
      ),

    minVoicedFrames:
      Math.max(
        1,
        generatedMinVoicedFrames,
      ),
  };
}

export interface GenerateScaleAccuracyParamsInput {
  tier: Tier;
  recentScores: number[];
}
export function generateScaleAccuracyParams({
  tier,
  recentScores,
}: GenerateScaleAccuracyParamsInput): ScaleAccuracyParams {
  const baseParams =
    SCALE_ACCURACY_PARAMS[tier];

  const toleranceRange = {
    min: baseParams.tolerancePct * 0.8,
    max: baseParams.tolerancePct * 1.2,
  };

  const clarityRange = {
    min: baseParams.minClarity * 0.8,
    max: baseParams.minClarity * 1.2,
  };

  const noteCountRange = {
    min: baseParams.noteCount * 0.8,
    max: baseParams.noteCount * 1.2,
  };

  const accuracyThresholdRange = {
    min:
      baseParams.scaleAccuracyThreshold *
      0.8,

    max:
      baseParams.scaleAccuracyThreshold *
      1.2,
  };

  const adjustedTolerance =
    calculateAdjustedParameterBounds(
      recentScores,
      toleranceRange,
      'lower',
    );

  const adjustedClarity =
    calculateAdjustedParameterBounds(
      recentScores,
      clarityRange,
      'higher',
    );

  const adjustedNoteCount =
    calculateAdjustedParameterBounds(
      recentScores,
      noteCountRange,
      'higher',
    );

  const adjustedAccuracyThreshold =
    calculateAdjustedParameterBounds(
      recentScores,
      accuracyThresholdRange,
      'higher',
    );

  const generatedTolerancePct =
    (
      adjustedTolerance.min +
      adjustedTolerance.max
    ) / 2;

  const generatedMinClarity =
    (
      adjustedClarity.min +
      adjustedClarity.max
    ) / 2;

  const generatedNoteCount =
    Math.round(
      (
        adjustedNoteCount.min +
        adjustedNoteCount.max
      ) / 2,
    );

  const generatedAccuracyThreshold =
    (
      adjustedAccuracyThreshold.min +
      adjustedAccuracyThreshold.max
    ) / 2;

  return {
    ...baseParams,

    tolerancePct:
      Number(
        generatedTolerancePct.toFixed(2),
      ),

    minClarity:
      Number(
        generatedMinClarity.toFixed(2),
      ),

    noteCount: generatedNoteCount,

    scaleAccuracyThreshold:
      Number(
        generatedAccuracyThreshold.toFixed(2),
      ),
  };
}

export interface GenerateSustainedNoteStabilityParamsInput {
  tier: Tier;
  recentScores: number[];
}
export function generateSustainedNoteStabilityParams({
  tier,
  recentScores,
}: GenerateSustainedNoteStabilityParamsInput): SustainedNoteStabilityParams {
  const baseParams =
    SUSTAINED_NOTE_STABILITY_PARAMS[tier];

  const durationRange = {
    min: baseParams.durationSec * 0.8,
    max: baseParams.durationSec * 1.2,
  };

  const stabilityThresholdRange = {
    min:
      baseParams.stabilityThresholdCents *
      0.8,

    max:
      baseParams.stabilityThresholdCents *
      1.2,
  };

  const clarityRange = {
    min: baseParams.minClarity * 0.8,
    max: baseParams.minClarity * 1.2,
  };

  const adjustedDuration =
    calculateAdjustedParameterBounds(
      recentScores,
      durationRange,
      'higher',
    );

  const adjustedStabilityThreshold =
    calculateAdjustedParameterBounds(
      recentScores,
      stabilityThresholdRange,
      'lower',
    );

  const adjustedClarity =
    calculateAdjustedParameterBounds(
      recentScores,
      clarityRange,
      'higher',
    );

  const generatedDurationSec =
    (
      adjustedDuration.min +
      adjustedDuration.max
    ) / 2;

  const generatedStabilityThresholdCents =
    (
      adjustedStabilityThreshold.min +
      adjustedStabilityThreshold.max
    ) / 2;

  const generatedMinClarity =
    (
      adjustedClarity.min +
      adjustedClarity.max
    ) / 2;

  return {
    ...baseParams,

    durationSec:
      Number(
        generatedDurationSec.toFixed(2),
      ),

    stabilityThresholdCents:
      Number(
        generatedStabilityThresholdCents.toFixed(2),
      ),

    minClarity:
      Number(
        generatedMinClarity.toFixed(2),
      ),
  };
}

export interface GenerateIntervalRecognitionParamsInput {
  tier: Tier;
  recentScores: number[];
}
export function generateIntervalRecognitionParams({
  tier,
  recentScores,
}: GenerateIntervalRecognitionParamsInput): IntervalRecognitionParams {
  const baseParams =
    INTERVAL_RECOGNITION_PARAMS[tier];

  const toleranceRange = {
    min: baseParams.tolerancePct * 0.8,
    max: baseParams.tolerancePct * 1.2,
  };

  const clarityRange = {
    min: baseParams.minClarity * 0.8,
    max: baseParams.minClarity * 1.2,
  };

  const durationRange = {
    min: baseParams.totalDurationSec * 0.8,
    max: baseParams.totalDurationSec * 1.2,
  };

  const adjustedTolerance =
    calculateAdjustedParameterBounds(
      recentScores,
      toleranceRange,
      'lower',
    );

  const adjustedClarity =
    calculateAdjustedParameterBounds(
      recentScores,
      clarityRange,
      'higher',
    );

  const adjustedDuration =
    calculateAdjustedParameterBounds(
      recentScores,
      durationRange,
      'lower',
    );

  const generatedTolerancePct =
    (
      adjustedTolerance.min +
      adjustedTolerance.max
    ) / 2;

  const generatedMinClarity =
    (
      adjustedClarity.min +
      adjustedClarity.max
    ) / 2;

  const generatedTotalDurationSec =
    (
      adjustedDuration.min +
      adjustedDuration.max
    ) / 2;

  return {
    ...baseParams,

    tolerancePct:
      Number(
        generatedTolerancePct.toFixed(2),
      ),

    minClarity:
      Number(
        generatedMinClarity.toFixed(2),
      ),

    repetitions:
      baseParams.repetitions,

    totalDurationSec:
      Number(
        generatedTotalDurationSec.toFixed(2),
      ),
  };
}

export interface GenerateMelodicPatternMatchingParamsInput {
  tier: Tier;
  recentScores: number[];
}
export function generateMelodicPatternMatchingParams({
  tier,
  recentScores,
}: GenerateMelodicPatternMatchingParamsInput): MelodicPatternMatchingParams {
  const baseParams =
    MELODIC_PATTERN_MATCHING_PARAMS[tier];

  const noteCountRange = {
    min: baseParams.noteCount * 0.8,
    max: baseParams.noteCount * 1.2,
  };

  const toleranceRange = {
    min: baseParams.tolerancePct * 0.8,
    max: baseParams.tolerancePct * 1.2,
  };

  const clarityRange = {
    min: baseParams.minClarity * 0.8,
    max: baseParams.minClarity * 1.2,
  };

  const adjustedNoteCount =
    calculateAdjustedParameterBounds(
      recentScores,
      noteCountRange,
      'higher',
    );

  const adjustedTolerance =
    calculateAdjustedParameterBounds(
      recentScores,
      toleranceRange,
      'lower',
    );

  const adjustedClarity =
    calculateAdjustedParameterBounds(
      recentScores,
      clarityRange,
      'higher',
    );

  const generatedNoteCount =
    Math.round(
      (
        adjustedNoteCount.min +
        adjustedNoteCount.max
      ) / 2,
    );

  const generatedTolerancePct =
    (
      adjustedTolerance.min +
      adjustedTolerance.max
    ) / 2;

  const generatedMinClarity =
    (
      adjustedClarity.min +
      adjustedClarity.max
    ) / 2;

  return {
    ...baseParams,

    noteCount: Math.max(
      1,
      generatedNoteCount,
    ),

    tolerancePct:
      Number(
        generatedTolerancePct.toFixed(2),
      ),

    minClarity:
      Number(
        generatedMinClarity.toFixed(2),
      ),
  };
}

export interface GenerateVowelConsistencyParamsInput {
  tier: Tier;
  recentScores: number[];
}
export function generateVowelConsistencyParams({
  tier,
  recentScores,
}: GenerateVowelConsistencyParamsInput): VowelConsistencyParams {
  const baseParams =
    VOWEL_CONSISTENCY_PARAMS[tier];

  const durationRange = {
    min:
      baseParams.durationRangeSec[0] * 0.8,

    max:
      baseParams.durationRangeSec[1] * 1.2,
  };

  const repetitionsRange = {
    min:
      baseParams.repetitions * 0.8,

    max:
      baseParams.repetitions * 1.2,
  };

  const smoothnessThresholdRange = {
    min:
      baseParams.smoothnessThreshold * 0.8,

    max:
      baseParams.smoothnessThreshold * 1.2,
  };

  const adjustedDuration =
    calculateAdjustedParameterBounds(
      recentScores,
      durationRange,
      'higher',
    );

  const adjustedRepetitions =
    calculateAdjustedParameterBounds(
      recentScores,
      repetitionsRange,
      'higher',
    );

  const adjustedSmoothnessThreshold =
    calculateAdjustedParameterBounds(
      recentScores,
      smoothnessThresholdRange,
      'higher',
    );

  const generatedDurationMin =
    adjustedDuration.min;

  const generatedDurationMax =
    adjustedDuration.max;

  const generatedRepetitions =
    Math.round(
      (
        adjustedRepetitions.min +
        adjustedRepetitions.max
      ) / 2,
    );

  const generatedSmoothnessThreshold = Math.max(
    0,
    Math.min(
      100,
      (
        adjustedSmoothnessThreshold.min +
        adjustedSmoothnessThreshold.max
      ) / 2,
    ),
);

  return {
    ...baseParams,

    durationRangeSec: [
      Number(
        generatedDurationMin.toFixed(2),
      ),
      Number(
        generatedDurationMax.toFixed(2),
      ),
    ],

    repetitions:
      Math.max(
        1,
        generatedRepetitions,
      ),

    smoothnessThreshold:
      Number(
        generatedSmoothnessThreshold.toFixed(2),
      ),
    resonanceTypeCount:
      baseParams.resonanceTypeCount,
  };
}

export interface GenerateWaveformSmoothnessParamsInput {
  tier: Tier;
  recentScores: number[];
}
export function generateWaveformSmoothnessParams({
  tier,
  recentScores,
}: GenerateWaveformSmoothnessParamsInput): WaveformSmoothnessParams {
  const baseParams =
    WAVEFORM_SMOOTHNESS_PARAMS[tier];

  const durationRange = {
    min: baseParams.durationSec * 0.8,
    max: baseParams.durationSec * 1.2,
  };

  const smoothnessThresholdRange = {
    min: baseParams.smoothnessThreshold * 0.8,
    max: baseParams.smoothnessThreshold * 1.2,
  };

  const adjustedDuration =
    calculateAdjustedParameterBounds(
      recentScores,
      durationRange,
      'lower',
    );

  const adjustedSmoothnessThreshold =
    calculateAdjustedParameterBounds(
      recentScores,
      smoothnessThresholdRange,
      'higher',
    );

  const generatedDurationSec =
    (
      adjustedDuration.min +
      adjustedDuration.max
    ) / 2;

  const generatedSmoothnessThreshold =
    (
      adjustedSmoothnessThreshold.min +
      adjustedSmoothnessThreshold.max
    ) / 2;

  return {
    ...baseParams,

    durationSec:
      Number(
        generatedDurationSec.toFixed(2),
      ),

    smoothnessThreshold:
      Number(
        generatedSmoothnessThreshold.toFixed(2),
      ),
  };
}

export interface GenerateFrequencyZoneStabilityParamsInput {
  tier: Tier;
  recentScores: number[];
}
export function generateFrequencyZoneStabilityParams({
  tier,
  recentScores,
}: GenerateFrequencyZoneStabilityParamsInput): FrequencyZoneStabilityParams {
  const baseParams =
    FREQUENCY_ZONE_STABILITY_PARAMS[tier];

  const durationRange = {
    min: baseParams.durationSec * 0.8,
    max: baseParams.durationSec * 1.2,
  };

  const stabilityThresholdRange = {
    min:
      baseParams.stabilityThreshold * 0.8,
    max:
      baseParams.stabilityThreshold * 1.2,
  };

  const adjustedDuration =
    calculateAdjustedParameterBounds(
      recentScores,
      durationRange,
      'higher',
    );

  const adjustedStabilityThreshold =
    calculateAdjustedParameterBounds(
      recentScores,
      stabilityThresholdRange,
      'higher',
    );

  const generatedDurationSec =
    (
      adjustedDuration.min +
      adjustedDuration.max
    ) / 2;

  const generatedStabilityThreshold =
    (
      adjustedStabilityThreshold.min +
      adjustedStabilityThreshold.max
    ) / 2;

  return {
    ...baseParams,

    durationSec:
      Number(
        generatedDurationSec.toFixed(2),
      ),

    stabilityThreshold:
      Number(
        generatedStabilityThreshold.toFixed(2),
      ),
  };
}

export interface GenerateToneConsistencyParamsInput {
  tier: Tier;
  recentScores: number[];
}
export function generateToneConsistencyParams({
  tier,
  recentScores,
}: GenerateToneConsistencyParamsInput): ToneConsistencyParams {
  const baseParams =
    TONE_CONSISTENCY_PARAMS[tier];

  const intervalRange = {
    min: baseParams.intervalSec * 0.8,
    max: baseParams.intervalSec * 1.2,
  };

  const repetitionsRange = {
    min: baseParams.repetitions * 0.8,
    max: baseParams.repetitions * 1.2,
  };

  const consistencyThresholdRange = {
    min:
      baseParams.consistencyThreshold * 0.8,
    max:
      baseParams.consistencyThreshold * 1.2,
  };

  const adjustedInterval =
    calculateAdjustedParameterBounds(
      recentScores,
      intervalRange,
      'lower',
    );

  const adjustedRepetitions =
    calculateAdjustedParameterBounds(
      recentScores,
      repetitionsRange,
      'higher',
    );

  const adjustedConsistencyThreshold =
    calculateAdjustedParameterBounds(
      recentScores,
      consistencyThresholdRange,
      'higher',
    );

  const generatedIntervalSec =
    (
      adjustedInterval.min +
      adjustedInterval.max
    ) / 2;

  const generatedRepetitions =
    Math.round(
      (
        adjustedRepetitions.min +
        adjustedRepetitions.max
      ) / 2,
    );

  const generatedConsistencyThreshold =
    (
      adjustedConsistencyThreshold.min +
      adjustedConsistencyThreshold.max
    ) / 2;

  return {
    ...baseParams,

    intervalSec:
      Number(
        generatedIntervalSec.toFixed(2),
      ),

    repetitions:
      Math.max(
        1,
        generatedRepetitions,
      ),

    consistencyThreshold:
      Number(
        generatedConsistencyThreshold.toFixed(2),
      ),
    variancePct:
      baseParams.variancePct,
  };
}

export interface GenerateSteadyToneHoldingParamsInput {
  tier: Tier;
  recentScores: number[];
}
export function generateSteadyToneHoldingParams({
  tier,
  recentScores,
}: GenerateSteadyToneHoldingParamsInput): SteadyToneHoldingParams {
  const baseParams =
    STEADY_TONE_HOLDING_PARAMS[tier];

  const durationRange = {
    min: baseParams.durationSec * 0.8,
    max: baseParams.durationSec * 1.2,
  };

  const repetitionsRange = {
    min: baseParams.repetitions * 0.8,
    max: baseParams.repetitions * 1.2,
  };

  const qualityThresholdRange = {
    min: baseParams.qualityThreshold * 0.8,
    max: baseParams.qualityThreshold * 1.2,
  };

  const adjustedDuration =
    calculateAdjustedParameterBounds(
      recentScores,
      durationRange,
      'lower',
    );

  const adjustedRepetitions =
    calculateAdjustedParameterBounds(
      recentScores,
      repetitionsRange,
      'higher',
    );

  const adjustedQualityThreshold =
    calculateAdjustedParameterBounds(
      recentScores,
      qualityThresholdRange,
      'higher',
    );

  const generatedDurationSec =
    (
      adjustedDuration.min +
      adjustedDuration.max
    ) / 2;

  const generatedRepetitions =
    Math.round(
      (
        adjustedRepetitions.min +
        adjustedRepetitions.max
      ) / 2,
    );

  const generatedQualityThreshold =
    (
      adjustedQualityThreshold.min +
      adjustedQualityThreshold.max
    ) / 2;

  return {
    ...baseParams,

    durationSec:
      Number(
        generatedDurationSec.toFixed(2),
      ),

    repetitions:
      Math.max(
        1,
        generatedRepetitions,
      ),

    qualityThreshold:
      Number(
        generatedQualityThreshold.toFixed(2),
      ),

    variancePct:
      baseParams.variancePct,
  };
}

export interface GenerateDynamicRangeParamsInput {
  tier: Tier;
  recentScores: number[];
}
export function generateDynamicRangeParams({
  tier,
  recentScores,
}: GenerateDynamicRangeParamsInput): DynamicRangeParams {
  const baseParams =
    DYNAMIC_RANGE_PARAMS[tier];

  const durationRange = {
    min: baseParams.durationSec * 0.8,
    max: baseParams.durationSec * 1.2,
  };

  const adjustedDuration =
    calculateAdjustedParameterBounds(
      recentScores,
      durationRange,
      'higher',
    );

  const generatedDurationSec =
    (
      adjustedDuration.min +
      adjustedDuration.max
    ) / 2;

  const repetitionsRange = {
    min: baseParams.repetitions * 0.8,
    max: baseParams.repetitions * 1.2,
  };

  const adjustedRepetitions =
    calculateAdjustedParameterBounds(
      recentScores,
      repetitionsRange,
      'higher',
    );

  const generatedRepetitions =
    Math.max(
      1,
      Math.round(
        (
          adjustedRepetitions.min +
          adjustedRepetitions.max
        ) / 2,
      ),
    );

  const targetMinRange = {
    min:
      baseParams.targetDbRange[0] * 0.8,

    max:
      baseParams.targetDbRange[0] * 1.2,
  };

  const targetMaxRange = {
    min:
      baseParams.targetDbRange[1] * 0.8,

    max:
      baseParams.targetDbRange[1] * 1.2,
  };

  const adjustedTargetMin =
    calculateAdjustedParameterBounds(
      recentScores,
      targetMinRange,
      'higher',
    );

  const adjustedTargetMax =
    calculateAdjustedParameterBounds(
      recentScores,
      targetMaxRange,
      'higher',
    );

  const generatedTargetMin =
    Number(
      (
        (
          adjustedTargetMin.min +
          adjustedTargetMin.max
        ) / 2
      ).toFixed(2),
    );

  const generatedTargetMax =
    Number(
      (
        (
          adjustedTargetMax.min +
          adjustedTargetMax.max
        ) / 2
      ).toFixed(2),
    );

  const targetDbRange: [
    number,
    number,
  ] = [
    generatedTargetMin,
    Math.max(
      generatedTargetMin,
      generatedTargetMax,
    ),
  ];

  return {
    ...baseParams,
    durationSec:
      Number(
        generatedDurationSec.toFixed(2),
      ),
    repetitions:
      generatedRepetitions,
    targetDbRange,
    rangeAccuracyThreshold:
      baseParams.rangeAccuracyThreshold,
    rampConsistencyThreshold:
      baseParams.rampConsistencyThreshold,
  };
}

export interface GenerateControlledCrescendoParamsInput {
  tier: Tier;
  recentScores: number[];
}
export function generateControlledCrescendoParams({
  tier,
  recentScores,
}: GenerateControlledCrescendoParamsInput): ControlledCrescendoParams {
  const baseParams =
    CONTROLLED_CRESCENDO_PARAMS[tier];

  const durationRange = {
    min: baseParams.durationSec * 0.8,
    max: baseParams.durationSec * 1.2,
  };

  const adjustedDuration =
    calculateAdjustedParameterBounds(
      recentScores,
      durationRange,
      'higher',
    );

  const generatedDurationSec =
    (
      adjustedDuration.min +
      adjustedDuration.max
    ) / 2;

  const repetitionsRange = {
    min: baseParams.repetitions * 0.8,
    max: baseParams.repetitions * 1.2,
  };

  const adjustedRepetitions =
    calculateAdjustedParameterBounds(
      recentScores,
      repetitionsRange,
      'higher',
    );

  const generatedRepetitions =
    Math.max(
      1,
      Math.round(
        (
          adjustedRepetitions.min +
          adjustedRepetitions.max
        ) / 2,
      ),
    );

  
  const baseMin = baseParams.targetDbRange[0];
  const baseMax = baseParams.targetDbRange[1];

  const adjustedTargetMin = calculateAdjustedParameterBounds(
    recentScores,
    {
      min: baseMin * 0.8,
      max: baseMin * 1.2,
    },
    'higher',
  );

  const adjustedTargetMax = calculateAdjustedParameterBounds(
    recentScores,
    {
      min: baseMax * 0.8,
      max: baseMax * 1.2,
    },
    'higher',
  );

  const generatedTargetMin = Number(
    (
      (adjustedTargetMin.min + adjustedTargetMin.max) / 2
    ).toFixed(2),
  );

  const generatedTargetMax = Number(
    (
      (adjustedTargetMax.min + adjustedTargetMax.max) / 2
    ).toFixed(2),
  );

  const minimumGap = baseMax - baseMin;

  const targetDbRange: [number, number] = [
    generatedTargetMin,
    Number(
      Math.max(
        generatedTargetMax,
        generatedTargetMin + minimumGap,
      ).toFixed(2),
    ),
  ];

  return {
    ...baseParams,
    durationSec:
      Number(
        generatedDurationSec.toFixed(2),
      ),
    repetitions:
      generatedRepetitions,
    targetDbRange,
    smoothnessThreshold:
      baseParams.smoothnessThreshold,
    volumeIncreaseThreshold:
      baseParams.volumeIncreaseThreshold,
  };
}

export interface GenerateControlledDecrescendoParamsInput {
  tier: Tier;
  recentScores: number[];
}
export function generateControlledDecrescendoParams({
  tier,
  recentScores,
}: GenerateControlledDecrescendoParamsInput): ControlledDecrescendoParams {
  const baseParams =
    CONTROLLED_DECRESCENDO_PARAMS[tier];

  const durationRange = {
    min: baseParams.durationSec * 0.8,
    max: baseParams.durationSec * 1.2,
  };

  const adjustedDuration =
    calculateAdjustedParameterBounds(
      recentScores,
      durationRange,
      'higher',
    );

  const generatedDurationSec =
    (
      adjustedDuration.min +
      adjustedDuration.max
    ) / 2;

  const repetitionsRange = {
    min: baseParams.repetitions * 0.8,
    max: baseParams.repetitions * 1.2,
  };

  const adjustedRepetitions =
    calculateAdjustedParameterBounds(
      recentScores,
      repetitionsRange,
      'higher',
    );

  const generatedRepetitions =
    Math.max(
      1,
      Math.round(
        (
          adjustedRepetitions.min +
          adjustedRepetitions.max
        ) / 2,
      ),
    );

  const targetMinRange = {
    min:
      baseParams.targetDbRange[0] * 0.8,

    max:
      baseParams.targetDbRange[0] * 1.2,
  };

  const targetMaxRange = {
    min:
      baseParams.targetDbRange[1] * 0.8,

    max:
      baseParams.targetDbRange[1] * 1.2,
  };

  const adjustedTargetMin =
    calculateAdjustedParameterBounds(
      recentScores,
      targetMinRange,
      'higher',
    );

  const adjustedTargetMax =
    calculateAdjustedParameterBounds(
      recentScores,
      targetMaxRange,
      'higher',
    );

  const generatedTargetMin =
    Number(
      (
        (
          adjustedTargetMin.min +
          adjustedTargetMin.max
        ) / 2
      ).toFixed(2),
    );

  const generatedTargetMax =
    Number(
      (
        (
          adjustedTargetMax.min +
          adjustedTargetMax.max
        ) / 2
      ).toFixed(2),
    );

  const targetDbRange: [
    number,
    number,
  ] = [
    generatedTargetMin,
    Math.max(
      generatedTargetMin,
      generatedTargetMax,
    ),
  ];

  const volumeDecreaseThresholdRange = {
    min:
      baseParams.volumeDecreaseThreshold * 0.8,

    max:
      baseParams.volumeDecreaseThreshold * 1.2,
  };

  const adjustedVolumeDecreaseThreshold =
    calculateAdjustedParameterBounds(
      recentScores,
      volumeDecreaseThresholdRange,
      'higher',
    );

  const generatedVolumeDecreaseThreshold =
    (
      adjustedVolumeDecreaseThreshold.min +
      adjustedVolumeDecreaseThreshold.max
    ) / 2;

  return {
    ...baseParams,
    durationSec:
      Number(
        generatedDurationSec.toFixed(2),
      ),
    repetitions:
      generatedRepetitions,
    targetDbRange,
    smoothnessThreshold:
      baseParams.smoothnessThreshold,
    volumeDecreaseThreshold:
      Number(
        generatedVolumeDecreaseThreshold.toFixed(2),
      ),
  };
}

export interface GenerateVolumeBandTargetingParamsInput {
  tier: Tier;
  recentScores: number[];
}
export function generateVolumeBandTargetingParams({
  tier,
  recentScores,
}: GenerateVolumeBandTargetingParamsInput): VolumeBandTargetingParams {
  const baseParams =
    VOLUME_BAND_TARGETING_PARAMS[tier];

  const durationRange = {
    min:
      baseParams.durationSec * 0.8,

    max:
      baseParams.durationSec * 1.2,
  };

  const adjustedDuration =
    calculateAdjustedParameterBounds(
      recentScores,
      durationRange,
      'higher',
    );

  const generatedDurationSec =
    (
      adjustedDuration.min +
      adjustedDuration.max
    ) / 2;

  const repetitionsRange = {
    min:
      baseParams.repetitions * 0.8,

    max:
      baseParams.repetitions * 1.2,
  };

  const adjustedRepetitions =
    calculateAdjustedParameterBounds(
      recentScores,
      repetitionsRange,
      'higher',
    );

  const generatedRepetitions =
    Math.max(
      1,
      Math.round(
        (
          adjustedRepetitions.min +
          adjustedRepetitions.max
        ) / 2,
      ),
    );

  const targetMinRange = {
    min:
      baseParams.targetDbRange[0] * 0.8,

    max:
      baseParams.targetDbRange[0] * 1.2,
  };

  const targetMaxRange = {
    min:
      baseParams.targetDbRange[1] * 0.8,

    max:
      baseParams.targetDbRange[1] * 1.2,
  };

  const adjustedTargetMin =
    calculateAdjustedParameterBounds(
      recentScores,
      targetMinRange,
      'higher',
    );

  const adjustedTargetMax =
    calculateAdjustedParameterBounds(
      recentScores,
      targetMaxRange,
      'higher',
    );

  const generatedTargetMin =
    Number(
      (
        (
          adjustedTargetMin.min +
          adjustedTargetMin.max
        ) / 2
      ).toFixed(2),
    );

  const generatedTargetMax =
    Number(
      (
        (
          adjustedTargetMax.min +
          adjustedTargetMax.max
        ) / 2
      ).toFixed(2),
    );

  const targetDbRange: [
    number,
    number,
  ] = [
    generatedTargetMin,
    Math.max(
      generatedTargetMin,
      generatedTargetMax,
    ),
  ];

  const toleranceRange = {
    min:
      baseParams.toleranceDb * 0.8,

    max:
      baseParams.toleranceDb * 1.2,
  };

  const adjustedTolerance =
    calculateAdjustedParameterBounds(
      recentScores,
      toleranceRange,
      'lower',
    );

  const generatedToleranceDb =
    (
      adjustedTolerance.min +
      adjustedTolerance.max
    ) / 2;

  return {
    ...baseParams,
    durationSec:
      Number(
        generatedDurationSec.toFixed(2),
      ),
    repetitions:
      generatedRepetitions,
    targetDbRange,
    toleranceDb:
      Number(
        generatedToleranceDb.toFixed(2),
      ),
    consistencyThreshold:
      baseParams.consistencyThreshold,
  };
}

export interface GenerateVolumeControlStabilityParamsInput {
  tier: Tier;
  recentScores: number[];
}
export function generateVolumeControlStabilityParams({
  tier,
  recentScores,
}: GenerateVolumeControlStabilityParamsInput): VolumeControlStabilityParams {
  const baseParams =
    VOLUME_CONTROL_STABILITY_PARAMS[tier];

  const durationRange = {
    min:
      baseParams.durationSec * 0.8,

    max:
      baseParams.durationSec * 1.2,
  };

  const adjustedDuration =
    calculateAdjustedParameterBounds(
      recentScores,
      durationRange,
      'higher',
    );

  const generatedDurationSec =
    (
      adjustedDuration.min +
      adjustedDuration.max
    ) / 2;

  const repetitionsRange = {
    min:
      baseParams.repetitions * 0.8,

    max:
      baseParams.repetitions * 1.2,
  };

  const adjustedRepetitions =
    calculateAdjustedParameterBounds(
      recentScores,
      repetitionsRange,
      'higher',
    );

  const generatedRepetitions =
    Math.max(
      1,
      Math.round(
        (
          adjustedRepetitions.min +
          adjustedRepetitions.max
        ) / 2,
      ),
    );

  const stabilityThresholdRange = {
    min:
      baseParams.stabilityThreshold * 0.8,

    max:
      baseParams.stabilityThreshold * 1.2,
  };

  const adjustedStabilityThreshold =
    calculateAdjustedParameterBounds(
      recentScores,
      stabilityThresholdRange,
      'higher',
    );

  const generatedStabilityThreshold =
    (
      adjustedStabilityThreshold.min +
      adjustedStabilityThreshold.max
    ) / 2;

  return {
    ...baseParams,
    durationSec:
      Number(
        generatedDurationSec.toFixed(2),
      ),
    repetitions:
      generatedRepetitions,
    stabilityThreshold:
      Number(
        generatedStabilityThreshold.toFixed(2),
      ),
    targetDbRange:
      baseParams.targetDbRange,
    amplitudeVariancePct:
      baseParams.amplitudeVariancePct,
    detectionThreshold:
      baseParams.detectionThreshold,
  };
}

export interface GenerateRapidNoteTransitionParamsInput {
  tier: Tier;
  recentScores: number[];
}
export function generateRapidNoteTransitionParams({
  tier,
  recentScores,
}: GenerateRapidNoteTransitionParamsInput) {
  const baseParams = RAPID_NOTE_TRANSITION_PARAMS[tier];

  const minNotesRange = {
    min: baseParams.minNotes * 0.8,
    max: baseParams.minNotes * 1.2,
  };

  const maxNotesRange = {
    min: baseParams.maxNotes * 0.8,
    max: baseParams.maxNotes * 1.2,
  };

  const minSpeedRange = {
    min: baseParams.minSpeed * 0.8,
    max: baseParams.minSpeed * 1.2,
  };

  const maxSpeedRange = {
    min: baseParams.maxSpeed * 0.8,
    max: baseParams.maxSpeed * 1.2,
  };

  const repetitionsRange = {
    min: baseParams.repetitions * 0.8,
    max: baseParams.repetitions * 1.2,
  };

  const noteDurationRange = {
    min: baseParams.noteDurationSec * 0.8,
    max: baseParams.noteDurationSec * 1.2,
  };

  const adjustedMinNotes = calculateAdjustedParameterBounds(
    recentScores,
    minNotesRange,
    'higher',
  );

  const adjustedMaxNotes = calculateAdjustedParameterBounds(
    recentScores,
    maxNotesRange,
    'higher',
  );

  const adjustedMinSpeed = calculateAdjustedParameterBounds(
    recentScores,
    minSpeedRange,
    'higher',
  );

  const adjustedMaxSpeed = calculateAdjustedParameterBounds(
    recentScores,
    maxSpeedRange,
    'higher',
  );

  const adjustedRepetitions = calculateAdjustedParameterBounds(
    recentScores,
    repetitionsRange,
    'higher',
  );

  const adjustedNoteDuration = calculateAdjustedParameterBounds(
    recentScores,
    noteDurationRange,
    'lower',
  );

  const generatedMinNotes = Math.max(
    1,
    Math.round(
      (adjustedMinNotes.min + adjustedMinNotes.max) / 2,
    ),
  );

  const generatedMaxNotes = Math.max(
    generatedMinNotes,
    Math.round(
      (adjustedMaxNotes.min + adjustedMaxNotes.max) / 2,
    ),
  );

  const generatedMinSpeed =
    (adjustedMinSpeed.min + adjustedMinSpeed.max) / 2;

  const generatedMaxSpeed =
    (adjustedMaxSpeed.min + adjustedMaxSpeed.max) / 2;

  const minSpeed = Math.min(
    generatedMinSpeed,
    generatedMaxSpeed,
  );

  const maxSpeed = Math.max(
    generatedMinSpeed,
    generatedMaxSpeed,
  );

  const generatedRepetitions = Math.max(
    1,
    Math.round(
      (adjustedRepetitions.min + adjustedRepetitions.max) / 2,
    ),
  );

  const generatedNoteDurationSec =
    (adjustedNoteDuration.min + adjustedNoteDuration.max) / 2;

  return {
    ...baseParams,
    minNotes: generatedMinNotes,
    maxNotes: generatedMaxNotes,
    minSpeed: Number(minSpeed.toFixed(2)),
    maxSpeed: Number(maxSpeed.toFixed(2)),
    repetitions: generatedRepetitions,
    noteDurationSec: Number(generatedNoteDurationSec.toFixed(2)),
    accuracyThreshold: baseParams.accuracyThreshold,
    minMidi: baseParams.minMidi,
    maxMidi: baseParams.maxMidi,
  };
}

type RapidScaleTrillVocalRange = {
  lowHz: number;
  highHz: number;
};
const RAPID_SCALE_TRILL_PATTERNS: Record<Tier, number[]> = {
  beginner: [0, 2, 4, 2, 0, 2, 4, 2],
  intermediate: [0, 2, 4, 2, 0, 2, 4, 7, 4, 2],
  advanced: [0, 2, 4, 6, 8, 6, 4, 2, 0, 2, 4, 6, 8, 6, 4, 2],
};
function rapidScaleTrillHzToMidi(frequencyHz: number): number {
  return 69 + 12 * Math.log2(frequencyHz / 440);
}
function rapidScaleTrillMidiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
function generateRapidScaleTrillFrequencies(
  tier: Tier,
  vocalRange?: RapidScaleTrillVocalRange | null,
): number[] {
  if (
    !vocalRange ||
    !Number.isFinite(vocalRange.lowHz) ||
    !Number.isFinite(vocalRange.highHz) ||
    vocalRange.lowHz <= 0 ||
    vocalRange.highHz <= vocalRange.lowHz
  ) {
    return [];
  }
  const rangeMinMidi = Math.ceil(
    rapidScaleTrillHzToMidi(vocalRange.lowHz),
  );
  const rangeMaxMidi = Math.floor(
    rapidScaleTrillHzToMidi(vocalRange.highHz),
  );
  if (rangeMinMidi > rangeMaxMidi) {
    return [];
  }
  const pattern = RAPID_SCALE_TRILL_PATTERNS[tier];
  const maxOffset = Math.max(...pattern);
  const availableSemitones = rangeMaxMidi - rangeMinMidi;
  const scaleFactor =
    maxOffset > availableSemitones && maxOffset > 0
      ? availableSemitones / maxOffset
      : 1;

  const fittedPattern = pattern.map((offset) =>
    Math.round(offset * scaleFactor),
  );
  const fittedMaxOffset = Math.max(...fittedPattern);
  const maxStartMidi = rangeMaxMidi - fittedMaxOffset;

  if (maxStartMidi < rangeMinMidi) {
    return [];
  }
  const startMidi =
    rangeMinMidi +
    Math.floor(
      Math.random() * (maxStartMidi - rangeMinMidi + 1),
    );
  const frequencies = fittedPattern.map((offset) =>
    rapidScaleTrillMidiToHz(startMidi + offset),
  );
  if (
    frequencies.some(
      (frequency) =>
        frequency < vocalRange.lowHz - 0.001 ||
        frequency > vocalRange.highHz + 0.001,
    )
  ) {
    return [];
  }
  return frequencies;
}

export interface GenerateRapidScaleTrillParamsInput {
  tier: Tier;
  recentScores: number[];
  vocalRange?: RapidScaleTrillVocalRange | null;
}

export function generateRapidScaleTrillParams({
  tier,
  recentScores,
  vocalRange,
}: GenerateRapidScaleTrillParamsInput) {
  const baseParams = RAPID_SCALE_TRILL_PARAMS[tier];

  const noteDurationRange = {
    min: baseParams.noteDurationSec * 0.8,
    max: baseParams.noteDurationSec * 1.2,
  };

  const adjustedNoteDuration = calculateAdjustedParameterBounds(
    recentScores,
    noteDurationRange,
    'lower',
  );

  const generatedNoteDurationSec =
    (adjustedNoteDuration.min + adjustedNoteDuration.max) / 2;

  const frequencies = generateRapidScaleTrillFrequencies(
    tier,
    vocalRange,
  );

  return {
    ...baseParams,
    noteDurationSec: Number(generatedNoteDurationSec.toFixed(2)),
    frequencies,
  };
}

export interface GenerateArpeggioSpeedDrillParamsInput {
  tier: Tier;
  recentScores: number[];
}
export function generateArpeggioSpeedDrillParams({
  tier,
  recentScores,
}: GenerateArpeggioSpeedDrillParamsInput) {
  const baseParams = ARPEGGIO_SPEED_DRILL_PARAMS[tier];

  const noteDurationRange = {
    min: baseParams.noteDurationSec * 0.8,
    max: baseParams.noteDurationSec * 1.2,
  };

  const adjustedNoteDuration = calculateAdjustedParameterBounds(
    recentScores,
    noteDurationRange,
    'lower',
  );

  const generatedNoteDurationSec =
    (adjustedNoteDuration.min + adjustedNoteDuration.max) / 2;

  const gapRange = {
    min: baseParams.gapSec * 0.8,
    max: baseParams.gapSec * 1.2,
  };

  const adjustedGap = calculateAdjustedParameterBounds(
    recentScores,
    gapRange,
    'lower',
  );

  const generatedGapSec =
    (adjustedGap.min + adjustedGap.max) / 2;

  return {
    ...baseParams,
    noteDurationSec: Number(generatedNoteDurationSec.toFixed(2)),
    gapSec: Number(generatedGapSec.toFixed(2)),
  };
}

function quickIntervalFrequencyToMidi(frequencyHz: number): number {
  return 69 + 12 * Math.log2(frequencyHz / 440);
}

function quickIntervalMidiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function generateQuickIntervalJumpFrequencies(
  noteCount: number,
  vocalRange?: { lowHz: number; highHz: number } | null,
): number[] {
  if (
    !Number.isInteger(noteCount) ||
    noteCount < 2 ||
    !vocalRange ||
    !Number.isFinite(vocalRange.lowHz) ||
    !Number.isFinite(vocalRange.highHz) ||
    vocalRange.lowHz <= 0 ||
    vocalRange.highHz <= vocalRange.lowHz
  ) {
    return [];
  }

  const lowMidi = Math.ceil(
    quickIntervalFrequencyToMidi(vocalRange.lowHz),
  );
  const highMidi = Math.floor(
    quickIntervalFrequencyToMidi(vocalRange.highHz),
  );

  const availableNotes = highMidi - lowMidi + 1;

  if (availableNotes < noteCount) {
    return [];
  }
  const maxStartMidi = highMidi - noteCount + 1;
  const startMidi =
    lowMidi +
    Math.floor(
      Math.random() * (maxStartMidi - lowMidi + 1),
    );

  const sequence = Array.from(
    { length: noteCount },
    (_, index) => startMidi + index,
  );

  return sequence.map((midi) =>
    Number(quickIntervalMidiToFrequency(midi).toFixed(3)),
  );
}

export interface GenerateQuickIntervalJumpParamsInput {
  tier: Tier;
  recentScores: number[];
  vocalRange?: { lowHz: number; highHz: number } | null;
}

export function generateQuickIntervalJumpParams({
  tier,
  recentScores,
  vocalRange,
}: GenerateQuickIntervalJumpParamsInput) {
  const baseParams = QUICK_INTERVAL_JUMP_PARAMS[tier];

  const baseNoteDurationSec = 0.30;

  const noteDurationRange = {
    min: baseNoteDurationSec * 0.8,
    max: baseNoteDurationSec * 1.2,
  };

  const adjustedNoteDuration = calculateAdjustedParameterBounds(
    recentScores,
    noteDurationRange,
    'lower',
  );

  const generatedNoteDurationSec =
    (adjustedNoteDuration.min + adjustedNoteDuration.max) / 2;

  const baseGapSec = 0.35;

  const gapRange = {
    min: baseGapSec * 0.8,
    max: baseGapSec * 1.2,
  };

  const adjustedGap = calculateAdjustedParameterBounds(
    recentScores,
    gapRange,
    'lower',
  );

  const generatedGapSec =
    (adjustedGap.min + adjustedGap.max) / 2;

  const noteCountByTier: Record<Tier, number> = {
    beginner: 4,
    intermediate: 5,
    advanced: 6,
  };

  const frequencies = generateQuickIntervalJumpFrequencies(
    noteCountByTier[tier],
    vocalRange,
  );

  return {
    ...baseParams,
    noteDurationSec: Number(generatedNoteDurationSec.toFixed(2)),
    gapSec: Number(generatedGapSec.toFixed(2)),
    frequencies,
  };
}

export interface GenerateVocalRunAccuracyParamsInput {
  tier: Tier;
  recentScores: number[];
  vocalRange?: {
    lowHz: number;
    highHz: number;
  } | null;
  previousFrequencies?: readonly number[];
}

function vocalRunFrequencyToMidi(frequencyHz: number): number {
  return 69 + 12 * Math.log2(frequencyHz / 440);
}

function vocalRunMidiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function areVocalRunSequencesEqual(
  first: readonly number[],
  second: readonly number[],
): boolean {
  return (
    first.length === second.length &&
    first.every((note, index) => note === second[index])
  );
}

function generateVocalRunFrequencies(
  noteCount: number,
  recentScores: number[],
  vocalRange?: { lowHz: number; highHz: number } | null,
  previousFrequencies?: readonly number[],
): number[] {
  const hasValidVocalRange =
    vocalRange != null &&
    Number.isFinite(vocalRange.lowHz) &&
    Number.isFinite(vocalRange.highHz) &&
    vocalRange.lowHz > 0 &&
    vocalRange.highHz > vocalRange.lowHz;

  if (!hasValidVocalRange || noteCount < 3) {
    return [];
  }

  const lowMidi = Math.ceil(
    vocalRunFrequencyToMidi(vocalRange.lowHz),
  );
  const highMidi = Math.floor(
    vocalRunFrequencyToMidi(vocalRange.highHz),
  );

  if (highMidi - lowMidi < 2) {
    return [];
  }

  const validScores = recentScores.filter(
    (score) =>
      Number.isFinite(score) &&
      score >= 0 &&
      score <= 100,
  );

  const averageScore =
    validScores.length > 0
      ? validScores.reduce((sum, score) => sum + score, 0) /
        validScores.length
      : null;

  const availableSpan = highMidi - lowMidi;
  const desiredSpan =
    averageScore === null
      ? Math.min(availableSpan, 4)
      : averageScore < 55
        ? Math.min(availableSpan, 3)
        : averageScore >= 85
          ? availableSpan
          : Math.min(availableSpan, 5);

  const span = Math.max(2, desiredSpan);
  const possibleStarts: number[] = [];

  for (
    let startMidi = lowMidi;
    startMidi + span <= highMidi;
    startMidi++
  ) {
    possibleStarts.push(startMidi);
  }

  if (possibleStarts.length === 0) {
    return [];
  }

  const previousMidis =
    previousFrequencies &&
    previousFrequencies.length > 0 &&
    previousFrequencies.every(
      (frequency) =>
        Number.isFinite(frequency) && frequency > 0,
    )
      ? previousFrequencies.map((frequency) =>
          Math.round(vocalRunFrequencyToMidi(frequency)),
        )
      : [];

  const ascendingCount = Math.ceil(noteCount / 2);
  const descendingCount = noteCount - ascendingCount;

  const contour: number[] = [];

  for (let index = 0; index < ascendingCount; index++) {
    contour.push(
      Math.round(
        (index / Math.max(1, ascendingCount - 1)) * span,
      ),
    );
  }

  for (let index = descendingCount - 1; index >= 0; index--) {
    contour.push(
      Math.round(
        (index / Math.max(1, ascendingCount - 1)) * span,
      ),
    );
  }

  const normalizedContour = contour.slice(0, noteCount);

  if (normalizedContour.length !== noteCount) {
    return [];
  }

  const candidateSequences = possibleStarts.map((startMidi) =>
    normalizedContour.map((offset) => startMidi + offset),
  );

  const differentFromPrevious = candidateSequences.filter(
    (sequence) =>
      !areVocalRunSequencesEqual(sequence, previousMidis),
  );

  const choices =
    differentFromPrevious.length > 0
      ? differentFromPrevious
      : candidateSequences;

  const selectedMidis =
    choices[Math.floor(Math.random() * choices.length)];

  return selectedMidis.map((midi) =>
    Number(vocalRunMidiToFrequency(midi).toFixed(3)),
  );
}

export function generateVocalRunAccuracyParams({
  tier,
  recentScores,
  vocalRange,
  previousFrequencies,
}: GenerateVocalRunAccuracyParamsInput) {
  const baseParams = VOCAL_RUN_ACCURACY_PARAMS[tier];

  const noteDurationRange = {
    min: baseParams.noteDurationSec * 0.8,
    max: baseParams.noteDurationSec * 1.2,
  };

  const adjustedNoteDuration = calculateAdjustedParameterBounds(
    recentScores,
    noteDurationRange,
    'lower',
  );

  const generatedNoteDurationSec =
    (adjustedNoteDuration.min + adjustedNoteDuration.max) / 2;

  const noteCountByTier: Record<Tier, number> = {
    beginner: 5,
    intermediate: 6,
    advanced: 7,
  };

  const frequencies = generateVocalRunFrequencies(
    noteCountByTier[tier],
    recentScores,
    vocalRange,
    previousFrequencies,
  );

  return {
    ...baseParams,
    noteDurationSec: Number(
      generatedNoteDurationSec.toFixed(2),
    ),
    frequencies,
  };
}