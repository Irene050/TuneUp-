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
} from '@/constants/exercises/breathControl';

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
} from '@/constants/exercises/pitch';

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
} from '@/constants/exercises/tone';

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
} from '@/constants/exercises/volume';

import {
  ARPEGGIO_SPEED_DRILL_PARAMS,
  QUICK_INTERVAL_JUMP_PARAMS,
  RAPID_NOTE_TRANSITION_PARAMS,
  RAPID_SCALE_TRILL_PARAMS,
  RAPID_VOCAL_RUN_PARAMS,
} from '@/constants/exercises/agility';

import {
  calculateAdjustedParameterBounds,
} from './adaptiveDifficultyScaling';

/*
 * =====================================================
 * SUSTAINED EXHALE
 * =====================================================
 */

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

/*
 * =====================================================
 * SUSTAINED SSSS
 * =====================================================
 */

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

/*
 * =====================================================
 * DIAPHRAGMATIC BREATHING
 * =====================================================
 *
 * Continuous ADS adjusts exhalation duration.
 *
 * Higher scores increase the exhalation target.
 * Lower scores decrease the exhalation target.
 *
 * The adaptive range is ±20% of the
 * current tier's default value.
 */

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

/*
 * =====================================================
 * STEADY AIRFLOW MAINTENANCE
 * =====================================================
 */

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

/*
 * =====================================================
 * CONTROLLED BREATH RELEASE
 * =====================================================
 *
 * Continuous ADS adjusts:
 * - pulse count
 * - pulse interval
 *
 * Higher scores:
 * - increase pulse count
 * - decrease pulse interval
 *
 * Lower scores:
 * - decrease pulse count
 * - increase pulse interval
 *
 * Each parameter is allowed to move within
 * ±20% of the current tier's default value.
 */

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

/*
 * =====================================================
 * NOTE MATCHING
 * =====================================================
 *
 * Continuous ADS adjusts:
 * - pitch tolerance
 * - minimum clarity
 * - minimum voiced frames
 *
 * Higher scores:
 * - decrease pitch tolerance
 * - increase minimum clarity
 * - increase minimum voiced frames
 *
 * Lower scores:
 * - increase pitch tolerance
 * - decrease minimum clarity
 * - decrease minimum voiced frames
 *
 * Each parameter is allowed to move within
 * ±20% of the current tier's default value.
 */

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

/*
 * =====================================================
 * SCALE ACCURACY DRILL
 * =====================================================
 *
 * Continuous ADS adjusts:
 * - pitch tolerance
 * - minimum clarity
 * - note count
 * - required scale accuracy
 */

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

    noteCount:
      Math.min(
        8,
        Math.max(
          1,
          generatedNoteCount,
        ),
      ),

    scaleAccuracyThreshold:
      Number(
        generatedAccuracyThreshold.toFixed(2),
      ),
  };
}

/*
 * =====================================================
 * SUSTAINED NOTE STABILITY
 * =====================================================
 *
 * Continuous ADS adjusts:
 * - sustained duration
 * - pitch stability threshold
 * - minimum clarity
 *
 * Higher scores:
 * - increase duration
 * - decrease allowed pitch variation
 * - increase minimum clarity
 *
 * Lower scores:
 * - decrease duration
 * - increase allowed pitch variation
 * - decrease minimum clarity
 */

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

/*
 * =====================================================
 * INTERVAL RECOGNITION TASK
 * =====================================================
 *
 * Continuous ADS adjusts:
 * - pitch tolerance
 * - minimum clarity
 * - total recording duration
 *
 * The number of repetitions remains fixed at
 * the current tier's configured value.
 *
 * Higher scores:
 * - decrease pitch tolerance
 * - increase minimum clarity
 * - decrease total recording duration
 *
 * Lower scores:
 * - increase pitch tolerance
 * - decrease minimum clarity
 * - increase total recording duration
 *
 * Each adaptive parameter is allowed to move
 * within ±20% of the current tier's default value.
 */

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

/*
 * =====================================================
 * MELODIC PATTERN MATCHING
 * =====================================================
 *
 * Continuous ADS adjusts:
 * - pattern note count
 * - pitch tolerance
 * - minimum clarity
 *
 * Higher scores:
 * - increase the number of notes
 * - decrease pitch tolerance
 * - increase minimum clarity
 *
 * Lower scores:
 * - decrease the number of notes
 * - increase pitch tolerance
 * - decrease minimum clarity
 *
 * Each adaptive parameter is allowed to move
 * within ±20% of the current tier's default value.
 */

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

/*
 * =====================================================
 * VOWEL CONSISTENCY EXERCISE
 * =====================================================
 *
 * Continuous ADS adjusts:
 * - vowel duration
 * - repetitions
 * - smoothness threshold
 *
 * The vowel and resonance type count remain
 * determined by the current difficulty tier.
 *
 * Higher scores:
 * - increase duration
 * - increase repetitions
 * - increase smoothness requirement
 *
 * Lower scores:
 * - decrease duration
 * - decrease repetitions
 * - decrease smoothness requirement
 *
 * Each adaptive numeric parameter is allowed
 * to move within ±20% of the current tier's
 * default value.
 */

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

  const generatedSmoothnessThreshold =
    (
      adjustedSmoothnessThreshold.min +
      adjustedSmoothnessThreshold.max
    ) / 2;

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

    // Resonance type count is kept at the
    // tier-defined value because this exercise
    // does not currently measure resonance types.
    resonanceTypeCount:
      baseParams.resonanceTypeCount,
  };
}

/*
 * =====================================================
 * WAVEFORM SMOOTHNESS DRILL
 * =====================================================
 *
 * Continuous ADS adjusts:
 * - duration
 * - smoothness threshold
 *
 * Higher scores:
 * - decrease duration
 * - increase smoothness requirement
 *
 * Lower scores:
 * - increase duration
 * - decrease smoothness requirement
 *
 * Note:
 * - repetitions is retained from the base exercise
 *   configuration but is not adapted because this
 *   exercise uses one continuous hold.
 * - amplitudeVariancePct is retained from the base
 *   configuration but is not adapted because it is
 *   currently used only as a displayed reference,
 *   not as a scoring threshold.
 */

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

/*
 * =====================================================
 * FREQUENCY ZONE STABILITY
 * =====================================================
 *
 * Continuous ADS adjusts:
 * - duration
 * - stability threshold
 *
 * Higher scores:
 * - increase duration
 * - increase stability requirement
 *
 * Lower scores:
 * - decrease duration
 * - decrease stability requirement
 *
 * Frequency-band classification remains fixed because
 * the exercise measures consistency within the detected
 * low, mid, or high frequency band.
 */

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
/*
 * =====================================================
 * TONE CONSISTENCY EXERCISE
 * =====================================================
 *
 * Continuous ADS adjusts:
 * - interval
 * - repetitions
 * - consistency threshold
 *
 * Higher scores:
 * - decrease interval
 * - increase repetitions
 * - increase consistency requirement
 *
 * Lower scores:
 * - increase interval
 * - decrease repetitions
 * - decrease consistency requirement
 *
 * Note:
 * - variancePct is retained from the base exercise
 *   configuration but is not adapted because it is
 *   currently not used by the measurement, scoring,
 *   or exercise screen.
 */

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

    // Retained at the tier-defined value because
    // variancePct is not currently used by this
    // exercise's measurement or scoring.
    variancePct:
      baseParams.variancePct,
  };
}

/*
 * =====================================================
 * STEADY TONE HOLDING
 * =====================================================
 *
 * Continuous ADS adjusts:
 * - duration
 * - repetitions
 * - quality threshold
 *
 * Higher scores:
 * - decrease duration
 * - increase repetitions
 * - increase quality requirement
 *
 * Lower scores:
 * - increase duration
 * - decrease repetitions
 * - decrease quality requirement
 *
 * Note:
 * - variancePct is retained from the base exercise
 *   configuration because it is not currently used
 *   by the measurement or scoring logic.
 */

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

    // Retained at the tier-defined value because
    // variancePct is not currently used by the
    // measurement or scoring logic.
    variancePct:
      baseParams.variancePct,
  };
}

/*
 * =====================================================
 * DYNAMIC RANGE
 * =====================================================
 *
 * Continuous ADS adjusts:
 * - duration
 * - repetitions
 * - target dB range
 *
 * The exercise consists of three phases:
 * 1. Soft → Loud
 * 2. Loud
 * 3. Loud → Soft
 *
 * Therefore, the generated durationSec represents
 * the duration of each phase. The total recording
 * duration is durationSec × 3.
 *
 * Higher scores:
 * - increase the ramp duration
 *   so the singer must control the volume transition
 *   over a longer period
 * - increase repetitions
 * - move the target range toward a more demanding
 *   volume range
 *
 * Lower scores:
 * - decrease the ramp duration
 * - decrease repetitions
 * - move the target range toward an easier range
 *
 * The following parameters remain fixed at their
 * tier-defined values because they are currently
 * not used by the measurement or scorer:
 * - rangeAccuracyThreshold
 * - rampConsistencyThreshold
 *
 * The audio-analysis window is also intentionally
 * excluded because it is a DSP configuration rather
 * than an exercise-difficulty parameter.
 */

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

  /*
   * -----------------------------------------------------
   * DURATION
   * -----------------------------------------------------
   *
   * A longer controlled ramp increases the amount of
   * time over which the singer must manage the volume
   * transition.
   *
   * Higher scores -> longer ramp.
   * Lower scores -> shorter ramp.
   *
   * The adaptive range is ±20% of the tier default.
   */

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

  /*
   * -----------------------------------------------------
   * REPETITIONS
   * -----------------------------------------------------
   *
   * Higher scores -> more repetitions.
   * Lower scores -> fewer repetitions.
   *
   * Repetitions are discrete, so the generated value
   * is rounded to the nearest whole number.
   */

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

  /*
   * -----------------------------------------------------
   * TARGET dB RANGE
   * -----------------------------------------------------
   *
   * The target range is represented as:
   *
   * [minimum dB, maximum dB]
   *
   * We adapt the lower and upper bounds together so
   * the target range remains coherent.
   *
   * The target range itself is allowed to move within
   * ±20% of the tier-defined range.
   *
   * Higher scores shift the target range upward,
   * requiring stronger volume production.
   *
   * Lower scores shift the target range downward,
   * reducing the required volume level.
   */

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

  /*
   * Ensure the generated range remains valid.
   *
   * The maximum must always be greater than or equal
   * to the minimum.
   */
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

    // These thresholds are retained at their
    // tier-defined values because they are currently
    // not consumed by the measurement or scorer.
    rangeAccuracyThreshold:
      baseParams.rangeAccuracyThreshold,

    rampConsistencyThreshold:
      baseParams.rampConsistencyThreshold,
  };
}

// ============================================================
// CONTROLLED CRESCENDO
// ============================================================

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

  /*
   * Duration:
   * A longer crescendo is harder because the singer must
   * maintain a controlled increase for a longer period.
   */
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

  /*
   * Repetitions:
   * More repetitions increase the amount of controlled
   * volume work required.
   */
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

  /*
   * Target range:
   * A higher target volume range requires greater dynamic
   * control from the singer.
   */
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

    /*
     * These thresholds are scoring criteria rather than
     * exercise parameters, so they remain fixed for the tier.
     */
    smoothnessThreshold:
      baseParams.smoothnessThreshold,

    volumeIncreaseThreshold:
      baseParams.volumeIncreaseThreshold,
  };
}

// ============================================================
// CONTROLLED DECRESCENDO
// ============================================================

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

  /*
   * Duration:
   * A longer decrescendo is harder because the singer must
   * maintain a controlled decrease for a longer period.
   */
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

  /*
   * Repetitions:
   * More repetitions increase the amount of controlled
   * volume work required.
   */
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

  /*
   * Target range:
   * A higher target volume range requires greater volume
   * control from the singer before performing the decrease.
   */
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

  /*
   * Volume decrease threshold:
   * A larger required decrease makes the decrescendo
   * more demanding.
   *
   * Higher scores -> larger required decrease.
   * Lower scores -> smaller required decrease.
   */
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

    /*
     * Smoothness remains fixed at the tier-defined value
     * because it is a scoring criterion.
     */
    smoothnessThreshold:
      baseParams.smoothnessThreshold,

    volumeDecreaseThreshold:
      Number(
        generatedVolumeDecreaseThreshold.toFixed(2),
      ),
  };
}

// ============================================================
// VOLUME BAND TARGETING
// ============================================================
//
// Continuous ADS adjusts:
// - duration
// - repetitions
// - target dB range
// - tolerance
//
// Higher scores:
// - increase duration
// - increase repetitions
// - shift the target range upward
// - decrease tolerance
//
// Lower scores:
// - decrease duration
// - decrease repetitions
// - shift the target range downward
// - increase tolerance
//
// Each adaptive parameter is allowed to move within
// ±20% of the current tier's default value.
//
// The consistency threshold remains fixed at the
// tier-defined value because it is a scoring criterion,
// not an exercise-generation parameter.
//

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

  /*
   * ---------------------------------------------------------
   * DURATION
   * ---------------------------------------------------------
   *
   * A longer holding period requires the singer to maintain
   * volume control for longer.
   */
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

  /*
   * ---------------------------------------------------------
   * REPETITIONS
   * ---------------------------------------------------------
   *
   * More repetitions increase the amount of controlled
   * volume work required.
   */
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

  /*
   * ---------------------------------------------------------
   * TARGET dB RANGE
   * ---------------------------------------------------------
   *
   * Higher scores shift the target range upward,
   * requiring stronger volume production.
   *
   * Lower scores shift the target range downward.
   */
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

  /*
   * ---------------------------------------------------------
   * TOLERANCE
   * ---------------------------------------------------------
   *
   * Smaller tolerance means the singer has to stay closer
   * to the target volume band.
   *
   * Therefore:
   *
   * Higher scores -> smaller tolerance.
   * Lower scores -> larger tolerance.
   */
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

    /*
     * This remains the tier-defined scoring criterion.
     */
    consistencyThreshold:
      baseParams.consistencyThreshold,
  };
}

// ============================================================
// VOLUME CONTROL STABILITY
// ============================================================
//
// Continuous ADS adjusts:
// - duration
// - repetitions
// - stability threshold
//
// Higher scores:
// - increase duration
// - increase repetitions
// - increase the required stability threshold
//
// Lower scores:
// - decrease duration
// - decrease repetitions
// - decrease the required stability threshold
//
// The following parameters remain fixed at their
// tier-defined values because they are currently
// not consumed by the measurement or scorer:
// - targetDbRange
// - amplitudeVariancePct
// - detectionThreshold
//
// Each adaptive numeric parameter is allowed to move
// within ±20% of the current tier's default value.
// ============================================================

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

  /*
   * ---------------------------------------------------------
   * DURATION
   * ---------------------------------------------------------
   *
   * A longer sustained-volume exercise requires the singer
   * to maintain stable vocal output for a longer period.
   *
   * Higher scores -> longer duration.
   * Lower scores -> shorter duration.
   */

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

  /*
   * ---------------------------------------------------------
   * REPETITIONS
   * ---------------------------------------------------------
   *
   * More repetitions increase the amount of sustained
   * volume-control work required.
   */

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

  /*
   * ---------------------------------------------------------
   * STABILITY THRESHOLD
   * ---------------------------------------------------------
   *
   * A higher stability threshold requires the singer to
   * maintain more consistent volume.
   *
   * Higher scores -> stricter stability requirement.
   * Lower scores -> more attainable stability requirement.
   */

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

    /*
     * Retained at the tier-defined value because the
     * current measurement/scoring implementation does
     * not consume targetDbRange as a scoring criterion.
     */
    targetDbRange:
      baseParams.targetDbRange,

    /*
     * Retained at the tier-defined value because
     * amplitudeVariancePct is currently displayed as
     * an exercise reference but is not used directly
     * by the measurement/scorer.
     */
    amplitudeVariancePct:
      baseParams.amplitudeVariancePct,

    /*
     * Signal-processing configuration is intentionally
     * not adapted.
     */
    detectionThreshold:
      baseParams.detectionThreshold,
  };
}

// ============================================================
// RAPID NOTE TRANSITION
// ============================================================
//
// Continuous ADS adjusts:
// - minimum note count
// - maximum note count
// - minimum transition speed
// - maximum transition speed
// - repetitions
// - note duration
//
// Higher scores:
// - increase the number of notes
// - increase transition speed
// - increase repetitions
// - decrease note duration
//
// Lower scores:
// - decrease the number of notes
// - decrease transition speed
// - decrease repetitions
// - increase note duration
//
// The following parameters remain fixed at their
// tier-defined values:
// - accuracyThreshold
// - minMidi
// - maxMidi
//
// Each adaptive numeric parameter is allowed to move
// within ±20% of the current tier's default value.
// ============================================================

export interface GenerateRapidNoteTransitionParamsInput {
  tier: Tier;
  recentScores: number[];
}

export function generateRapidNoteTransitionParams({
  tier,
  recentScores,
}: GenerateRapidNoteTransitionParamsInput) {
  const baseParams =
    RAPID_NOTE_TRANSITION_PARAMS[tier];

  /*
   * ---------------------------------------------------------
   * MINIMUM NOTE COUNT
   * ---------------------------------------------------------
   *
   * Higher scores -> more required notes.
   * Lower scores -> fewer required notes.
   */

  const minNotesRange = {
    min: baseParams.minNotes * 0.8,
    max: baseParams.minNotes * 1.2,
  };

  const adjustedMinNotes =
    calculateAdjustedParameterBounds(
      recentScores,
      minNotesRange,
      'higher',
    );

  const generatedMinNotes =
    Math.max(
      1,
      Math.round(
        (
          adjustedMinNotes.min +
          adjustedMinNotes.max
        ) / 2,
      ),
    );

  /*
   * ---------------------------------------------------------
   * MAXIMUM NOTE COUNT
   * ---------------------------------------------------------
   *
   * Higher scores -> more possible notes.
   * Lower scores -> fewer possible notes.
   */

  const maxNotesRange = {
    min: baseParams.maxNotes * 0.8,
    max: baseParams.maxNotes * 1.2,
  };

  const adjustedMaxNotes =
    calculateAdjustedParameterBounds(
      recentScores,
      maxNotesRange,
      'higher',
    );

  const generatedMaxNotes =
    Math.max(
      generatedMinNotes,
      Math.round(
        (
          adjustedMaxNotes.min +
          adjustedMaxNotes.max
        ) / 2,
      ),
    );

  /*
   * ---------------------------------------------------------
   * MINIMUM TRANSITION SPEED
   * ---------------------------------------------------------
   *
   * Higher scores -> faster minimum speed.
   * Lower scores -> slower minimum speed.
   */

  const minSpeedRange = {
    min: baseParams.minSpeed * 0.8,
    max: baseParams.minSpeed * 1.2,
  };

  const adjustedMinSpeed =
    calculateAdjustedParameterBounds(
      recentScores,
      minSpeedRange,
      'higher',
    );

  const generatedMinSpeed =
    (
      adjustedMinSpeed.min +
      adjustedMinSpeed.max
    ) / 2;

  /*
   * ---------------------------------------------------------
   * MAXIMUM TRANSITION SPEED
   * ---------------------------------------------------------
   *
   * Higher scores -> faster maximum speed.
   * Lower scores -> slower maximum speed.
   */

  const maxSpeedRange = {
    min: baseParams.maxSpeed * 0.8,
    max: baseParams.maxSpeed * 1.2,
  };

  const adjustedMaxSpeed =
    calculateAdjustedParameterBounds(
      recentScores,
      maxSpeedRange,
      'higher',
    );

  const generatedMaxSpeed =
    (
      adjustedMaxSpeed.min +
      adjustedMaxSpeed.max
    ) / 2;

  /*
   * ---------------------------------------------------------
   * REPETITIONS
   * ---------------------------------------------------------
   *
   * Higher scores -> more repetitions.
   * Lower scores -> fewer repetitions.
   */

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

  /*
   * ---------------------------------------------------------
   * NOTE DURATION
   * ---------------------------------------------------------
   *
   * Shorter notes require faster and more precise
   * transitions.
   *
   * Higher scores -> shorter note duration.
   * Lower scores -> longer note duration.
   */

  const noteDurationRange = {
    min: baseParams.noteDurationSec * 0.8,
    max: baseParams.noteDurationSec * 1.2,
  };

  const adjustedNoteDuration =
    calculateAdjustedParameterBounds(
      recentScores,
      noteDurationRange,
      'lower',
    );

  const generatedNoteDurationSec =
    (
      adjustedNoteDuration.min +
      adjustedNoteDuration.max
    ) / 2;

  /*
   * ---------------------------------------------------------
   * RETURN
   * ---------------------------------------------------------
   */

  return {
    ...baseParams,

    minNotes:
      generatedMinNotes,

    maxNotes:
      generatedMaxNotes,

    minSpeed: Number(
  Math.min(
    generatedMinSpeed,
    generatedMaxSpeed,
  ).toFixed(2),
),

maxSpeed: Number(
  Math.max(
    generatedMinSpeed,
    generatedMaxSpeed,
  ).toFixed(2),
),

    repetitions:
      generatedRepetitions,

    noteDurationSec:
      Number(
        generatedNoteDurationSec.toFixed(2),
      ),

    // Retained at the tier-defined value because
    // this is a scoring criterion.
    accuracyThreshold:
      baseParams.accuracyThreshold,

    // Retained at the tier-defined values because
    // they define the exercise's pitch range.
    minMidi:
      baseParams.minMidi,

    maxMidi:
      baseParams.maxMidi,
  };
}

// ============================================================
// RAPID SCALE TRILL
// ============================================================
//
// Continuous ADS adjusts:
// - note duration
//
// Higher scores:
// - decrease note duration
//
// Lower scores:
// - increase note duration
//
// The following parameters remain fixed at their
// tier-defined values:
// - label
// - frequencies
// - speedLabel
//
// The adaptive note duration is allowed to move
// within ±20% of the current tier's default value.
// ============================================================

export interface GenerateRapidScaleTrillParamsInput {
  tier: Tier;
  recentScores: number[];
}

export function generateRapidScaleTrillParams({
  tier,
  recentScores,
}: GenerateRapidScaleTrillParamsInput) {
  const baseParams =
    RAPID_SCALE_TRILL_PARAMS[tier];

  /*
   * ---------------------------------------------------------
   * NOTE DURATION
   * ---------------------------------------------------------
   *
   * Shorter notes require faster and more precise
   * execution of the rapid scale pattern.
   *
   * Higher scores -> shorter notes.
   * Lower scores -> longer notes.
   *
   * The adaptive range is ±20% of the current
   * tier's default note duration.
   */

  const noteDurationRange = {
    min:
      baseParams.noteDurationSec * 0.8,

    max:
      baseParams.noteDurationSec * 1.2,
  };

  const adjustedNoteDuration =
    calculateAdjustedParameterBounds(
      recentScores,
      noteDurationRange,
      'lower',
    );

  const generatedNoteDurationSec =
    (
      adjustedNoteDuration.min +
      adjustedNoteDuration.max
    ) / 2;

  /*
   * ---------------------------------------------------------
   * RETURN
   * ---------------------------------------------------------
   */

  return {
    ...baseParams,

    noteDurationSec:
      Number(
        generatedNoteDurationSec.toFixed(2),
      ),

    // Retained at the tier-defined values because
    // these define the musical material and displayed
    // difficulty of the exercise.
    label:
      baseParams.label,

    frequencies:
      baseParams.frequencies,

    speedLabel:
      baseParams.speedLabel,
  };
}

// ============================================================
// ARPEGGIO SPEED DRILL
// ============================================================
//
// Continuous ADS adjusts:
// - note duration
// - gap duration
//
// Higher scores:
// - decrease note duration
// - decrease gap duration
//
// Lower scores:
// - increase note duration
// - increase gap duration
//
// The following parameters remain fixed at their
// tier-defined values:
// - name
// - notes
// - frequencies
// - speedLabel
//
// Each adaptive numeric parameter is allowed to move
// within ±20% of the current tier's default value.
// ============================================================

export interface GenerateArpeggioSpeedDrillParamsInput {
  tier: Tier;
  recentScores: number[];
}

export function generateArpeggioSpeedDrillParams({
  tier,
  recentScores,
}: GenerateArpeggioSpeedDrillParamsInput) {
  const baseParams =
    ARPEGGIO_SPEED_DRILL_PARAMS[tier];

  /*
   * ---------------------------------------------------------
   * NOTE DURATION
   * ---------------------------------------------------------
   *
   * Shorter notes require faster and more precise
   * execution of the arpeggio.
   *
   * Higher scores -> shorter notes.
   * Lower scores -> longer notes.
   */

  const noteDurationRange = {
    min:
      baseParams.noteDurationSec * 0.8,

    max:
      baseParams.noteDurationSec * 1.2,
  };

  const adjustedNoteDuration =
    calculateAdjustedParameterBounds(
      recentScores,
      noteDurationRange,
      'lower',
    );

  const generatedNoteDurationSec =
    (
      adjustedNoteDuration.min +
      adjustedNoteDuration.max
    ) / 2;

  /*
   * ---------------------------------------------------------
   * GAP DURATION
   * ---------------------------------------------------------
   *
   * A shorter gap reduces the recovery time between
   * notes and requires more precise transitions.
   *
   * Higher scores -> shorter gaps.
   * Lower scores -> longer gaps.
   */

  const gapRange = {
    min:
      baseParams.gapSec * 0.8,

    max:
      baseParams.gapSec * 1.2,
  };

  const adjustedGap =
    calculateAdjustedParameterBounds(
      recentScores,
      gapRange,
      'lower',
    );

  const generatedGapSec =
    (
      adjustedGap.min +
      adjustedGap.max
    ) / 2;

  /*
   * ---------------------------------------------------------
   * RETURN
   * ---------------------------------------------------------
   */

  return {
    ...baseParams,

    noteDurationSec:
      Number(
        generatedNoteDurationSec.toFixed(2),
      ),

    gapSec:
      Number(
        generatedGapSec.toFixed(2),
      ),

    // Retained at the tier-defined values because
    // these define the musical material of the exercise.
    name:
      baseParams.name,

    notes:
      baseParams.notes,

    frequencies:
      baseParams.frequencies,

    speedLabel:
      baseParams.speedLabel,
  };
}

// ============================================================
// QUICK INTERVAL JUMP
// ============================================================
//
// Continuous ADS adjusts:
// - note duration
// - gap duration
//
// Higher scores:
// - decrease note duration
// - decrease gap duration
//
// Lower scores:
// - increase note duration
// - increase gap duration
//
// The following parameters remain fixed at their
// tier-defined values:
// - label
// - frequencies
// - speedLabel
// - accuracyThreshold
//
// The adaptive timing parameters use the same
// ±20% range applied by the other exercise generators.
// ============================================================

export interface GenerateQuickIntervalJumpParamsInput {
  tier: Tier;
  recentScores: number[];
}

export function generateQuickIntervalJumpParams({
  tier,
  recentScores,
}: GenerateQuickIntervalJumpParamsInput) {
  const baseParams =
    QUICK_INTERVAL_JUMP_PARAMS[tier];

  /*
   * ---------------------------------------------------------
   * NOTE DURATION
   * ---------------------------------------------------------
   *
   * Shorter notes require faster and more precise
   * interval transitions.
   *
   * Higher scores -> shorter notes.
   * Lower scores -> longer notes.
   *
   * The current Quick Interval Jump screen uses
   * 0.30 seconds as its reference-note duration.
   */

  const baseNoteDurationSec = 0.30;

  const noteDurationRange = {
    min: baseNoteDurationSec * 0.8,
    max: baseNoteDurationSec * 1.2,
  };

  const adjustedNoteDuration =
    calculateAdjustedParameterBounds(
      recentScores,
      noteDurationRange,
      'lower',
    );

  const generatedNoteDurationSec =
    (
      adjustedNoteDuration.min +
      adjustedNoteDuration.max
    ) / 2;

  /*
   * ---------------------------------------------------------
   * GAP DURATION
   * ---------------------------------------------------------
   *
   * A shorter gap gives the singer less recovery time
   * between interval jumps.
   *
   * Higher scores -> shorter gaps.
   * Lower scores -> longer gaps.
   *
   * The current Quick Interval Jump screen uses
   * 350 ms between reference notes.
   */

  const baseGapSec = 0.35;

  const gapRange = {
    min: baseGapSec * 0.8,
    max: baseGapSec * 1.2,
  };

  const adjustedGap =
    calculateAdjustedParameterBounds(
      recentScores,
      gapRange,
      'lower',
    );

  const generatedGapSec =
    (
      adjustedGap.min +
      adjustedGap.max
    ) / 2;

  return {
    ...baseParams,

    noteDurationSec:
      Number(
        generatedNoteDurationSec.toFixed(2),
      ),

    gapSec:
      Number(
        generatedGapSec.toFixed(2),
      ),

    // Retained at the tier-defined values because
    // these define the musical material and scoring
    // requirement of the exercise.
    label:
      baseParams.label,

    frequencies:
      baseParams.frequencies,

    speedLabel:
      baseParams.speedLabel,

    accuracyThreshold:
      baseParams.accuracyThreshold,
  };
}

// ============================================================
// VOCAL RUN ACCURACY TASK
// ============================================================
//
// Continuous ADS adjusts:
// - note duration
//
// Higher scores:
// - decrease note duration
//
// Lower scores:
// - increase note duration
//
// The following parameters remain fixed at their
// tier-defined values:
// - label
// - frequencies
// - speedLabel
// - accuracyThreshold
//
// The adaptive note duration is allowed to move within
// ±20% of the current tier's default value.
// ============================================================

export interface GenerateVocalRunAccuracyParamsInput {
  tier: Tier;
  recentScores: number[];
}

export function generateVocalRunAccuracyParams({
  tier,
  recentScores,
}: GenerateVocalRunAccuracyParamsInput) {
  const baseParams =
    RAPID_VOCAL_RUN_PARAMS[tier];

  /*
   * ---------------------------------------------------------
   * NOTE DURATION
   * ---------------------------------------------------------
   *
   * Shorter notes require the singer to execute the
   * vocal run more quickly and accurately.
   *
   * Higher scores -> shorter notes.
   * Lower scores -> longer notes.
   *
   * The adaptive range is ±20% of the current
   * tier's default note duration.
   */

  const noteDurationRange = {
    min:
      baseParams.noteDurationSec * 0.8,

    max:
      baseParams.noteDurationSec * 1.2,
  };

  const adjustedNoteDuration =
    calculateAdjustedParameterBounds(
      recentScores,
      noteDurationRange,
      'lower',
    );

  const generatedNoteDurationSec =
    (
      adjustedNoteDuration.min +
      adjustedNoteDuration.max
    ) / 2;

  /*
   * ---------------------------------------------------------
   * RETURN
   * ---------------------------------------------------------
   */

  return {
  ...baseParams,
  noteDurationSec: Number(generatedNoteDurationSec.toFixed(2)),
  label: baseParams.label,
  frequencies: baseParams.frequencies,
  speedLabel: baseParams.speedLabel,
  accuracyThreshold: baseParams.accuracyThreshold,
  repetitions: baseParams.repetitions,
};
}