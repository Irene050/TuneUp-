import {
  analyzeVolumeWindows,
} from '@/utils/dsp/volumeAnalysis';

export interface VolumeControlStabilityMeasurement {
  repStability: number[];
  stability: number;
  durationScore: number;
  averageDb: number;
  minDb: number;
  maxDb: number;
  voicedCoveragePercent: number;
  measurementQuality: number;
  durationSeconds: number;
  repetitionCount: number;
}

/* =========================================================
   CONSTANTS
   ========================================================= */

const WINDOW_MS = 50;
const SILENCE_DBFS = -60;

/* =========================================================
   AVERAGE
   ========================================================= */

export function calcMean(
  values: number[],
): number {
  if (values.length === 0) {
    return 0;
  }

  return (
    values.reduce(
      (sum, value) => sum + value,
      0,
    ) / values.length
  );
}

/* =========================================================
   STANDARD DEVIATION
   ========================================================= */

export function calcStandardDeviation(
  values: number[],
): number {
  if (values.length < 2) {
    return 0;
  }

  const mean = calcMean(values);

  const variance =
    values.reduce(
      (sum, value) =>
        sum + Math.pow(value - mean, 2),
      0,
    ) / values.length;

  return Math.sqrt(variance);
}

/* =========================================================
   VOLUME STABILITY
   ========================================================= */

export function calcVolumeStability(
  values: number[],
): number {
  const validValues = values.filter(
    (value) => Number.isFinite(value),
  );

  if (validValues.length < 2) {
    return 0;
  }

  const mean = calcMean(validValues);

  if (!Number.isFinite(mean) || mean === 0) {
    return 0;
  }

  const standardDeviation =
    calcStandardDeviation(validValues);

  const stability =
    100 -
    (standardDeviation / Math.abs(mean)) * 100;

  return Math.max(
    0,
    Math.min(100, stability),
  );
}

/* =========================================================
   REPETITION MEASUREMENT
   ========================================================= */

function measureRepetition(
  amplitudes: number[],
  voicedFlags: boolean[],
  startWindow: number,
  endWindow: number,
): number {
  const repetitionValues: number[] = [];

  for (
    let index = startWindow;
    index < endWindow;
    index += 1
  ) {
    if (
      voicedFlags[index] &&
      Number.isFinite(amplitudes[index]) &&
      amplitudes[index] > 0
    ) {
      repetitionValues.push(amplitudes[index]);
    }
  }

  return calcVolumeStability(repetitionValues);
}

/* =========================================================
   MAIN MEASUREMENT FUNCTION
   ========================================================= */

export function measureVolumeControlStability(
  samples: Float32Array,
  sampleRate: number,
  repetitionDurationSeconds = 5,
  repetitionCount = 2,
): VolumeControlStabilityMeasurement {
  const safeRepetitionCount =
    Number.isFinite(repetitionCount)
      ? Math.max(0, Math.floor(repetitionCount))
      : 2;

  const safeRepetitionDuration =
    Number.isFinite(repetitionDurationSeconds) &&
    repetitionDurationSeconds > 0
      ? repetitionDurationSeconds
      : 5;

  const emptyResult: VolumeControlStabilityMeasurement = {
    repStability: Array(safeRepetitionCount).fill(0),
    stability: 0,
    durationScore: 0,
    averageDb: SILENCE_DBFS,
    minDb: SILENCE_DBFS,
    maxDb: SILENCE_DBFS,
    voicedCoveragePercent: 0,
    measurementQuality: 0,
    durationSeconds: 0,
    repetitionCount: safeRepetitionCount,
  };

  if (
    !samples ||
    samples.length === 0 ||
    !Number.isFinite(sampleRate) ||
    sampleRate <= 0
  ) {
    return emptyResult;
  }

  const durationSeconds =
    samples.length / sampleRate;

  const {
    rmsArray,
    dbArray,
    voicedArray,
    windowSize,
  } = analyzeVolumeWindows(
    samples,
    sampleRate,
    WINDOW_MS,
    SILENCE_DBFS,
  );

  if (rmsArray.length === 0 || windowSize <= 0) {
    return {
      ...emptyResult,
      durationSeconds,
    };
  }

  /* -------------------------------------------------------
     VOICED WINDOWS AND COVERAGE
     ------------------------------------------------------- */

  const voicedRms = rmsArray.filter(
    (_, index) => voicedArray[index],
  );

  const voicedDb = dbArray.filter(
    (_, index) => voicedArray[index],
  );

  const totalWindows = rmsArray.length;
  const voicedWindows = voicedRms.length;

  const voicedCoveragePercent =
    totalWindows > 0
      ? (voicedWindows / totalWindows) * 100
      : 0;

  const durationScore = Math.max(
    0,
    Math.min(100, voicedCoveragePercent),
  );

  /* -------------------------------------------------------
     VOLUME STATISTICS
     ------------------------------------------------------- */

  // Calculate these before any low-coverage decision.
  // Silence/no voiced windows must not report 0 dBFS.
  const averageDb =
    voicedDb.length > 0
      ? calcMean(voicedDb)
      : SILENCE_DBFS;

  const minDb =
    voicedDb.length > 0
      ? Math.min(...voicedDb)
      : SILENCE_DBFS;

  const maxDb =
    voicedDb.length > 0
      ? Math.max(...voicedDb)
      : SILENCE_DBFS;

  /* -------------------------------------------------------
     OVERALL STABILITY
     ------------------------------------------------------- */

  const stability =
    calcVolumeStability(voicedRms);

  /* -------------------------------------------------------
     REPETITION STABILITY
     ------------------------------------------------------- */

  const repStability: number[] = [];

  const samplesPerRepetition =
    sampleRate * safeRepetitionDuration;

  for (
    let repetition = 0;
    repetition < safeRepetitionCount;
    repetition += 1
  ) {
    const repetitionStartSample = Math.round(
      repetition * samplesPerRepetition,
    );

    const repetitionEndSample = Math.min(
      samples.length,
      Math.round(
        (repetition + 1) * samplesPerRepetition,
      ),
    );

    const startWindow = Math.floor(
      repetitionStartSample / windowSize,
    );

    const endWindow = Math.min(
      rmsArray.length,
      Math.ceil(repetitionEndSample / windowSize),
    );

    repStability.push(
      measureRepetition(
        rmsArray,
        voicedArray,
        startWindow,
        endWindow,
      ),
    );
  }

  /* -------------------------------------------------------
     MEASUREMENT QUALITY
     ------------------------------------------------------- */

  const coverageQuality = Math.max(
    0,
    Math.min(100, voicedCoveragePercent),
  );

  const measurementQuality =
    coverageQuality * 0.5 +
    stability * 0.5;

  return {
    repStability,
    stability,
    durationScore,
    averageDb,
    minDb,
    maxDb,
    voicedCoveragePercent,
    measurementQuality,
    durationSeconds,
    repetitionCount: safeRepetitionCount,
  };
}