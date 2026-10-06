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

  /*
   * Vocal-range calibration recordings are intentionally
   * longer than the other assessment sections.
   */
  comfortableNote: 4,
} as const;

// ============================================================
// VOCAL RANGE DETECTION CONFIGURATION
// ============================================================

/*
 * Technical frequency limits for the vocal-range detector.
 *
 * 60 Hz  ≈ B1
 * 1200 Hz ≈ D6
 *
 * These are detection limits, not assumptions about the
 * user's actual vocal range.
 */
const COMFORTABLE_NOTE_MIN_HZ = 60;
const COMFORTABLE_NOTE_MAX_HZ = 1200;

/*
 * Reject recordings that are essentially silence/noise.
 */
const MIN_VOCAL_RMS = 0.002;

/*
 * A 4-second recording is expected.
 *
 * We allow recordings shorter than the configured 4 seconds
 * as long as they contain at least 1.5 seconds of usable
 * audio. This makes the detector more tolerant of a manual
 * stop while still requiring enough evidence.
 */
const MIN_NOTE_DURATION_SEC = 1.5;

/*
 * Autocorrelation analysis window.
 *
 * 4096 samples at 44.1 kHz ≈ 93 ms.
 *
 * This provides several cycles even for relatively low
 * singing frequencies while keeping the computation
 * manageable on a mobile device.
 */
const ANALYSIS_WINDOW_SIZE = 4096;

/*
 * Pitchy confidence requirement.
 *
 * We keep this reasonably high, but do not require every
 * frame to be extremely clean.
 */
const PITCHY_MIN_CLARITY = 0.75;

/*
 * Require enough independent Pitchy frames to establish
 * a sustained note.
 */
const MIN_PITCHY_FRAMES = 8;

/*
 * Maximum normal pitch variation around the selected
 * pitch candidate.
 *
 * 75 cents is intentionally more tolerant than the previous
 * 50-cent requirement because real sustained singing can
 * contain natural vibrato and small tracking fluctuations.
 */
const MAX_PITCHY_SPREAD_CENTS = 75;

/*
 * Autocorrelation confidence requirement.
 */
const MIN_AUTOCORRELATION_CONFIDENCE = 0.50;

/*
 * At least three independent autocorrelation windows should
 * produce usable evidence.
 */
const MIN_AUTOCORRELATION_RESULTS = 3;

/*
 * Pitch agreement tolerance between independent detectors.
 */
const MAX_AUTOCORRELATION_AGREEMENT_CENTS = 100;

/*
 * Octave agreement tolerance.
 */
const OCTAVE_AGREEMENT_CENTS = 100;

/*
 * Minimum percentage of autocorrelation windows that should
 * support the selected candidate.
 */
const MIN_AUTOCORRELATION_AGREEMENT_RATIO = 0.50;

/*
 * Minimum combined evidence score for a final range note.
 *
 * This prevents an arbitrary frequency from being returned
 * when the detectors have weak or conflicting evidence.
 */
const MIN_RANGE_EVIDENCE_SCORE = 0.48;

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

  if (valid.length === 0) {
    return null;
  }

  const middle =
    Math.floor(
      valid.length / 2
    );

  if (valid.length % 2 === 0) {
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
      frequencyToMidi(lowHz)
    );

  const highMidi =
    Math.floor(
      frequencyToMidi(highHz)
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
    !Number.isFinite(targetDurationSec) ||
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
    !Number.isFinite(actualDurationSec) ||
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
    !isValidFrequency(targetFrequency)
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

  const frequencies =
    validFrames.map(
      frame =>
        frame.frequency
    );

  const stability =
    calcJitterStability(
      frequencies
    );

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
      Number.isFinite(centroid) &&
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

  const withinNoteStability =
    noteStabilities.length > 0
      ? noteStabilities.reduce(
          (sum, value) =>
            sum + value,
          0
        ) /
        noteStabilities.length
      : 0;

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

function detectFundamentalByAutocorrelation(
  samples: Float32Array,
  sampleRate: number
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
   * Do not force autocorrelation to follow Pitchy.
   *
   * This is important for vocal-range detection because
   * Pitchy can occasionally report an octave harmonic.
   *
   * Instead, choose the strongest fundamental candidate.
   */
  candidates.sort(
    (a, b) => {
      if (
        b.correlation !==
        a.correlation
      ) {
        return (
          b.correlation -
          a.correlation
        );
      }

      return (
        a.lag -
        b.lag
      );
    }
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
  sampleRate: number
): AutocorrelationResult[] {
  const results:
    AutocorrelationResult[] =
      [];

  if (
    !isValidSampleRate(sampleRate) ||
    samples.length === 0
  ) {
    return results;
  }

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
   * Analyze several independent portions of the recording.
   *
   * The middle portions are preferred because the beginning
   * usually contains note attack instability and the end
   * often contains release instability.
   *
   * Five windows give enough redundancy for a 4-second
   * recording without making the mobile analysis excessive.
   */
  const normalizedTimes = [
    0.22,
    0.36,
    0.50,
    0.64,
    0.78,
  ];

  for (
    const normalizedTime
      of normalizedTimes
  ) {
    const center =
      Math.floor(
        durationSec *
          normalizedTime *
          sampleRate
      );

    const halfWindow =
      Math.floor(
        ANALYSIS_WINDOW_SIZE /
          2
      );

    let start =
      center -
      halfWindow;

    let end =
      center +
      halfWindow;

    if (
      start < 0
    ) {
      start = 0;

      end =
        Math.min(
          samples.length,
          ANALYSIS_WINDOW_SIZE
        );
    }

    if (
      end >
      samples.length
    ) {
      end =
        samples.length;

      start =
        Math.max(
          0,
          end -
            ANALYSIS_WINDOW_SIZE
        );
    }

    if (
      end - start <
      2048
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
        sampleRate
      );

    if (
      detected &&
      isValidFrequency(
        detected.frequency
      )
    ) {
      results.push(
        detected
      );
    }
  }

  return results;
}

// ============================================================
// RANGE CANDIDATE SUPPORT
// ============================================================

interface RangeCandidate {
  frequency: number;
  pitchySupport: number;
  pitchyConsistency: number;
  autoSupport: number;
  autoConfidence: number;
  evidenceScore: number;
}

function calculateFrequencySupport(
  frequencies: number[],
  candidateFrequency: number,
  toleranceCents: number
): number {
  if (
    frequencies.length === 0 ||
    !isValidFrequency(
      candidateFrequency
    )
  ) {
    return 0;
  }

  const matching =
    frequencies.filter(
      frequency =>
        Math.abs(
          centsDifference(
            frequency,
            candidateFrequency
          )
        ) <=
          toleranceCents
    ).length;

  return (
    matching /
    frequencies.length
  );
}

function getCandidateMedian(
  frequencies: number[],
  candidateFrequency: number,
  toleranceCents: number
): number | null {
  const matching =
    frequencies.filter(
      frequency =>
        Math.abs(
          centsDifference(
            frequency,
            candidateFrequency
          )
        ) <=
          toleranceCents
    );

  return median(
    matching
  );
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
        requiredMinimum:
          MIN_NOTE_DURATION_SEC,
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
          durationSec.toFixed(3)
        ),

      rms:
        Number(
          overallRms.toFixed(6)
        ),

      peak:
        Number(
          peak.toFixed(6)
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

  if (
    !Array.isArray(
      pitchyFrames
    ) ||
    pitchyFrames.length === 0
  ) {
    console.warn(
      '⚠️ Comfortable note rejected: Pitchy returned no frames.'
    );

    return null;
  }

  /*
   * Ignore only the attack and release.
   *
   * With a 4-second recording this leaves roughly 3.3
   * seconds of usable sustained material.
   */
  const usablePitchyFrames =
    pitchyFrames.filter(
      frame =>
        frame.timestamp >=
          0.35 &&
        frame.timestamp <=
          durationSec - 0.35
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

  if (
    validPitchyFrames.length <
    MIN_PITCHY_FRAMES
  ) {
    console.warn(
      '⚠️ Comfortable note rejected: insufficient Pitchy evidence.',
      {
        pitchyFrames:
          validPitchyFrames.length,

        required:
          MIN_PITCHY_FRAMES,

        totalPitchyFrames:
          pitchyFrames.length,
      }
    );

    return null;
  }

  const pitchyMedian =
    median(
      pitchyFrequencies
    );

  if (
    !pitchyMedian ||
    !isValidFrequency(
      pitchyMedian
    )
  ) {
    console.warn(
      '⚠️ Comfortable note rejected: no valid Pitchy median.'
    );

    return null;
  }

  console.log(
    '🎵 PITCHY RANGE ESTIMATE:',
    {
      median:
        Number(
          pitchyMedian.toFixed(2)
        ),

      validFrames:
        validPitchyFrames.length,

      totalFrames:
        pitchyFrames.length,
    }
  );

  // ==========================================================
  // STEP 3 — OCTAVE-AWARE PITCHY CANDIDATES
  // ==========================================================

  /*
   * Pitch trackers can report:
   *
   *   true fundamental
   *   one octave below
   *   one octave above
   *
   * We therefore evaluate all three possibilities rather than
   * blindly trusting the Pitchy median.
   */
  const pitchyCandidates =
    [
      pitchyMedian / 2,
      pitchyMedian,
      pitchyMedian * 2,
    ].filter(
      frequency =>
        frequency >=
          COMFORTABLE_NOTE_MIN_HZ &&
        frequency <=
          COMFORTABLE_NOTE_MAX_HZ
    );

  // ==========================================================
  // STEP 4 — AUTOCORRELATION
  // ==========================================================

  const autocorrelationResults =
    analyzeAutocorrelationWindows(
      samples,
      sampleRate
    );

  console.log(
    '🎵 AUTOCORRELATION WINDOWS:',
    autocorrelationResults.map(
      result => ({
        frequency:
          Number(
            result.frequency.toFixed(2)
          ),

        confidence:
          Number(
            result.confidence.toFixed(3)
          ),
      })
    )
  );

  if (
    autocorrelationResults.length <
    MIN_AUTOCORRELATION_RESULTS
  ) {
    console.warn(
      '⚠️ Comfortable note rejected: not enough independent waveform evidence.',
      {
        required:
          MIN_AUTOCORRELATION_RESULTS,

        received:
          autocorrelationResults.length,
      }
    );

    return null;
  }

  const autoFrequencies =
    autocorrelationResults.map(
      result =>
        result.frequency
    );

  const autoConfidence =
    autocorrelationResults.reduce(
      (sum, result) =>
        sum +
        result.confidence,
      0
    ) /
    autocorrelationResults.length;

  if (
    autoConfidence <
    MIN_AUTOCORRELATION_CONFIDENCE
  ) {
    console.warn(
      '⚠️ Comfortable note rejected: autocorrelation confidence is too low.',
      {
        autoConfidence:
          Number(
            autoConfidence.toFixed(3)
          ),
      }
    );

    return null;
  }

  // ==========================================================
  // STEP 5 — SELECT BEST OCTAVE-AWARE CANDIDATE
  // ==========================================================

  const candidates:
    RangeCandidate[] =
    pitchyCandidates.map(
      candidateFrequency => {
        const pitchySupport =
          calculateFrequencySupport(
            pitchyFrequencies,
            candidateFrequency,
            MAX_PITCHY_SPREAD_CENTS
          );

        const autoSupport =
          calculateFrequencySupport(
            autoFrequencies,
            candidateFrequency,
            MAX_AUTOCORRELATION_AGREEMENT_CENTS
          );

        const matchingPitchyMedian =
          getCandidateMedian(
            pitchyFrequencies,
            candidateFrequency,
            MAX_PITCHY_SPREAD_CENTS
          );

        const candidatePitchyConsistency =
          matchingPitchyMedian
            ? calculateFrequencySupport(
                pitchyFrequencies,
                matchingPitchyMedian,
                MAX_PITCHY_SPREAD_CENTS
              )
            : 0;

        /*
         * Pitchy support establishes that the candidate is
         * actually present in the sung signal.
         *
         * Autocorrelation support provides independent
         * waveform evidence.
         *
         * Autocorrelation receives slightly more weight
         * because it helps resolve octave errors.
         */
        const evidenceScore =
          pitchySupport * 0.40 +
          autoSupport * 0.45 +
          Math.min(
            autoConfidence,
            1
          ) * 0.15;

        return {
          frequency:
            candidateFrequency,

          pitchySupport,

          pitchyConsistency:
            candidatePitchyConsistency,

          autoSupport,

          autoConfidence,

          evidenceScore,
        };
      }
    );

  candidates.sort(
    (a, b) =>
      b.evidenceScore -
      a.evidenceScore
  );

  const bestCandidate =
    candidates[0];

  console.log(
    '🎯 RANGE CANDIDATES:',
    candidates.map(
      candidate => ({
        frequency:
          Number(
            candidate.frequency.toFixed(2)
          ),

        pitchySupport:
          Number(
            candidate.pitchySupport.toFixed(2)
          ),

        autoSupport:
          Number(
            candidate.autoSupport.toFixed(2)
          ),

        evidence:
          Number(
            candidate.evidenceScore.toFixed(3)
          ),
      })
    )
  );

  if (
    !bestCandidate ||
    bestCandidate.evidenceScore <
      MIN_RANGE_EVIDENCE_SCORE
  ) {
    console.warn(
      '⚠️ Comfortable note rejected: no candidate has enough combined evidence.',
      {
        bestCandidate:
          bestCandidate
            ? {
                frequency:
                  bestCandidate.frequency,

                evidence:
                  bestCandidate.evidenceScore,

                pitchySupport:
                  bestCandidate.pitchySupport,

                autoSupport:
                  bestCandidate.autoSupport,
              }
            : null,
      }
    );

    return null;
  }

  // ==========================================================
  // STEP 6 — FINAL PITCH CLUSTER
  // ==========================================================

  /*
   * Use the selected candidate as a center and take the
   * median of the actual Pitchy estimates belonging to it.
   *
   * We intentionally do NOT average Pitchy and autocorrelation
   * frequencies because octave-related values must never be
   * averaged into a fake intermediate frequency.
   */
  const selectedPitchyFrequencies =
    pitchyFrequencies.filter(
      frequency =>
        Math.abs(
          centsDifference(
            frequency,
            bestCandidate.frequency
          )
        ) <=
          MAX_PITCHY_SPREAD_CENTS
    );

  const selectedPitchyMedian =
    median(
      selectedPitchyFrequencies
    );

  const selectedAutoFrequencies =
    autoFrequencies.filter(
      frequency =>
        Math.abs(
          centsDifference(
            frequency,
            bestCandidate.frequency
          )
        ) <=
          MAX_AUTOCORRELATION_AGREEMENT_CENTS
    );

  const selectedAutoMedian =
    median(
      selectedAutoFrequencies
    );

  /*
   * Prefer the stable Pitchy cluster for the exact final
   * frequency because Pitchy provides finer temporal
   * resolution. Autocorrelation determines whether that
   * octave is trustworthy.
   */
  let finalFrequency =
    selectedPitchyMedian ??
    selectedAutoMedian ??
    bestCandidate.frequency;

  if (
    !isValidFrequency(
      finalFrequency
    )
  ) {
    console.warn(
      '⚠️ Comfortable note rejected: final frequency is invalid.'
    );

    return null;
  }

  // ==========================================================
  // STEP 7 — FINAL CONSISTENCY CHECK
  // ==========================================================

  const finalPitchySupport =
    calculateFrequencySupport(
      pitchyFrequencies,
      finalFrequency,
      MAX_PITCHY_SPREAD_CENTS
    );

  const finalAutoSupport =
    calculateFrequencySupport(
      autoFrequencies,
      finalFrequency,
      MAX_AUTOCORRELATION_AGREEMENT_CENTS
    );

  /*
   * We require either:
   *
   *   - strong support from both detectors, or
   *   - strong support from one detector plus reasonable
   *     support from the other.
   */
  if (
    finalAutoSupport <
      MIN_AUTOCORRELATION_AGREEMENT_RATIO ||
    finalPitchySupport <
      0.50
  ) {
    console.warn(
      '⚠️ Comfortable note rejected: final pitch cluster is not sufficiently supported.',
      {
        finalFrequency:
          Number(
            finalFrequency.toFixed(2)
          ),

        pitchySupport:
          Number(
            finalPitchySupport.toFixed(2)
          ),

        autoSupport:
          Number(
            finalAutoSupport.toFixed(2)
          ),
      }
    );

    return null;
  }

  // ==========================================================
  // STEP 8 — FINAL FREQUENCY VALIDATION
  // ==========================================================

  if (
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
  // STEP 9 — CLARITY
  // ==========================================================

  const selectedClarityFrames =
    validPitchyFrames.filter(
      frame =>
        Math.abs(
          centsDifference(
            frame.frequency,
            finalFrequency
          )
        ) <=
          MAX_PITCHY_SPREAD_CENTS
    );

  const clarityValues =
    selectedClarityFrames
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

  if (
    pitchyClarity <
    PITCHY_MIN_CLARITY
  ) {
    console.warn(
      '⚠️ Comfortable note rejected: Pitchy clarity is too low.',
      {
        pitchyClarity:
          Number(
            pitchyClarity.toFixed(3)
          ),
      }
    );

    return null;
  }

  // ==========================================================
  // STEP 10 — FINAL STABILITY
  // ==========================================================

  const finalPitchyFrequencyValues =
    selectedPitchyFrequencies.length >
    0
      ? selectedPitchyFrequencies
      : [finalFrequency];

  const finalPitchyConsistency =
    calculateFrequencySupport(
      pitchyFrequencies,
      finalFrequency,
      MAX_PITCHY_SPREAD_CENTS
    );

  const stabilityPct =
    clampScore(
      finalPitchyConsistency *
        100
    );

  // ==========================================================
  // STEP 11 — FINAL LOGGING
  // ==========================================================

  console.log(
    '🎵 COMFORTABLE NOTE ANALYSIS:',
    {
      durationSec:
        Number(
          durationSec.toFixed(2)
        ),

      finalFrequency:
        Number(
          finalFrequency.toFixed(2)
        ),

      finalNoteCandidate:
        Number(
          bestCandidate.frequency.toFixed(2)
        ),

      pitchyMedian:
        Number(
          pitchyMedian.toFixed(2)
        ),

      pitchyFrames:
        validPitchyFrames.length,

      selectedPitchyFrames:
        finalPitchyFrequencyValues.length,

      autocorrelationFrequencies:
        autoFrequencies.map(
          frequency =>
            Number(
              frequency.toFixed(2)
            )
        ),

      pitchySupport:
        Number(
          finalPitchySupport.toFixed(2)
        ),

      autocorrelationSupport:
        Number(
          finalAutoSupport.toFixed(2)
        ),

      pitchyClarity:
        Number(
          pitchyClarity.toFixed(3)
        ),

      autoConfidence:
        Number(
          autoConfidence.toFixed(3)
        ),

      stabilityPct,

      rms:
        Number(
          overallRms.toFixed(6)
        ),

      peak:
        Number(
          peak.toFixed(6)
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
  if (!audio) {
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
      'Invalid audio sample rate for vocal-range detection.'
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

  if (
    !low ||
    !high
  ) {
    throw new Error(
      'We could not detect both comfortable notes accurately. Please sing each note steadily for the full recording and keep the same pitch without changing notes.'
    );
  }

  // ==========================================================
  // HIGHER NOTE MUST BE HIGHER
  // ==========================================================

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

        differenceCents:
          centsDifference(
            high.frequency,
            low.frequency
          ),
      }
    );

    throw new Error(
      'The highest comfortable note must be above the lowest comfortable note. Please make the second recording clearly higher than the first.'
    );
  }

  // ==========================================================
  // MINIMUM RANGE WIDTH
  // ==========================================================

  const semitoneSpan =
    12 *
    Math.log2(
      high.frequency /
        low.frequency
    );

  console.log(
    '🎵 Vocal range semitone span:',
    Number(
      semitoneSpan.toFixed(2)
    )
  );

  /*
   * Three semitones is retained as a sanity check, but it is
   * only applied after both notes have independently passed
   * the sustained-pitch analysis above.
   */
  if (
    !Number.isFinite(
      semitoneSpan
    ) ||
    semitoneSpan < 3
  ) {
    throw new Error(
      'The two notes are too close together. Please choose a clearly lower comfortable note and a clearly higher comfortable note.'
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
      !Number.isFinite(score)
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

  if (!audio) {
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
          targetNotes.rootHz.toFixed(2)
        ),

      agilityRun:
        targetNotes.agilityRun.map(
          frequency =>
            Number(
              frequency.toFixed(2)
            )
        ),
    }
  );

  // ==========================================================
  // STEP 3 — COMPONENT SCORES
  // ==========================================================

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

  const toneScore =
    safeMetric(
      'Tone',
      () =>
        measureTone(
          audio.toneSamples,
          audio.sampleRate
        )
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
    '🧪 Assessment scores:',
    {
      breathControl:
        breathScore,

      pitch:
        pitchScore,

      tone:
        toneScore,

      volume:
        volumeScore,

      agility:
        agilityScore,
    }
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