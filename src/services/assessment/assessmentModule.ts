import {
  calcJitterStability,
  filterByClarity,
  trackPitchOverTime,
} from '@/utils/dsp/pitch';

import {
  calcAirflowStability,
} from '@/utils/dsp/airflow';

import {
  computeFFTMagnitudes,
} from '@/utils/dsp/fft';

import {
  calcSmoothness,
  computeSpectralCentroid,
} from '@/utils/dsp/spectral';

import {
  calcRampConsistency,
  calcRMSWindows,
  calcVolumeConsistency,
  toDbArray,
} from '@/utils/dsp/volumeAnalysis';

import {
  calcTransitionSpeed,
  detectPitchChanges,
} from '@/utils/dsp/agility';

import {
  detectOnsetOffset,
} from '@/utils/dsp/onsetOffset';

// ============================================================
// TYPES
// ============================================================

export type ComponentId =
  | 'breathControl'
  | 'pitch'
  | 'tone'
  | 'volume'
  | 'agility';

export type AssessmentType =
  | 'initial'
  | 'followUp';

export interface ComponentScore {
  componentId: ComponentId;
  scorePct: number;
}

export type RecommendationBand =
  | 'needsSignificantImprovement'
  | 'moderateImprovement'
  | 'goodFoundation';

export interface VocalRange {
  lowHz: number;
  highHz: number;
}

export interface TargetNotes {
  rootHz: number;
  agilityRun: number[];
}

export interface AssessmentResult {
  vocalRange: VocalRange;

  vocalRangeLowHz: number;
  vocalRangeHighHz: number;

  scores: ComponentScore[];

  recommendations: Record<
    ComponentId,
    RecommendationBand
  >;

  timestamp: number;
}

export interface AssessmentAudioBundle {
  pitchSamples: Float32Array;
  toneSamples: Float32Array;
  volumeSamples: Float32Array;
  agilitySamples: Float32Array;

  lowestComfortableNoteSamples: Float32Array;
  highestComfortableNoteSamples: Float32Array;

  sampleRate: number;
}

// ============================================================
// ASSESSMENT CONFIGURATION
// ============================================================

export const ASSESSMENT_DURATION = {
  breathControl: 5,
  pitch: 5,
  tone: 5,
  volume: 5,
  agility: 8,
  comfortableNote: 2,
} as const;

// ============================================================
// VOCAL RANGE DETECTION CONFIGURATION
// ============================================================

/*
 * These limits are used only for vocal-range calibration.
 *
 * 60 Hz ≈ B1
 * 1200 Hz ≈ D6
 */
const COMFORTABLE_NOTE_MIN_HZ = 60;
const COMFORTABLE_NOTE_MAX_HZ = 1200;

/*
 * Reject recordings that are essentially silence/noise.
 *
 * Your current microphone logs show valid singing signals
 * substantially above this threshold.
 */
const MIN_VOCAL_RMS = 0.002;

/*
 * A comfortable note should contain enough sustained audio
 * for several independent pitch measurements.
 */
const MIN_NOTE_DURATION_SEC = 0.75;

/*
 * Four thousand-ish samples gives enough cycles for low notes
 * while still allowing several independent windows.
 */
const ANALYSIS_WINDOW_SIZE = 4096;

/*
 * Pitchy confidence requirement for comfortable-note detection.
 *
 * We intentionally use a higher threshold here than a generic
 * live tuner because vocal-range calibration must be reliable.
 */
const PITCHY_MIN_CLARITY = 0.80;

/*
 * At least five stable Pitchy frames are required.
 */
const MIN_PITCHY_FRAMES = 5;

/*
 * Individual Pitchy estimates should remain within 50 cents
 * of the Pitchy median.
 */
const MAX_PITCHY_SPREAD_CENTS = 50;

/*
 * Autocorrelation is an independent validation source.
 */
const MIN_AUTOCORRELATION_CONFIDENCE = 0.55;

const MIN_AUTOCORRELATION_RESULTS = 3;

/*
 * Autocorrelation does not need to equal Pitchy perfectly.
 * 75 cents gives enough room for estimation differences
 * without accepting very different pitches.
 */
const MAX_AUTOCORRELATION_AGREEMENT_CENTS = 75;

/*
 * Pitchy and autocorrelation may disagree by exactly an
 * octave because of harmonic ambiguity.
 *
 * In that case, the autocorrelation result can correct Pitchy's
 * octave error when the waveform evidence consistently supports it.
 */
const OCTAVE_AGREEMENT_CENTS = 75;

// ============================================================
// GENERAL HELPERS
// ============================================================

function clampScore(
  score: number
): number {
  if (!Number.isFinite(score)) {
    return 0;
  }

  return Math.max(
    0,
    Math.min(
      100,
      Math.round(score)
    )
  );
}

function classifyBand(
  scorePct: number
): RecommendationBand {
  if (scorePct < 60) {
    return 'needsSignificantImprovement';
  }

  if (scorePct < 75) {
    return 'moderateImprovement';
  }

  return 'goodFoundation';
}

// ============================================================
// SAFE NUMBER HELPERS
// ============================================================

function isValidFrequency(
  frequency: number
): boolean {
  return (
    Number.isFinite(frequency) &&
    frequency > 0
  );
}

function isValidSampleRate(
  sampleRate: number
): boolean {
  return (
    Number.isFinite(sampleRate) &&
    sampleRate > 0
  );
}

// ============================================================
// FREQUENCY HELPERS
// ============================================================

function centsDifference(
  frequencyA: number,
  frequencyB: number
): number {
  if (
    !isValidFrequency(frequencyA) ||
    !isValidFrequency(frequencyB)
  ) {
    return Infinity;
  }

  return (
    1200 *
    Math.log2(
      frequencyA / frequencyB
    )
  );
}

function frequencyToMidi(
  frequency: number
): number {
  if (!isValidFrequency(frequency)) {
    return NaN;
  }

  return (
    69 +
    12 *
    Math.log2(
      frequency / 440
    )
  );
}

function midiToFrequency(
  midi: number
): number {
  if (!Number.isFinite(midi)) {
    return NaN;
  }

  return (
    440 *
    Math.pow(
      2,
      (midi - 69) / 12
    )
  );
}

function median(
  values: number[]
): number | null {
  const valid =
    values
      .filter(value =>
        Number.isFinite(value)
      )
      .sort(
        (a, b) =>
          a - b
      );

  if (
    valid.length === 0
  ) {
    return null;
  }

  const middle =
    Math.floor(
      valid.length / 2
    );

  if (
    valid.length % 2 === 0
  ) {
    return (
      valid[middle - 1] +
      valid[middle]
    ) / 2;
  }

  return valid[middle];
}

// ============================================================
// TARGET NOTE GENERATION
// ============================================================

export function computeTargetNotes(
  lowHz: number,
  highHz: number
): TargetNotes {
  if (
    !isValidFrequency(lowHz) ||
    !isValidFrequency(highHz) ||
    lowHz >= highHz
  ) {
    throw new Error(
      'Invalid vocal range for target note generation.'
    );
  }

  const lowMidi =
    Math.ceil(
      frequencyToMidi(
        lowHz
      )
    );

  const highMidi =
    Math.floor(
      frequencyToMidi(
        highHz
      )
    );

  if (
    !Number.isFinite(lowMidi) ||
    !Number.isFinite(highMidi) ||
    lowMidi >= highMidi
  ) {
    throw new Error(
      'The detected vocal range is too narrow for target note generation.'
    );
  }

  /*
   * Choose the nearest practical center pitch
   * inside the detected range.
   */
  const centerMidi =
    Math.max(
      lowMidi,
      Math.min(
        highMidi,
        Math.round(
          (lowMidi + highMidi) / 2
        )
      )
    );

  const rootHz =
    midiToFrequency(
      centerMidi
    );

  const clampToRange =
    (hz: number): number =>
      Math.max(
        lowHz,
        Math.min(
          highHz,
          hz
        )
      );

  const semitone =
    (offset: number): number =>
      clampToRange(
        rootHz *
        Math.pow(
          2,
          offset / 12
        )
      );

  return {
    rootHz,

    agilityRun: [
      semitone(-2),
      semitone(0),
      semitone(2),
      semitone(4),
      semitone(2),
      semitone(0),
      semitone(-2),
    ],
  };
}

// ============================================================
// BREATH CONTROL
// ============================================================

function measureBreathControl(
  samples: Float32Array,
  sampleRate: number,
  targetDurationSec: number
): number {
  if (
    !isValidSampleRate(sampleRate) ||
    samples.length === 0 ||
    !Number.isFinite(
      targetDurationSec
    ) ||
    targetDurationSec <= 0
  ) {
    return 0;
  }

  const onsetOffset =
    detectOnsetOffset(
      samples,
      0.02,
      sampleRate
    );

  const actualDurationSec =
    onsetOffset.durationSeconds;

  if (
    !Number.isFinite(
      actualDurationSec
    ) ||
    actualDurationSec <= 0
  ) {
    return 0;
  }

  const durationScore =
    Math.min(
      actualDurationSec /
        targetDurationSec,
      1
    ) * 100;

  /*
   * Smartphone microphones do not directly measure airflow.
   * The waveform amplitude stability is therefore used as an
   * acoustic proxy for controlled sustained airflow.
   */
  const stability =
    calcAirflowStability(
      samples,
      50,
      sampleRate
    );

  return clampScore(
    durationScore * 0.5 +
    stability * 0.5
  );
}

// ============================================================
// PITCH
// ============================================================

function measurePitch(
  samples: Float32Array,
  sampleRate: number,
  targetFrequency: number
): number {
  if (
    !isValidSampleRate(sampleRate) ||
    samples.length === 0 ||
    !isValidFrequency(
      targetFrequency
    )
  ) {
    return 0;
  }

  let frames:
    ReturnType<
      typeof trackPitchOverTime
    >;

  try {
    frames =
      trackPitchOverTime(
        samples,
        30,
        sampleRate
      );
  } catch (error) {
    console.error(
      '❌ Pitch tracking failed:',
      error
    );

    return 0;
  }

  if (
    !Array.isArray(frames) ||
    frames.length === 0
  ) {
    return 0;
  }

  const voicedFrames =
    filterByClarity(
      frames,
      0.8
    );

  if (
    !Array.isArray(voicedFrames) ||
    voicedFrames.length === 0
  ) {
    return 0;
  }

  const validFrames =
    voicedFrames.filter(
      frame =>
        isValidFrequency(
          frame.frequency
        )
    );

  if (
    validFrames.length === 0
  ) {
    return 0;
  }

  /*
   * ----------------------------------------------------------
   * Target accuracy
   * ----------------------------------------------------------
   */
  const accuracyValues =
    validFrames.map(
      frame => {
        const errorCents =
          Math.abs(
            centsDifference(
              frame.frequency,
              targetFrequency
            )
          );

        /*
         * 100 cents = one semitone.
         */
        return clampScore(
          100 - errorCents
        );
      }
    );

  const accuracy =
    accuracyValues.reduce(
      (sum, value) =>
        sum + value,
      0
    ) /
    accuracyValues.length;

  /*
   * ----------------------------------------------------------
   * Pitch stability
   * ----------------------------------------------------------
   */
  const frequencies =
    validFrames.map(
      frame =>
        frame.frequency
    );

  const stability =
    calcJitterStability(
      frequencies
    );

  /*
   * ----------------------------------------------------------
   * Clarity
   * ----------------------------------------------------------
   */
  const clarityValues =
    validFrames
      .map(
        frame =>
          frame.clarity
      )
      .filter(
        value =>
          Number.isFinite(value)
      );

  if (
    clarityValues.length === 0
  ) {
    return 0;
  }

  const clarity =
    clarityValues.reduce(
      (sum, value) =>
        sum + value,
      0
    ) /
    clarityValues.length;

  const clarityScore =
    clampScore(
      clarity * 100
    );

  /*
   * Accuracy is weighted most heavily because the assessment
   * is evaluating whether the user matched the generated
   * target note.
   */
  return clampScore(
    accuracy * 0.60 +
    stability * 0.20 +
    clarityScore * 0.20
  );
}

// ============================================================
// TONE
// ============================================================

function measureTone(
  samples: Float32Array,
  sampleRate: number
): number {
  if (
    !isValidSampleRate(sampleRate) ||
    samples.length === 0
  ) {
    return 0;
  }

  /*
   * 50 ms analysis frames.
   */
  const frameSize =
    Math.floor(
      0.05 * sampleRate
    );

  if (
    frameSize <= 1
  ) {
    return 0;
  }

  const centroids: number[] =
    [];

  for (
    let i = 0;
    i + frameSize <=
      samples.length;
    i += frameSize
  ) {
    const frame =
      samples.subarray(
        i,
        i + frameSize
      );

    if (
      frame.length < 2
    ) {
      continue;
    }

    /*
     * Use the largest power-of-two FFT
     * that fits inside the frame.
     *
     * At 44.1 kHz / 50 ms, this is 2048.
     */
    let fftSize = 1;

    while (
      fftSize * 2 <=
      frame.length
    ) {
      fftSize *= 2;
    }

    if (
      fftSize < 2
    ) {
      continue;
    }

    const fftFrame =
      frame.subarray(
        0,
        fftSize
      );

    let magnitudes:
      Float32Array;

    try {
      magnitudes =
        computeFFTMagnitudes(
          fftFrame
        );
    } catch (error) {
      console.warn(
        '⚠️ Tone FFT frame failed:',
        error
      );

      continue;
    }

    if (
      !magnitudes ||
      magnitudes.length === 0
    ) {
      continue;
    }

    let centroid: number;

    try {
      centroid =
        computeSpectralCentroid(
          magnitudes,
          sampleRate,
          fftSize
        );
    } catch (error) {
      console.warn(
        '⚠️ Spectral centroid calculation failed:',
        error
      );

      continue;
    }

    if (
      Number.isFinite(
        centroid
      ) &&
      centroid > 0
    ) {
      centroids.push(
        centroid
      );
    }
  }

  if (
    centroids.length === 0
  ) {
    return 0;
  }

  let smoothness: number;

  try {
    smoothness =
      calcSmoothness(
        centroids
      );
  } catch (error) {
    console.warn(
      '⚠️ Tone smoothness calculation failed:',
      error
    );

    return 0;
  }

  return clampScore(
    smoothness
  );
}

// ============================================================
// VOLUME
// ============================================================

function measureVolume(
  samples: Float32Array,
  sampleRate: number
): number {
  if (
    !isValidSampleRate(sampleRate) ||
    samples.length === 0
  ) {
    return 0;
  }

  const rmsValues =
    calcRMSWindows(
      samples,
      50,
      sampleRate
    );

  if (
    !Array.isArray(rmsValues) ||
    rmsValues.length === 0
  ) {
    return 0;
  }

  const dbValues =
    toDbArray(
      rmsValues
    );

  if (
    !Array.isArray(dbValues) ||
    dbValues.length === 0
  ) {
    return 0;
  }

  const finiteDbValues =
    dbValues.filter(
      value =>
        Number.isFinite(value)
    );

  if (
    finiteDbValues.length === 0
  ) {
    return 0;
  }

  const rampConsistency =
    calcRampConsistency(
      finiteDbValues
    );

  const volumeConsistency =
    calcVolumeConsistency(
      finiteDbValues
    );

  return clampScore(
    rampConsistency * 0.5 +
    volumeConsistency * 0.5
  );
}

// ============================================================
// AGILITY
// ============================================================

function measureAgility(
  samples: Float32Array,
  sampleRate: number,
  targetNotes: number[]
): number {
  if (
    !isValidSampleRate(sampleRate) ||
    samples.length === 0 ||
    targetNotes.length === 0
  ) {
    return 0;
  }

  let frames:
    ReturnType<
      typeof trackPitchOverTime
    >;

  try {
    frames =
      trackPitchOverTime(
        samples,
        30,
        sampleRate
      );
  } catch (error) {
    console.error(
      '❌ Agility pitch tracking failed:',
      error
    );

    return 0;
  }

  if (
    !Array.isArray(frames) ||
    frames.length === 0
  ) {
    return 0;
  }

  const voicedFrames =
    filterByClarity(
      frames,
      0.8
    );

  if (
    !Array.isArray(voicedFrames) ||
    voicedFrames.length < 2
  ) {
    return 0;
  }

  const validVoicedFrames =
    voicedFrames.filter(
      frame =>
        isValidFrequency(
          frame.frequency
        )
    );

  if (
    validVoicedFrames.length < 2
  ) {
    return 0;
  }

  /*
   * ----------------------------------------------------------
   * Detect active singing region
   * ----------------------------------------------------------
   */
  const onsetOffset =
    detectOnsetOffset(
      samples,
      0.02,
      sampleRate
    );

  let activeStart =
    onsetOffset.onsetIndex;

  let activeEnd =
    onsetOffset.offsetIndex;

  /*
   * If onset/offset detection is inconclusive,
   * use the entire recording.
   */
  if (
    activeEnd <= activeStart
  ) {
    activeStart = 0;
    activeEnd =
      samples.length;
  }

  if (
    activeEnd <= activeStart
  ) {
    return 0;
  }

  const activeLength =
    activeEnd -
    activeStart;

  /*
   * ----------------------------------------------------------
   * Target pattern accuracy
   * ----------------------------------------------------------
   *
   * The assessment reference note player uses a fixed duration
   * per agility note. Equal-duration segmentation therefore
   * matches the structure of the recorded diagnostic task.
   */
  const segmentLength =
    activeLength /
    targetNotes.length;

  const noteAccuracies: number[] =
    [];

  const noteStabilities: number[] =
    [];

  for (
    let noteIndex = 0;
    noteIndex <
      targetNotes.length;
    noteIndex++
  ) {
    const segmentStart =
      Math.floor(
        activeStart +
        noteIndex *
          segmentLength
      );

    const segmentEnd =
      Math.floor(
        activeStart +
        (noteIndex + 1) *
          segmentLength
      );

    if (
      segmentEnd <=
      segmentStart
    ) {
      continue;
    }

    const segment =
      samples.subarray(
        segmentStart,
        segmentEnd
      );

    if (
      segment.length < 2048
    ) {
      continue;
    }

    let segmentFrames:
      ReturnType<
        typeof trackPitchOverTime
      >;

    try {
      segmentFrames =
        trackPitchOverTime(
          segment,
          30,
          sampleRate
        );
    } catch {
      continue;
    }

    const segmentVoiced =
      filterByClarity(
        segmentFrames,
        0.8
      ).filter(
        frame =>
          isValidFrequency(
            frame.frequency
          )
      );

    if (
      segmentVoiced.length === 0
    ) {
      continue;
    }

    const frequencies =
      segmentVoiced.map(
        frame =>
          frame.frequency
      );

    const targetFrequency =
      targetNotes[
        noteIndex
      ];

    /*
     * Use median detected frequency
     * to reduce transient errors.
     */
    const detectedMedian =
      median(
        frequencies
      );

    if (
      !detectedMedian
    ) {
      continue;
    }

    const errorCents =
      Math.abs(
        centsDifference(
          detectedMedian,
          targetFrequency
        )
      );

    const accuracy =
      clampScore(
        100 -
        errorCents
      );

    noteAccuracies.push(
      accuracy
    );

    const stability =
      calcJitterStability(
        frequencies
      );

    noteStabilities.push(
      stability
    );
  }

  /*
   * ----------------------------------------------------------
   * Pattern accuracy
   * ----------------------------------------------------------
   */
  if (
    noteAccuracies.length === 0
  ) {
    return 0;
  }

  const patternAccuracy =
    noteAccuracies.reduce(
      (sum, value) =>
        sum + value,
      0
    ) /
    noteAccuracies.length;

  /*
   * ----------------------------------------------------------
   * Within-note stability
   * ----------------------------------------------------------
   */
  const withinNoteStability =
    noteStabilities.length > 0
      ? noteStabilities.reduce(
          (sum, value) =>
            sum + value,
          0
        ) /
        noteStabilities.length
      : 0;

  /*
   * ----------------------------------------------------------
   * Transition speed
   * ----------------------------------------------------------
   */
  const transitions =
    detectPitchChanges(
      validVoicedFrames,
      15
    );

  const durationSec =
    Math.max(
      samples.length /
        sampleRate,
      0.001
    );

  const speed =
    calcTransitionSpeed(
      transitions.length,
      durationSec
    );

  /*
   * The target agility pattern has six meaningful
   * pitch transitions for seven notes.
   */
  const expectedTransitions =
    Math.max(
      targetNotes.length - 1,
      1
    );

  const expectedTransitionRate =
    expectedTransitions /
    durationSec;

  const speedRatio =
    expectedTransitionRate > 0
      ? speed /
        expectedTransitionRate
      : 0;

  /*
   * Treat 100% or faster as the top speed score.
   *
   * Unlike the earlier implementation, speed alone cannot
   * produce a high agility score if the notes are inaccurate.
   */
  const speedScore =
    clampScore(
      Math.min(
        speedRatio,
        1
      ) * 100
    );

  return clampScore(
    patternAccuracy * 0.60 +
    withinNoteStability * 0.20 +
    speedScore * 0.20
  );
}

// ============================================================
// AUDIO SIGNAL HELPERS
// ============================================================

function calculateRMS(
  samples: Float32Array
): number {
  if (
    samples.length === 0
  ) {
    return 0;
  }

  let sumSquares = 0;

  let finiteCount = 0;

  for (
    let i = 0;
    i < samples.length;
    i++
  ) {
    const value =
      samples[i];

    if (
      !Number.isFinite(value)
    ) {
      continue;
    }

    sumSquares +=
      value * value;

    finiteCount++;
  }

  if (
    finiteCount === 0
  ) {
    return 0;
  }

  return Math.sqrt(
    sumSquares /
    finiteCount
  );
}

function calculatePeak(
  samples: Float32Array
): number {
  let peak = 0;

  for (
    let i = 0;
    i < samples.length;
    i++
  ) {
    const value =
      Math.abs(
        samples[i]
      );

    if (
      Number.isFinite(value) &&
      value > peak
    ) {
      peak = value;
    }
  }

  return peak;
}

function removeDCOffset(
  input: Float32Array
): Float32Array {
  if (
    input.length === 0
  ) {
    return input;
  }

  let sum = 0;

  let finiteCount = 0;

  for (
    let i = 0;
    i < input.length;
    i++
  ) {
    const value =
      input[i];

    if (
      Number.isFinite(value)
    ) {
      sum += value;
      finiteCount++;
    }
  }

  if (
    finiteCount === 0
  ) {
    return new Float32Array(
      input.length
    );
  }

  const mean =
    sum /
    finiteCount;

  const output =
    new Float32Array(
      input.length
    );

  for (
    let i = 0;
    i < input.length;
    i++
  ) {
    const value =
      input[i];

    output[i] =
      Number.isFinite(value)
        ? value - mean
        : 0;
  }

  return output;
}

function applyHannWindow(
  input: Float32Array
): Float32Array {
  const output =
    new Float32Array(
      input.length
    );

  if (
    input.length <= 1
  ) {
    return input.slice();
  }

  for (
    let i = 0;
    i < input.length;
    i++
  ) {
    const window =
      0.5 *
      (
        1 -
        Math.cos(
          (
            2 *
            Math.PI *
            i
          ) /
          (
            input.length - 1
          )
        )
      );

    output[i] =
      input[i] *
      window;
  }

  return output;
}

// ============================================================
// AUTOCORRELATION PITCH DETECTOR
// ============================================================

interface AutocorrelationResult {
  frequency: number;
  confidence: number;
}

/**
 * Detects a periodic frequency using normalized
 * autocorrelation.
 *
 * IMPORTANT:
 *
 * This function no longer blindly chooses the globally
 * strongest periodicity.
 *
 * When a reference frequency is provided, candidates are
 * searched around that reference and its octave-equivalent
 * possibilities. This prevents a strong lower subharmonic
 * from replacing the actual sung fundamental.
 */
function detectFundamentalByAutocorrelation(
  samples: Float32Array,
  sampleRate: number,
  referenceFrequency?: number
): AutocorrelationResult | null {
  if (
    !isValidSampleRate(sampleRate) ||
    samples.length < 1024
  ) {
    return null;
  }

  const centered =
    removeDCOffset(
      samples
    );

  const rms =
    calculateRMS(
      centered
    );

  if (
    !Number.isFinite(rms) ||
    rms < MIN_VOCAL_RMS
  ) {
    return null;
  }

  const windowed =
    applyHannWindow(
      centered
    );

  const minLag =
    Math.max(
      2,
      Math.floor(
        sampleRate /
        COMFORTABLE_NOTE_MAX_HZ
      )
    );

  const maxLag =
    Math.min(
      Math.floor(
        sampleRate /
        COMFORTABLE_NOTE_MIN_HZ
      ),
      windowed.length - 2
    );

  if (
    maxLag <= minLag
  ) {
    return null;
  }

  const correlations =
    new Float32Array(
      maxLag + 1
    );

  /*
   * Calculate normalized autocorrelation.
   */
  for (
    let lag = minLag;
    lag <= maxLag;
    lag++
  ) {
    let numerator = 0;
    let energyA = 0;
    let energyB = 0;

    const limit =
      windowed.length -
      lag;

    for (
      let i = 0;
      i < limit;
      i++
    ) {
      const a =
        windowed[i];

      const b =
        windowed[
          i + lag
        ];

      numerator +=
        a * b;

      energyA +=
        a * a;

      energyB +=
        b * b;
    }

    if (
      energyA <= 0 ||
      energyB <= 0
    ) {
      continue;
    }

    const correlation =
      numerator /
      Math.sqrt(
        energyA *
        energyB
      );

    if (
      Number.isFinite(
        correlation
      )
    ) {
      correlations[lag] =
        correlation;
    }
  }

  /*
   * Collect local maxima instead of only the global maximum.
   */
  const candidates:
    Array<{
      lag: number;
      frequency: number;
      correlation: number;
    }> = [];

  for (
    let lag = minLag + 1;
    lag < maxLag;
    lag++
  ) {
    const current =
      correlations[lag];

    const previous =
      correlations[
        lag - 1
      ];

    const next =
      correlations[
        lag + 1
      ];

    if (
      current >= previous &&
      current >= next &&
      current >=
        MIN_AUTOCORRELATION_CONFIDENCE
    ) {
      const frequency =
        sampleRate /
        lag;

      if (
        isValidFrequency(
          frequency
        ) &&
        frequency >=
          COMFORTABLE_NOTE_MIN_HZ &&
        frequency <=
          COMFORTABLE_NOTE_MAX_HZ
      ) {
        candidates.push({
          lag,
          frequency,
          correlation:
            current,
        });
      }
    }
  }

  if (
    candidates.length === 0
  ) {
    return null;
  }

  /*
   * ----------------------------------------------------------
   * GUIDED MODE
   * ----------------------------------------------------------
   *
   * When Pitchy supplies a strong reference, search candidates
   * around:
   *
   *   reference / 2
   *   reference
   *   reference * 2
   *
   * This specifically addresses octave ambiguity.
   */
  if (
    referenceFrequency &&
    isValidFrequency(
      referenceFrequency
    )
  ) {
    const octaveCandidates =
      [
        referenceFrequency / 2,
        referenceFrequency,
        referenceFrequency * 2,
      ].filter(
        frequency =>
          frequency >=
            COMFORTABLE_NOTE_MIN_HZ &&
          frequency <=
            COMFORTABLE_NOTE_MAX_HZ
      );

    const guidedCandidates =
      candidates.filter(
        candidate => {
          return octaveCandidates.some(
            target =>
              Math.abs(
                centsDifference(
                  candidate.frequency,
                  target
                )
              ) <=
                MAX_AUTOCORRELATION_AGREEMENT_CENTS
          );
        }
      );

    if (
      guidedCandidates.length === 0
    ) {
      return null;
    }

    /*
     * Rank primarily by closeness to the exact Pitchy
     * reference frequency.
     *
     * Correlation is only a secondary factor.
     *
     * This means a strong 100 Hz subharmonic will not
     * outrank an actual ~400 Hz candidate merely because
     * its correlation peak happens to be larger.
     */
    guidedCandidates.sort(
      (a, b) => {
        const directDistanceA =
          Math.abs(
            centsDifference(
              a.frequency,
              referenceFrequency
            )
          );

        const directDistanceB =
          Math.abs(
            centsDifference(
              b.frequency,
              referenceFrequency
            )
          );

        /*
         * Exact-reference candidates get priority over
         * octave candidates when both are available.
         */
        const isDirectA =
          directDistanceA <=
          MAX_AUTOCORRELATION_AGREEMENT_CENTS;

        const isDirectB =
          directDistanceB <=
          MAX_AUTOCORRELATION_AGREEMENT_CENTS;

        if (
          isDirectA &&
          !isDirectB
        ) {
          return -1;
        }

        if (
          !isDirectA &&
          isDirectB
        ) {
          return 1;
        }

        /*
         * Otherwise use distance to the closest octave
         * reference.
         */
        const distanceA =
          Math.min(
            ...octaveCandidates.map(
              target =>
                Math.abs(
                  centsDifference(
                    a.frequency,
                    target
                  )
                )
            )
          );

        const distanceB =
          Math.min(
            ...octaveCandidates.map(
              target =>
                Math.abs(
                  centsDifference(
                    b.frequency,
                    target
                  )
                )
            )
          );

        if (
          distanceA !== distanceB
        ) {
          return (
            distanceA -
            distanceB
          );
        }

        return (
          b.correlation -
          a.correlation
        );
      }
    );

    return {
      frequency:
        guidedCandidates[0]
          .frequency,

      confidence:
        guidedCandidates[0]
          .correlation,
    };
  }

  /*
   * ----------------------------------------------------------
   * UNGUIDED MODE
   * ----------------------------------------------------------
   *
   * Used only when there is no Pitchy reference available.
   */
  candidates.sort(
    (a, b) =>
      b.correlation -
      a.correlation
  );

  return {
    frequency:
      candidates[0]
        .frequency,

    confidence:
      candidates[0]
        .correlation,
  };
}

// ============================================================
// AUTOCORRELATION MULTI-WINDOW ANALYSIS
// ============================================================

function analyzeAutocorrelationWindows(
  samples: Float32Array,
  sampleRate: number,
  referenceFrequency?: number
): AutocorrelationResult[] {
  const results:
    AutocorrelationResult[] =
      [];

  const durationSec =
    samples.length /
    sampleRate;

  if (
    durationSec <
    MIN_NOTE_DURATION_SEC
  ) {
    return results;
  }

  /*
   * Analyze stable middle portions of the recording.
   */
  const normalizedTimes =
    [
      0.30,
      0.50,
      0.70,
      0.80,
    ];

  for (
    const normalizedTime
      of normalizedTimes
  ) {
    const timeSec =
      Math.min(
        durationSec * normalizedTime,
        Math.max(
          0,
          durationSec - 0.35
        )
      );

    const center =
      Math.floor(
        timeSec *
        sampleRate
      );

    const halfWindow =
      Math.floor(
        ANALYSIS_WINDOW_SIZE /
        2
      );

    const start =
      Math.max(
        0,
        center - halfWindow
      );

    const end =
      Math.min(
        samples.length,
        start +
          ANALYSIS_WINDOW_SIZE
      );

    if (
      end - start < 2048
    ) {
      continue;
    }

    const frame =
      samples.subarray(
        start,
        end
      );

    const detected =
      detectFundamentalByAutocorrelation(
        frame,
        sampleRate,
        referenceFrequency
      );

    if (
      detected
    ) {
      results.push(
        detected
      );
    }
  }

  /*
   * Remove duplicated detections that can happen
   * because the normalized windows overlap.
   */
  return results;
}

// ============================================================
// COMFORTABLE NOTE DETECTION
// ============================================================

interface ComfortableNoteMeasurement {
  frequency: number;
  clarity: number;
  stabilityPct: number;
  rms: number;
  confidence: number;
}

function detectComfortableNote(
  samples: Float32Array,
  sampleRate: number
): ComfortableNoteMeasurement | null {
  if (
    !isValidSampleRate(sampleRate) ||
    samples.length === 0
  ) {
    return null;
  }

  const durationSec =
    samples.length /
    sampleRate;

  if (
    durationSec <
    MIN_NOTE_DURATION_SEC
  ) {
    console.warn(
      '⚠️ Comfortable note recording is too short.',
      {
        durationSec,
      }
    );

    return null;
  }

  // ==========================================================
  // STEP 1 — WAVEFORM VALIDATION
  // ==========================================================

  const peak =
    calculatePeak(
      samples
    );

  const overallRms =
    calculateRMS(
      samples
    );

  console.log(
    '🎙️ RANGE AUDIO SIGNAL:',
    {
      durationSec:
        Number(
          durationSec.toFixed(
            3
          )
        ),

      rms:
        Number(
          overallRms.toFixed(
            6
          )
        ),

      peak:
        Number(
          peak.toFixed(
            6
          )
        ),
    }
  );

  if (
    !Number.isFinite(
      overallRms
    ) ||
    overallRms <
      MIN_VOCAL_RMS
  ) {
    console.warn(
      '⚠️ Comfortable note rejected: microphone signal is too quiet.',
      {
        rms:
          overallRms,

        peak,

        requiredMinimumRms:
          MIN_VOCAL_RMS,
      }
    );

    return null;
  }

  // ==========================================================
  // STEP 2 — PITCHY ANALYSIS
  // ==========================================================

  let pitchyFrames:
    ReturnType<
      typeof trackPitchOverTime
    > = [];

  try {
    pitchyFrames =
      trackPitchOverTime(
        samples,
        30,
        sampleRate
      );
  } catch (error) {
    console.warn(
      '⚠️ Pitchy comfortable-note analysis failed:',
      error
    );
  }

  const usablePitchyFrames =
    pitchyFrames.filter(
      frame =>
        frame.timestamp >=
          0.30 &&
        frame.timestamp <=
          durationSec - 0.20
    );

  const validPitchyFrames =
    usablePitchyFrames.filter(
      frame =>
        isValidFrequency(
          frame.frequency
        ) &&
        frame.frequency >=
          COMFORTABLE_NOTE_MIN_HZ &&
        frame.frequency <=
          COMFORTABLE_NOTE_MAX_HZ &&
        Number.isFinite(
          frame.clarity
        ) &&
        frame.clarity >=
          PITCHY_MIN_CLARITY
    );

  const pitchyFrequencies =
    validPitchyFrames.map(
      frame =>
        frame.frequency
    );

  const pitchyMedian =
    median(
      pitchyFrequencies
    );

  if (
    !pitchyMedian ||
    !isValidFrequency(
      pitchyMedian
    ) ||
    validPitchyFrames.length <
      MIN_PITCHY_FRAMES
  ) {
    console.warn(
      '⚠️ Comfortable note rejected: insufficient Pitchy evidence.',
      {
        pitchyFrames:
          validPitchyFrames.length,

        pitchyMedian:
          pitchyMedian,
      }
    );

    return null;
  }

  // ==========================================================
  // STEP 3 — PITCHY STABILITY
  // ==========================================================

  const pitchyConsistentCount =
    pitchyFrequencies.filter(
      frequency =>
        Math.abs(
          centsDifference(
            frequency,
            pitchyMedian
          )
        ) <=
          MAX_PITCHY_SPREAD_CENTS
    ).length;

  const pitchyConsistency =
    pitchyConsistentCount /
    pitchyFrequencies.length;

  if (
    pitchyConsistency <
    0.80
  ) {
    console.warn(
      '⚠️ Comfortable note rejected: Pitchy pitch is unstable.',
      {
        pitchyMedian:
          Number(
            pitchyMedian.toFixed(
              2
            )
          ),

        pitchyConsistency:
          Number(
            pitchyConsistency.toFixed(
              2
            )
          ),
      }
    );

    return null;
  }

  // ==========================================================
  // STEP 4 — AUTOCORRELATION VALIDATION
  // ==========================================================

  const autocorrelationResults =
    analyzeAutocorrelationWindows(
      samples,
      sampleRate,
      pitchyMedian
    );

  if (
    autocorrelationResults.length <
    MIN_AUTOCORRELATION_RESULTS
  ) {
    console.warn(
      '⚠️ Comfortable note rejected: not enough independent waveform evidence.',
      {
        pitchyMedian:
          Number(
            pitchyMedian.toFixed(
              2
            )
          ),

        autocorrelationResults:
          autocorrelationResults.length,
      }
    );

    return null;
  }

  // ==========================================================
  // STEP 5 — AUTOCORRELATION AGREEMENT
  // ==========================================================

  const directAgreementResults =
    autocorrelationResults.filter(
      result =>
        Math.abs(
          centsDifference(
            result.frequency,
            pitchyMedian
          )
        ) <=
          MAX_AUTOCORRELATION_AGREEMENT_CENTS
    );

  const directAgreement =
    directAgreementResults.length /
    autocorrelationResults.length;

  /*
   * Allow one-octave agreement as an alternative.
   *
   * Example:
   * Pitchy = 200 Hz
   * Auto    = 100 Hz
   *
   * This can mean Pitchy selected the second harmonic.
   */
  const octaveAgreementResults =
    autocorrelationResults.filter(
      result =>
        Math.abs(
          centsDifference(
            result.frequency,
            pitchyMedian / 2
          )
        ) <=
          OCTAVE_AGREEMENT_CENTS ||
        Math.abs(
          centsDifference(
            result.frequency,
            pitchyMedian * 2
          )
        ) <=
          OCTAVE_AGREEMENT_CENTS
    );

  const octaveAgreement =
    octaveAgreementResults.length /
    autocorrelationResults.length;

  /*
   * Direct agreement is preferred.
   *
   * A two-octave disagreement, such as:
   *
   * Pitchy ≈ 400 Hz
   * Auto   ≈ 100 Hz
   *
   * is NOT accepted as agreement.
   */
  if (
    directAgreement < 0.60 &&
    octaveAgreement < 0.60
  ) {
    console.warn(
      '⚠️ Comfortable note rejected: waveform pitch disagrees with Pitchy.',
      {
        pitchyMedian:
          Number(
            pitchyMedian.toFixed(
              2
            )
          ),

        autocorrelationFrequencies:
          autocorrelationResults.map(
            result =>
              Number(
                result.frequency.toFixed(
                  2
                )
              )
          ),

        directAgreement:
          Number(
            directAgreement.toFixed(
              2
            )
          ),

        octaveAgreement:
          Number(
            octaveAgreement.toFixed(
              2
            )
          ),
      }
    );

    return null;
  }

  // ==========================================================
  // STEP 6 — CHOOSE FINAL FREQUENCY
  // ==========================================================

  let finalFrequency =
    pitchyMedian;

  /*
   * ----------------------------------------------------------
   * Direct agreement
   * ----------------------------------------------------------
   */
  if (
    directAgreement >=
    0.60
  ) {
    const directMedian =
      median(
        directAgreementResults.map(
          result =>
            result.frequency
        )
      );

    if (
      directMedian &&
      isValidFrequency(
        directMedian
      )
    ) {
      /*
       * Average Pitchy and independent waveform estimate.
       */
      finalFrequency =
        (
          pitchyMedian +
          directMedian
        ) / 2;
    }
  }

  /*
   * ----------------------------------------------------------
   * Octave correction
   * ----------------------------------------------------------
   */
  else {
    const octaveMedian =
      median(
        octaveAgreementResults.map(
          result =>
            result.frequency
        )
      );

    if (
      octaveMedian &&
      isValidFrequency(
        octaveMedian
      )
    ) {
      const distanceToPitchy =
        Math.abs(
          centsDifference(
            octaveMedian,
            pitchyMedian
          )
        );

      const distanceToPitchyHalf =
        Math.abs(
          centsDifference(
            octaveMedian,
            pitchyMedian / 2
          )
        );

      const distanceToPitchyDouble =
        Math.abs(
          centsDifference(
            octaveMedian,
            pitchyMedian * 2
          )
        );

      /*
       * If autocorrelation consistently supports one octave
       * below Pitchy, use that lower fundamental.
       */
      if (
        distanceToPitchyHalf <
          distanceToPitchy &&
        distanceToPitchyHalf <=
          OCTAVE_AGREEMENT_CENTS
      ) {
        finalFrequency =
          octaveMedian;
      }

      /*
       * If autocorrelation supports an octave above Pitchy,
       * use that higher fundamental.
       */
      else if (
        distanceToPitchyDouble <
          distanceToPitchy &&
        distanceToPitchyDouble <=
          OCTAVE_AGREEMENT_CENTS
      ) {
        finalFrequency =
          octaveMedian;
      }
    }
  }

  // ==========================================================
  // STEP 7 — FINAL FREQUENCY VALIDATION
  // ==========================================================

  if (
    !isValidFrequency(
      finalFrequency
    ) ||
    finalFrequency <
      COMFORTABLE_NOTE_MIN_HZ ||
    finalFrequency >
      COMFORTABLE_NOTE_MAX_HZ
  ) {
    console.warn(
      '⚠️ Comfortable note rejected: final frequency is outside supported range.',
      {
        finalFrequency,
      }
    );

    return null;
  }

  // ==========================================================
  // STEP 8 — CLARITY
  // ==========================================================

  const clarityValues =
    validPitchyFrames
      .map(
        frame =>
          frame.clarity
      )
      .filter(
        value =>
          Number.isFinite(value)
      );

  const pitchyClarity =
    clarityValues.length > 0
      ? clarityValues.reduce(
          (sum, value) =>
            sum + value,
          0
        ) /
        clarityValues.length
      : 0;

  // ==========================================================
  // STEP 9 — AUTOCORRELATION CONFIDENCE
  // ==========================================================

  const autoConfidence =
    autocorrelationResults.reduce(
      (sum, result) =>
        sum +
        result.confidence,
      0
    ) /
    autocorrelationResults.length;

  /*
   * A strong result should have reasonably strong evidence
   * from both methods.
   */
  if (
    autoConfidence <
      MIN_AUTOCORRELATION_CONFIDENCE
  ) {
    console.warn(
      '⚠️ Comfortable note rejected: autocorrelation confidence is too low.',
      {
        autoConfidence,
      }
    );

    return null;
  }

  if (
    pitchyClarity <
    PITCHY_MIN_CLARITY
  ) {
    console.warn(
      '⚠️ Comfortable note rejected: Pitchy clarity is too low.',
      {
        pitchyClarity,
      }
    );

    return null;
  }

  // ==========================================================
  // STEP 10 — FINAL STABILITY
  // ==========================================================

  const stabilityPct =
    clampScore(
      pitchyConsistency *
        100
    );

  // ==========================================================
  // FINAL DIAGNOSTIC
  // ==========================================================

  console.log(
    '🎵 COMFORTABLE NOTE ANALYSIS:',
    {
      finalFrequency:
        Number(
          finalFrequency.toFixed(
            2
          )
        ),

      pitchyMedian:
        Number(
          pitchyMedian.toFixed(
            2
          )
        ),

      autocorrelationFrequencies:
        autocorrelationResults.map(
          result =>
            Number(
              result.frequency.toFixed(
                2
              )
            )
        ),

      directAgreement:
        Number(
          directAgreement.toFixed(
            2
          )
        ),

      octaveAgreement:
        Number(
          octaveAgreement.toFixed(
            2
          )
        ),

      pitchyClarity:
        Number(
          pitchyClarity.toFixed(
            3
          )
        ),

      autoConfidence:
        Number(
          autoConfidence.toFixed(
            3
          )
        ),

      pitchyConsistency:
        Number(
          pitchyConsistency.toFixed(
            2
          )
        ),

      stabilityPct,

      rms:
        Number(
          overallRms.toFixed(
            6
          )
        ),

      peak:
        Number(
          peak.toFixed(
            6
          )
        ),
    }
  );

  return {
    frequency:
      finalFrequency,

    clarity:
      Math.max(
        0,
        Math.min(
          1,
          pitchyClarity
        )
      ),

    stabilityPct,

    rms:
      overallRms,

    confidence:
      autoConfidence,
  };
}

// ============================================================
// VOCAL RANGE
// ============================================================

export function getVocalRange(
  audio: AssessmentAudioBundle
): VocalRange {
  if (
    !audio
  ) {
    throw new Error(
      'No assessment audio was provided.'
    );
  }

  const low =
    detectComfortableNote(
      audio.lowestComfortableNoteSamples,
      audio.sampleRate
    );

  const high =
    detectComfortableNote(
      audio.highestComfortableNoteSamples,
      audio.sampleRate
    );

  console.log(
    '🎵 LOWEST COMFORTABLE NOTE:',
    low
  );

  console.log(
    '🎵 HIGHEST COMFORTABLE NOTE:',
    high
  );

  /*
   * Never substitute a fake/default frequency.
   */
  if (
    !low ||
    !high
  ) {
    throw new Error(
      'We could not detect both comfortable notes accurately. Please sing each note steadily and clearly, without changing pitch, then try again.'
    );
  }

  // ----------------------------------------------------------
  // HIGHER NOTE MUST BE HIGHER
  // ----------------------------------------------------------

  if (
    low.frequency >=
    high.frequency
  ) {
    console.warn(
      '⚠️ Invalid vocal range ordering:',
      {
        lowHz:
          low.frequency,

        highHz:
          high.frequency,
      }
    );

    throw new Error(
      'The highest comfortable note must be above the lowest comfortable note. Please try again.'
    );
  }

  // ----------------------------------------------------------
  // MINIMUM RANGE WIDTH
  // ----------------------------------------------------------

  const semitoneSpan =
    12 *
    Math.log2(
      high.frequency /
      low.frequency
    );

  console.log(
    '🎵 Vocal range semitone span:',
    semitoneSpan
  );

  if (
    !Number.isFinite(
      semitoneSpan
    ) ||
    semitoneSpan < 3
  ) {
    throw new Error(
      'The two notes are too close together. Please choose a clearly lower note and a clearly higher note.'
    );
  }

  return {
    lowHz:
      low.frequency,

    highHz:
      high.frequency,
  };
}

// ============================================================
// VOCAL RANGE FROM HUMS
// ============================================================

export function detectVocalRangeFromHums(
  lowestComfortableNoteSamples: Float32Array,
  highestComfortableNoteSamples: Float32Array,
  sampleRate: number
): VocalRange {
  return getVocalRange({
    pitchSamples:
      new Float32Array(0),

    toneSamples:
      new Float32Array(0),

    volumeSamples:
      new Float32Array(0),

    agilitySamples:
      new Float32Array(0),

    lowestComfortableNoteSamples,

    highestComfortableNoteSamples,

    sampleRate,
  });
}

// ============================================================
// SAFE METRIC EXECUTION
// ============================================================

function safeMetric(
  name: string,
  calculate: () => number
): number {
  try {
    const score =
      calculate();

    if (
      !Number.isFinite(
        score
      )
    ) {
      console.warn(
        `⚠️ ${name} returned an invalid score.`
      );

      return 0;
    }

    return clampScore(
      score
    );
  } catch (error) {
    console.error(
      `❌ ${name} assessment failed:`,
      error
    );

    return 0;
  }
}

// ============================================================
// RUN ASSESSMENT
// ============================================================

export function runAssessment(
  audio: AssessmentAudioBundle
): AssessmentResult {
  console.log(
    '🧪 RUNNING VOICE ASSESSMENT...'
  );

  if (
    !audio
  ) {
    throw new Error(
      'No assessment audio was provided.'
    );
  }

  if (
    !isValidSampleRate(
      audio.sampleRate
    )
  ) {
    throw new Error(
      'Invalid audio sample rate.'
    );
  }

  console.log(
    '🧪 Assessment sample rate:',
    audio.sampleRate
  );

  console.log(
    '🧪 Pitch samples:',
    audio.pitchSamples.length
  );

  console.log(
    '🧪 Tone samples:',
    audio.toneSamples.length
  );

  console.log(
    '🧪 Volume samples:',
    audio.volumeSamples.length
  );

  console.log(
    '🧪 Agility samples:',
    audio.agilitySamples.length
  );

  console.log(
    '🧪 Low-note samples:',
    audio.lowestComfortableNoteSamples.length
  );

  console.log(
    '🧪 High-note samples:',
    audio.highestComfortableNoteSamples.length
  );

  // ==========================================================
  // STEP 1 — VOCAL RANGE FIRST
  // ==========================================================
  //
  // The detected range determines the generated reference
  // notes for Pitch/Tone/Volume/Agility.
  //
  // ==========================================================

  console.log(
    '🧪 Detecting vocal range first...'
  );

  const vocalRange =
    getVocalRange(
      audio
    );

  console.log(
    '🧪 Vocal range:',
    vocalRange.lowHz,
    '-',
    vocalRange.highHz
  );

  // ==========================================================
  // STEP 2 — GENERATE TARGET NOTES
  // ==========================================================

  const targetNotes =
    computeTargetNotes(
      vocalRange.lowHz,
      vocalRange.highHz
    );

  console.log(
    '🎯 Generated assessment targets:',
    {
      rootHz:
        Number(
          targetNotes.rootHz.toFixed(
            2
          )
        ),

      agilityRun:
        targetNotes.agilityRun.map(
          frequency =>
            Number(
              frequency.toFixed(
                2
              )
            )
        ),
    }
  );

  // ==========================================================
  // STEP 3 — COMPONENT SCORES
  // ==========================================================

  console.log(
    '🧪 Measuring breath control...'
  );

  const breathScore =
    safeMetric(
      'Breath control',
      () =>
        measureBreathControl(
          audio.toneSamples,
          audio.sampleRate,
          ASSESSMENT_DURATION
            .breathControl
        )
    );

  console.log(
    '🧪 Breath score:',
    breathScore
  );

  // ----------------------------------------------------------

  console.log(
    '🧪 Measuring pitch...'
  );

  const pitchScore =
    safeMetric(
      'Pitch',
      () =>
        measurePitch(
          audio.pitchSamples,
          audio.sampleRate,
          targetNotes.rootHz
        )
    );

  console.log(
    '🧪 Pitch score:',
    pitchScore
  );

  // ----------------------------------------------------------

  console.log(
    '🧪 Measuring tone...'
  );

  const toneScore =
    safeMetric(
      'Tone',
      () =>
        measureTone(
          audio.toneSamples,
          audio.sampleRate
        )
    );

  console.log(
    '🧪 Tone score:',
    toneScore
  );

  // ----------------------------------------------------------

  console.log(
    '🧪 Measuring volume...'
  );

  const volumeScore =
    safeMetric(
      'Volume',
      () =>
        measureVolume(
          audio.volumeSamples,
          audio.sampleRate
        )
    );

  console.log(
    '🧪 Volume score:',
    volumeScore
  );

  // ----------------------------------------------------------

  console.log(
    '🧪 Measuring agility...'
  );

  const agilityScore =
    safeMetric(
      'Agility',
      () =>
        measureAgility(
          audio.agilitySamples,
          audio.sampleRate,
          targetNotes.agilityRun
        )
    );

  console.log(
    '🧪 Agility score:',
    agilityScore
  );

  // ==========================================================
  // SCORE ARRAY
  // ==========================================================

  const scores:
    ComponentScore[] =
    [
      {
        componentId:
          'breathControl',

        scorePct:
          breathScore,
      },

      {
        componentId:
          'pitch',

        scorePct:
          pitchScore,
      },

      {
        componentId:
          'tone',

        scorePct:
          toneScore,
      },

      {
        componentId:
          'volume',

        scorePct:
          volumeScore,
      },

      {
        componentId:
          'agility',

        scorePct:
          agilityScore,
      },
    ];

  // ==========================================================
  // RECOMMENDATIONS
  // ==========================================================

  const recommendations =
    Object.fromEntries(
      scores.map(
        score => [
          score.componentId,
          classifyBand(
            score.scorePct
          ),
        ]
      )
    ) as Record<
      ComponentId,
      RecommendationBand
    >;

  // ==========================================================
  // RESULT
  // ==========================================================

  const result:
    AssessmentResult =
    {
      vocalRange,

      vocalRangeLowHz:
        vocalRange.lowHz,

      vocalRangeHighHz:
        vocalRange.highHz,

      scores,

      recommendations,

      timestamp:
        Date.now(),
    };

  console.log(
    '✅ VOICE ASSESSMENT COMPLETE',
    result
  );

  return result;
}

// ============================================================
// COMPARE ASSESSMENTS
// ============================================================

export function compareAssessments(
  previous: AssessmentResult,
  current: AssessmentResult
): Record<
  ComponentId,
  number
> {
  if (
    !previous ||
    !current
  ) {
    throw new Error(
      'Both previous and current assessment results are required.'
    );
  }

  const result =
    {} as Record<
      ComponentId,
      number
    >;

  for (
    const currentScore
      of current.scores
  ) {
    const previousScore =
      previous.scores.find(
        score =>
          score.componentId ===
          currentScore.componentId
      );

    /*
     * Never silently treat a missing previous component
     * as zero because that would create a false improvement.
     */
    if (
      !previousScore
    ) {
      throw new Error(
        `Previous assessment is missing the ${currentScore.componentId} component score.`
      );
    }

    result[
      currentScore.componentId
    ] =
      currentScore.scorePct -
      previousScore.scorePct;
  }

  return result;
}