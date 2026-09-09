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
// DETECTION CONFIGURATION
// ============================================================

/*
 * These values are deliberately kept separate from the
 * normal Pitch/Agility detector.
 *
 * Comfortable-note detection is a range-calibration task,
 * not a normal live-tuner task.
 */

const COMFORTABLE_NOTE_MIN_HZ = 60;
const COMFORTABLE_NOTE_MAX_HZ = 1200;

/*
 * Do not interpret extremely quiet microphone data as a
 * musical note.
 *
 * Your previous test produced approximately:
 *
 * RMS  = 0.00013
 * Peak = 0.00024
 *
 * That is far below this threshold.
 *
 * This is intentional: bad/near-silent microphone data
 * must result in "could not detect note", not "100 Hz".
 */
const MIN_VOCAL_RMS = 0.002;

const MIN_NOTE_DURATION_SEC = 0.75;

const ANALYSIS_WINDOW_SIZE = 4096;

const PITCHY_MIN_CLARITY = 0.45;

const PITCH_CLUSTER_CENTS = 150;

const MIN_AUTOCORRELATION_CONFIDENCE = 0.55;

const MIN_AUTOCORRELATION_RESULTS = 2;


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


function median(
  values: number[]
): number | null {
  const valid =
    values
      .filter(value =>
        Number.isFinite(value)
      )
      .sort((a, b) => a - b);

  if (valid.length === 0) {
    return null;
  }

  const middle =
    Math.floor(valid.length / 2);

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

  const rootHz =
    Math.sqrt(
      lowHz * highHz
    );

  const clamp =
    (hz: number) =>
      Math.max(
        lowHz,
        Math.min(
          highHz,
          hz
        )
      );

  const semitone =
    (offset: number) =>
      clamp(
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
  sampleRate: number
): number {
  if (
    !isValidSampleRate(sampleRate) ||
    samples.length === 0
  ) {
    return 0;
  }

  const frames =
    trackPitchOverTime(
      samples,
      30,
      sampleRate
    );

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

  const validFrequencies =
    voicedFrames
      .map(frame =>
        frame.frequency
      )
      .filter(
        isValidFrequency
      );

  if (
    validFrequencies.length === 0
  ) {
    return 0;
  }

  const stability =
    calcJitterStability(
      validFrequencies
    );

  const validClarityValues =
    voicedFrames
      .map(frame =>
        frame.clarity
      )
      .filter(value =>
        Number.isFinite(value)
      );

  if (
    validClarityValues.length === 0
  ) {
    return 0;
  }

  const clarity =
    validClarityValues.reduce(
      (sum, value) =>
        sum + value,
      0
    ) /
    validClarityValues.length;

  const clarityScore =
    clampScore(
      clarity * 100
    );

  return clampScore(
    stability * 0.5 +
    clarityScore * 0.5
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
      0.05 *
      sampleRate
    );

  if (
    frameSize <= 0
  ) {
    return 0;
  }

  const centroids: number[] = [];

  for (
    let i = 0;
    i + frameSize <= samples.length;
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

  /*
   * If the recording is essentially silent,
   * don't allow the volume DSP to turn -Infinity
   * values into a misleading score.
   */
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
  sampleRate: number
): number {
  if (
    !isValidSampleRate(sampleRate) ||
    samples.length === 0
  ) {
    return 0;
  }

  const frames =
    trackPitchOverTime(
      samples,
      30,
      sampleRate
    );

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

  const transitions =
    detectPitchChanges(
      validVoicedFrames,
      15
    );

  const durationSec =
    samples.length /
    sampleRate;

  if (
    !Number.isFinite(durationSec) ||
    durationSec <= 0
  ) {
    return 0;
  }

  const speed =
    calcTransitionSpeed(
      transitions.length,
      durationSec
    );

  const speedScore =
    Math.min(
      speed / 5,
      1
    ) * 100;

  const frequencies =
    validVoicedFrames.map(
      frame =>
        frame.frequency
    );

  const stability =
    calcJitterStability(
      frequencies
    );

  return clampScore(
    speedScore * 0.5 +
    stability * 0.5
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
  }

  return Math.sqrt(
    sumSquares /
    samples.length
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

  for (
    let i = 0;
    i < input.length;
    i++
  ) {
    sum += input[i];
  }

  const mean =
    sum / input.length;

  const output =
    new Float32Array(
      input.length
    );

  for (
    let i = 0;
    i < input.length;
    i++
  ) {
    output[i] =
      input[i] - mean;
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
 * Finds the fundamental frequency of a single waveform
 * window using normalized autocorrelation.
 *
 * This detector is used ONLY by vocal-range calibration.
 *
 * It is intentionally independent of pitch.ts so that
 * changing range detection does not accidentally change
 * the Pitch or Agility assessment.
 */
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

  let bestCorrelation =
    -Infinity;

  let bestLag = -1;

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
      windowed.length - lag;

    for (
      let i = 0;
      i < limit;
      i++
    ) {
      const a =
        windowed[i];

      const b =
        windowed[i + lag];

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
      !Number.isFinite(
        correlation
      )
    ) {
      continue;
    }

    correlations[lag] =
      correlation;

    if (
      correlation >
      bestCorrelation
    ) {
      bestCorrelation =
        correlation;

      bestLag =
        lag;
    }
  }

  if (
    bestLag <= 0 ||
    !Number.isFinite(
      bestCorrelation
    )
  ) {
    return null;
  }

  /*
   * Reject weak periodic structure.
   *
   * This is particularly important for microphone noise,
   * quantization noise, and silence.
   */
  if (
    bestCorrelation <
    MIN_AUTOCORRELATION_CONFIDENCE
  ) {
    return null;
  }

  /*
   * Find local peaks.
   */
  const candidates:
    Array<{
      lag: number;
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
      correlations[lag - 1];

    const next =
      correlations[lag + 1];

    if (
      current >= previous &&
      current >= next &&
      current > 0
    ) {
      candidates.push({
        lag,
        correlation: current,
      });
    }
  }

  if (
    candidates.length === 0
  ) {
    return null;
  }

  /*
   * Sort by correlation.
   */
  candidates.sort(
    (a, b) =>
      b.correlation -
      a.correlation
  );

  /*
   * We want to avoid an octave error.
   *
   * If several peaks have nearly the same strength,
   * prefer the lower-frequency fundamental.
   */
  const strongCandidates =
    candidates.filter(
      candidate =>
        candidate.correlation >=
        bestCorrelation * 0.94
    );

  let selected =
    strongCandidates.length > 0
      ? strongCandidates.reduce(
          (lowest, candidate) =>
            candidate.lag >
            lowest.lag
              ? candidate
              : lowest
        )
      : candidates[0];

  /*
   * Examine octave relationships.
   *
   * If a lower-frequency candidate is also strongly
   * supported, prefer it over the octave-up candidate.
   */
  const candidateLag =
    selected.lag;

  const doubleLag =
    candidateLag * 2;

  if (
    doubleLag <= maxLag
  ) {
    const lowerCorrelation =
      correlations[
        doubleLag
      ];

    if (
      Number.isFinite(
        lowerCorrelation
      ) &&
      lowerCorrelation >=
        selected.correlation * 0.90
    ) {
      selected = {
        lag: doubleLag,
        correlation:
          lowerCorrelation,
      };
    }
  }

  /*
   * Parabolic interpolation improves frequency precision.
   */
  let refinedLag =
    selected.lag;

  if (
    selected.lag > minLag &&
    selected.lag < maxLag
  ) {
    const y1 =
      correlations[
        selected.lag - 1
      ];

    const y2 =
      correlations[
        selected.lag
      ];

    const y3 =
      correlations[
        selected.lag + 1
      ];

    const denominator =
      y1 -
      2 * y2 +
      y3;

    if (
      Number.isFinite(
        denominator
      ) &&
      Math.abs(
        denominator
      ) > 1e-9
    ) {
      const offset =
        0.5 *
        (
          y1 - y3
        ) /
        denominator;

      if (
        Number.isFinite(offset) &&
        Math.abs(offset) <= 1
      ) {
        refinedLag +=
          offset;
      }
    }
  }

  if (
    !Number.isFinite(
      refinedLag
    ) ||
    refinedLag <= 0
  ) {
    return null;
  }

  const frequency =
    sampleRate /
    refinedLag;

  if (
    !isValidFrequency(
      frequency
    ) ||
    frequency <
      COMFORTABLE_NOTE_MIN_HZ ||
    frequency >
      COMFORTABLE_NOTE_MAX_HZ
  ) {
    return null;
  }

  return {
    frequency,
    confidence:
      selected.correlation,
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
    AutocorrelationResult[] = [];

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
   * Analyze the middle portions of the recording.
   *
   * We intentionally avoid the first and final portions
   * because those often contain attack/release noise.
   */
  const analysisTimes = [
    0.45,
    0.75,
    1.05,
    1.35,
    1.65,
  ];

  for (
    const timeSec
    of analysisTimes
  ) {
    if (
      timeSec >=
      durationSec - 0.20
    ) {
      continue;
    }

    const center =
      Math.floor(
        timeSec *
        sampleRate
      );

    const start =
      Math.max(
        0,
        center -
        Math.floor(
          ANALYSIS_WINDOW_SIZE / 2
        )
      );

    const end =
      Math.min(
        samples.length,
        start +
        ANALYSIS_WINDOW_SIZE
      );

    if (
      end - start < 1024
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
      detected
    ) {
      results.push(
        detected
      );
    }
  }

  return results;
}


// ============================================================
// COMFORTABLE NOTE DETECTION
// ============================================================

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

  /*
   * ==========================================================
   * STEP 1 — Check the actual waveform level
   * ==========================================================
   */

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

  /*
   * This prevents tiny residual microphone data from
   * becoming a fake pitch.
   */
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

        peak:
          peak,

        requiredMinimumRms:
          MIN_VOCAL_RMS,
      }
    );

    return null;
  }

  /*
   * ==========================================================
   * STEP 2 — Pitchy analysis
   * ==========================================================
   */

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
        frame.timestamp >= 0.30 &&
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

  /*
   * We don't require Pitchy to succeed.
   *
   * Autocorrelation can still detect the note if Pitchy
   * struggles.
   */

  const pitchyFrequencies =
    validPitchyFrames.map(
      frame =>
        frame.frequency
    );

  const pitchyMedian =
    median(
      pitchyFrequencies
    );

  /*
   * ==========================================================
   * STEP 3 — Autocorrelation analysis
   * ==========================================================
   */

  const autocorrelationResults =
    analyzeAutocorrelationWindows(
      samples,
      sampleRate
    );

  const autocorrelationFrequencies =
    autocorrelationResults.map(
      result =>
        result.frequency
    );

  const autocorrelationMedian =
    median(
      autocorrelationFrequencies
    );

  /*
   * ==========================================================
   * STEP 4 — Require actual waveform pitch evidence
   * ==========================================================
   */

  if (
    autocorrelationResults.length <
    MIN_AUTOCORRELATION_RESULTS
  ) {
    console.warn(
      '⚠️ Comfortable note rejected: not enough waveform pitch evidence.',
      {
        pitchyFrames:
          validPitchyFrames.length,

        autocorrelationResults:
          autocorrelationResults.length,

        autocorrelationFrequencies:
          autocorrelationFrequencies.map(
            value =>
              Number(
                value.toFixed(2)
              )
          ),
      }
    );

    return null;
  }

  if (
    !autocorrelationMedian ||
    !isValidFrequency(
      autocorrelationMedian
    )
  ) {
    return null;
  }

  /*
   * ==========================================================
   * STEP 5 — Check consistency between autocorrelation
   * windows
   * ==========================================================
   */

  const consistentAutoResults =
    autocorrelationResults.filter(
      result =>
        Math.abs(
          centsDifference(
            result.frequency,
            autocorrelationMedian
          )
        ) <= 100
    );

  const autoConsistency =
    consistentAutoResults.length /
    autocorrelationResults.length;

  /*
   * A sustained comfortable note should not jump
   * dramatically between analysis windows.
   */
  if (
    autoConsistency < 0.60
  ) {
    console.warn(
      '⚠️ Comfortable note rejected: waveform pitch is unstable.',
      {
        autocorrelationMedian,

        autoConsistency,

        frequencies:
          autocorrelationFrequencies.map(
            value =>
              Number(
                value.toFixed(2)
              )
          ),
      }
    );

    return null;
  }

  /*
   * ==========================================================
   * STEP 6 — Combine Pitchy and waveform evidence
   * ==========================================================
   */

  let finalFrequency =
    autocorrelationMedian;

  /*
   * If Pitchy agrees with the waveform estimate,
   * calculate the final frequency using both sources.
   */
  if (
    pitchyMedian &&
    isValidFrequency(
      pitchyMedian
    )
  ) {
    const difference =
      Math.abs(
        centsDifference(
          pitchyMedian,
          autocorrelationMedian
        )
      );

    /*
     * Normal agreement.
     */
    if (
      difference <= 100
    ) {
      finalFrequency =
        (
          pitchyMedian +
          autocorrelationMedian
        ) / 2;
    }

    /*
     * One-octave disagreement.
     *
     * Never blindly trust Pitchy here.
     *
     * The waveform estimate remains the primary
     * source because it is calculated directly from
     * the recorded samples.
     */
    else {
      const octaveUp =
        pitchyMedian * 2;

      const octaveDown =
        pitchyMedian / 2;

      const autoVsOctaveUp =
        Math.abs(
          centsDifference(
            autocorrelationMedian,
            octaveUp
          )
        );

      const autoVsOctaveDown =
        Math.abs(
          centsDifference(
            autocorrelationMedian,
            octaveDown
          )
        );

      if (
        autoVsOctaveUp > 100 &&
        autoVsOctaveDown > 100
      ) {
        /*
         * They disagree by something other than
         * an octave, so trust the waveform detector.
         */
        finalFrequency =
          autocorrelationMedian;
      } else {
        /*
         * They are octave-related.
         *
         * Use the waveform-derived frequency rather
         * than manufacturing a correction from Pitchy.
         */
        finalFrequency =
          autocorrelationMedian;
      }
    }
  }

  /*
   * ==========================================================
   * STEP 7 — Final frequency validation
   * ==========================================================
   */

  if (
    !isValidFrequency(
      finalFrequency
    ) ||
    finalFrequency <
      COMFORTABLE_NOTE_MIN_HZ ||
    finalFrequency >
      COMFORTABLE_NOTE_MAX_HZ
  ) {
    return null;
  }

  /*
   * ==========================================================
   * STEP 8 — Calculate clarity
   * ==========================================================
   */

  let clarity = 0;

  if (
    validPitchyFrames.length > 0
  ) {
    const clarityValues =
      validPitchyFrames
        .map(
          frame =>
            frame.clarity
        )
        .filter(
          value =>
            Number.isFinite(
              value
            )
        );

    if (
      clarityValues.length > 0
    ) {
      clarity =
        clarityValues.reduce(
          (sum, value) =>
            sum + value,
          0
        ) /
        clarityValues.length;
    }
  }

  /*
   * If Pitchy did not produce a usable clarity value,
   * use autocorrelation confidence as the confidence
   * measure rather than returning an artificial 100%.
   */
  const autoConfidence =
    autocorrelationResults.reduce(
      (sum, result) =>
        sum +
        result.confidence,
      0
    ) /
    autocorrelationResults.length;

  if (
    clarity <= 0
  ) {
    clarity =
      autoConfidence;
  }

  /*
   * ==========================================================
   * STEP 9 — Stability
   * ==========================================================
   */

  const stabilityFrequencies =
    autocorrelationResults
      .map(
        result =>
          result.frequency
      )
      .filter(
        isValidFrequency
      );

  let stabilityPct = 0;

  if (
    stabilityFrequencies.length >= 2
  ) {
    const deviations =
      stabilityFrequencies.map(
        frequency =>
          Math.abs(
            centsDifference(
              frequency,
              finalFrequency
            )
          )
      );

    const averageDeviation =
      deviations.reduce(
        (sum, value) =>
          sum + value,
        0
      ) /
      deviations.length;

    stabilityPct =
      Math.max(
        0,
        Math.min(
          100,
          100 -
          (
            averageDeviation /
            75
          ) *
          100
        )
      );
  }

  /*
   * ==========================================================
   * STEP 10 — Final diagnostic
   * ==========================================================
   */

  console.log(
    '🎵 COMFORTABLE NOTE ANALYSIS:',
    {
      finalFrequency:
        Number(
          finalFrequency.toFixed(2)
        ),

      pitchyMedian:
        pitchyMedian
          ? Number(
              pitchyMedian.toFixed(2)
            )
          : null,

      autocorrelationMedian:
        Number(
          autocorrelationMedian.toFixed(2)
        ),

      autocorrelationFrequencies:
        autocorrelationFrequencies.map(
          value =>
            Number(
              value.toFixed(2)
            )
        ),

      autocorrelationConfidence:
        Number(
          autoConfidence.toFixed(3)
        ),

      clarity:
        Number(
          clarity.toFixed(3)
        ),

      stabilityPct:
        Number(
          stabilityPct.toFixed(1)
        ),

      rms:
        Number(
          overallRms.toFixed(6)
        ),

      peak:
        Number(
          peak.toFixed(6)
        ),

      pitchyFrames:
        validPitchyFrames.length,

      autocorrelationFrames:
        autocorrelationResults.length,

      autoConsistency:
        Number(
          autoConsistency.toFixed(2)
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
          clarity
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
   * If either recording is bad, stop here.
   *
   * Most importantly, we do NOT substitute a default
   * frequency such as 100 Hz.
   */
  if (
    !low ||
    !high
  ) {
    throw new Error(
      'We could not detect both comfortable notes. Please sing each note steadily and clearly, then try again.'
    );
  }

  /*
   * High note must be higher than low note.
   */
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

  /*
   * Three semitones is the minimum acceptable separation.
   */
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
  // COMPONENT SCORES
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


  console.log(
    '🧪 Measuring pitch...'
  );

  const pitchScore =
    safeMetric(
      'Pitch',
      () =>
        measurePitch(
          audio.pitchSamples,
          audio.sampleRate
        )
    );

  console.log(
    '🧪 Pitch score:',
    pitchScore
  );


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


  console.log(
    '🧪 Measuring agility...'
  );

  const agilityScore =
    safeMetric(
      'Agility',
      () =>
        measureAgility(
          audio.agilitySamples,
          audio.sampleRate
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
  // VOCAL RANGE
  // ==========================================================

  console.log(
    '🧪 Detecting vocal range...'
  );

  /*
   * Range remains outside safeMetric because a failed
   * range calibration should produce an actual user-facing
   * error instead of silently becoming 0.
   */
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
    '✅ VOICE ASSESSMENT COMPLETE'
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

    result[
      currentScore.componentId
    ] =
      currentScore.scorePct -
      (
        previousScore?.scorePct ??
        0
      );
  }

  return result;
}