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

export interface AssessmentResult {
  vocalRange: VocalRange;

  /**
   * Kept for compatibility with the previous version.
   */
  vocalRangeLowHz: number;
  vocalRangeHighHz: number;

  scores: ComponentScore[];

  recommendations: Record<
    ComponentId,
    RecommendationBand
  >;

  timestamp: number;
}


/**
 * Audio recorded specifically for the assessment.
 *
 * This does NOT come from any exercise module.
 *
 * The AssessmentScreen is responsible for recording the
 * individual sections and placing them into this bundle.
 */
export interface AssessmentAudioBundle {
  breathControlSamples: Float32Array;

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

/**
 * These values are also useful to the assessment screen
 * when creating the guided recording sequence.
 */
export const ASSESSMENT_DURATION = {
  breathControl: 12,
  pitch: 5,
  tone: 5,
  volume: 5,
  agility: 5,
  comfortableNote: 2,
} as const;


// ============================================================
// GENERAL HELPERS
// ============================================================

function clampScore(score: number): number {
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
// BREATH CONTROL
// ============================================================

function measureBreathControl(
  samples: Float32Array,
  sampleRate: number
): number {
  if (
    sampleRate <= 0 ||
    samples.length === 0
  ) {
    return 0;
  }

  /*
   * First determine how long the intentional sound/exhale
   * actually lasts.
   *
   * This prevents the assessment from simply assuming that
   * the user successfully exhaled for the entire recording.
   */
  const onsetOffset = detectOnsetOffset(
    samples,
    0.02,
    sampleRate
  );

  const actualDurationSec =
    onsetOffset.durationSeconds;

  if (actualDurationSec <= 0) {
    return 0;
  }

  /*
   * Maximum target duration = 12 seconds.
   */
  const durationScore =
    Math.min(
      actualDurationSec /
        ASSESSMENT_DURATION.breathControl,
      1
    ) * 100;

  /*
   * Airflow stability is estimated using RMS amplitude
   * variation from your airflow utility.
   */
  const stability =
    calcAirflowStability(
      samples,
      50,
      sampleRate
    );

  /*
   * Duration and stability are equally weighted.
   */
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
    sampleRate <= 0 ||
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

  const voicedFrames =
    filterByClarity(
      frames,
      0.8
    );

  if (
    voicedFrames.length === 0
  ) {
    return 0;
  }

  const frequencies =
    voicedFrames
      .map(frame => frame.frequency)
      .filter(
        frequency =>
          Number.isFinite(frequency) &&
          frequency > 0
      );

  if (
    frequencies.length === 0
  ) {
    return 0;
  }

  /*
   * Measures how stable the detected pitch is.
   */
  const stability =
    calcJitterStability(
      frequencies
    );

  /*
   * Average pitch clarity.
   */
  const clarity =
    voicedFrames.reduce(
      (sum, frame) =>
        sum + frame.clarity,
      0
    ) / voicedFrames.length;

  const clarityScore =
    clampScore(
      clarity * 100
    );

  /*
   * Pitch assessment:
   *
   * 50% pitch stability
   * 50% detection clarity
   */
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
    sampleRate <= 0 ||
    samples.length === 0
  ) {
    return 0;
  }

  /*
   * 50 ms analysis frames.
   */
  const frameSize =
    Math.floor(
      (50 / 1000) *
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

    /*
     * Your FFT implementation requires a
     * power-of-two input size.
     */
    let fftSize = 1;

    while (
      fftSize * 2 <= frame.length
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

    const magnitudes =
      computeFFTMagnitudes(
        fftFrame
      );

    const centroid =
      computeSpectralCentroid(
        magnitudes,
        sampleRate,
        fftSize
      );

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

  /*
   * Tone consistency is based on how smoothly
   * the spectral centroid behaves over time.
   */
  return clampScore(
    calcSmoothness(
      centroids
    )
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
    sampleRate <= 0 ||
    samples.length === 0
  ) {
    return 0;
  }

  /*
   * Calculate RMS values in 50 ms windows.
   */
  const rmsValues =
    calcRMSWindows(
      samples,
      50,
      sampleRate
    );

  if (
    rmsValues.length === 0
  ) {
    return 0;
  }

  /*
   * Convert RMS amplitudes to dB.
   */
  const dbValues =
    toDbArray(
      rmsValues
    );

  /*
   * Evaluate how consistently the volume
   * changes throughout the recording.
   */
  const rampConsistency =
    calcRampConsistency(
      dbValues
    );

  /*
   * Evaluate overall volume consistency.
   */
  const volumeConsistency =
    calcVolumeConsistency(
      dbValues
    );

  /*
   * Both measurements contribute equally.
   */
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
    sampleRate <= 0 ||
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

  const voicedFrames =
    filterByClarity(
      frames,
      0.8
    );

  if (
    voicedFrames.length < 2
  ) {
    return 0;
  }

  /*
   * Detect meaningful pitch changes.
   */
  const transitions =
    detectPitchChanges(
      voicedFrames,
      15
    );

  const durationSec =
    samples.length /
    sampleRate;

  const speed =
    calcTransitionSpeed(
      transitions.length,
      durationSec
    );

  /*
   * Five transitions per second is treated
   * as the maximum target.
   */
  const speedScore =
    Math.min(
      speed / 5,
      1
    ) * 100;

  /*
   * Also consider pitch stability so that
   * simply singing extremely fast does not
   * automatically produce a high score.
   */
  const frequencies =
    voicedFrames.map(
      frame => frame.frequency
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
// VOCAL RANGE
// ============================================================


interface ComfortableNoteMeasurement {
  frequency: number;
  clarity: number;
  stabilityPct: number;
}


// ============================================================
// DETECT COMFORTABLE NOTE
// ============================================================

function detectComfortableNote(
  samples: Float32Array,
  sampleRate: number
): ComfortableNoteMeasurement | null {

  if (
    sampleRate <= 0 ||
    samples.length === 0
  ) {
    return null;
  }

  /*
   * The user should sing for at least approximately
   * 0.75 seconds.
   */
  const minimumSamples =
    Math.floor(
      sampleRate * 0.75
    );

  if (
    samples.length < minimumSamples
  ) {
    return null;
  }


  // ----------------------------------------------------------
  // PITCH TRACKING
  // ----------------------------------------------------------

  const frames =
    trackPitchOverTime(
      samples,
      30,
      sampleRate
    );

  if (
    frames.length === 0
  ) {
    return null;
  }

  console.log(
  '🔍 RAW FRAMES (low/high):',
  frames.map(f => ({
    freq: f.frequency.toFixed(1),
    clarity: f.clarity.toFixed(2),
  }))
);

  /*
   * Do NOT use filterByClarity() here.
   *
   * For vocal-range detection, we want to inspect
   * all detected frequencies first and only reject
   * obviously invalid values.
   *
   * This is more tolerant of phone microphone recordings.
   */
  const validFrames =
  frames.filter(
    frame =>
      Number.isFinite(
        frame.frequency
      ) &&
      frame.frequency >= 60 &&      // was 80
      frame.frequency <= 1500 &&
      Number.isFinite(
        frame.clarity
      ) &&
      frame.clarity >= 0.45          // was 0.6
  );


  /*
   * We need enough frames to determine whether
   * the note is actually stable.
   */
  if (
    validFrames.length < 5
  ) {
    return null;
  }


  // ----------------------------------------------------------
  // FREQUENCY
  // ----------------------------------------------------------

  /*
   * Sort frequencies and use the median instead of
   * the average.
   *
   * The median is more resistant to occasional
   * incorrect pitch detections.
   */
  const sortedFrequencies =
    validFrames
      .map(
        frame =>
          frame.frequency
      )
      .sort(
        (a, b) => a - b
      );

  const middle =
    Math.floor(
      sortedFrequencies.length / 2
    );

  const frequency =
    sortedFrequencies.length % 2 === 0
      ? (
          sortedFrequencies[
            middle - 1
          ] +
          sortedFrequencies[
            middle
          ]
        ) / 2
      : sortedFrequencies[
          middle
        ];


  if (
    !Number.isFinite(
      frequency
    ) ||
    frequency <= 0
  ) {
    return null;
  }


  // ----------------------------------------------------------
  // CLARITY
  // ----------------------------------------------------------

  const clarity =
    validFrames.reduce(
      (sum, frame) =>
        sum + frame.clarity,
      0
    ) /
    validFrames.length;


  // ----------------------------------------------------------
  // PITCH STABILITY
  // ----------------------------------------------------------

  /*
   * Calculate the average pitch deviation
   * from the median frequency in cents.
   */
  const centsDeviations =
    validFrames.map(
      frame =>
        Math.abs(
          1200 *
          Math.log2(
            frame.frequency /
              frequency
          )
        )
    );


  const averageCentsDeviation =
    centsDeviations.reduce(
      (sum, value) =>
        sum + value,
      0
    ) /
    centsDeviations.length;


  /*
   * 75 cents = maximum expected variation
   * for a usable comfortable-note recording.
   */
  const stabilityPct =
    Math.max(
      0,
      Math.min(
        100,
        100 -
          (
            averageCentsDeviation /
            75
          ) *
            100
      )
    );


  return {
    frequency,
    clarity,
    stabilityPct,
  };
}


// ============================================================
// VOCAL RANGE
// ============================================================

export function getVocalRange(
  audio: AssessmentAudioBundle
): VocalRange {

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


  /*
   * Debug information.
   *
   * This will tell us whether the problem is
   * the LOW recording or the HIGH recording.
   */
  console.log(
    '🎵 VOCAL RANGE LOW:',
    low
  );

  console.log(
    '🎵 VOCAL RANGE HIGH:',
    high
  );


  if (
    !low ||
    !high
  ) {
    throw new Error(
      'We could not detect both comfortable notes. Please sing each note steadily and clearly, then try again.'
    );
  }


  // ----------------------------------------------------------
  // LOW MUST BE LOWER THAN HIGH
  // ----------------------------------------------------------

  if (
    low.frequency >=
    high.frequency
  ) {
    throw new Error(
      'The highest comfortable note must be above the lowest comfortable note. Please try again.'
    );
  }


  // ----------------------------------------------------------
  // MINIMUM RANGE
  // ----------------------------------------------------------

  const semitoneSpan =
    12 *
    Math.log2(
      high.frequency /
        low.frequency
    );


  if (
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
// RUN ASSESSMENT
// ============================================================

/**
 * Runs the TuneUp diagnostic assessment.
 *
 * IMPORTANT:
 * This function does not know anything about exercise modules.
 *
 * It only receives raw audio captured specifically for
 * the assessment.
 */
export function runAssessment(
  audio: AssessmentAudioBundle
): AssessmentResult {
  if (
    audio.sampleRate <= 0
  ) {
    throw new Error(
      'Invalid audio sample rate.'
    );
  }

  const breathScore =
    measureBreathControl(
      audio.breathControlSamples,
      audio.sampleRate
    );

  const pitchScore =
    measurePitch(
      audio.pitchSamples,
      audio.sampleRate
    );

  const toneScore =
    measureTone(
      audio.toneSamples,
      audio.sampleRate
    );

  const volumeScore =
    measureVolume(
      audio.volumeSamples,
      audio.sampleRate
    );

  const agilityScore =
    measureAgility(
      audio.agilitySamples,
      audio.sampleRate
    );

  const scores: ComponentScore[] = [
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

  const vocalRange =
    getVocalRange(
      audio
    );

  return {
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
}


// ============================================================
// COMPARE ASSESSMENTS
// ============================================================

/**
 * Compares two assessment results.
 *
 * Positive number = improvement.
 * Negative number = decrease.
 */
export function compareAssessments(
  previous: AssessmentResult,
  current: AssessmentResult
): Record<ComponentId, number> {
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