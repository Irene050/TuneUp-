import {
  calcRMSWindows,
  toDbArray,
} from '@/utils/dsp/volumeAnalysis';

const DEFAULT_WINDOW_MS = 50;

const DEFAULT_TARGET_RANGE: [number, number] = [
  45,
  55,
];

const DEFAULT_DURATION_SECONDS = 3;
const DEFAULT_REPETITIONS = 2;
const DEFAULT_TOLERANCE_DB = 7;
const VOLUME_DISPLAY_OFFSET_DB = 70;
const SILENCE_THRESHOLD_DBFS = -60;

const CONSISTENCY_STDDEV_RANGE_DB = 20;

export interface VolumeBandMeasurement {
  dbValues: number[];
  repConsistency: number[];
  consistency: number;
  averageDb: number;
  minDb: number;
  maxDb: number;
  targetReached: boolean;
  repTargetReached: boolean[];
  validWindowCount: number;
  expectedWindowCount: number;
  measurementQuality: number;
}

interface MeasureOptions {
  windowMs?: number;
  targetDbRange?: [number, number];
  durationSec?: number;
  repetitions?: number;
  toleranceDb?: number;
}

function clamp(
  value: number,
  min: number,
  max: number,
): number {
  return Math.max(min, Math.min(max, value));
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return (
    values.reduce((sum, value) => sum + value, 0) /
    values.length
  );
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) {
    return 0;
  }

  const mean = average(values);

  const variance = average(
    values.map((value) => (value - mean) ** 2),
  );

  return Math.sqrt(Math.max(variance, 0));
}

export function calculateVolumeConsistency(
  dbValues: number[],
): number {
  const finiteValues = dbValues.filter(Number.isFinite);

  if (finiteValues.length < 2) {
    return 0;
  }

  const stdDev = standardDeviation(finiteValues);

  return clamp(
    100 -
      (stdDev / CONSISTENCY_STDDEV_RANGE_DB) * 100,
    0,
    100,
  );
}

function isInsideTargetBand(
  value: number,
  targetDbRange: [number, number],
  toleranceDb: number,
): boolean {
  if (!Number.isFinite(value)) {
    return false;
  }

  const targetMin = Math.min(
    targetDbRange[0],
    targetDbRange[1],
  );

  const targetMax = Math.max(
    targetDbRange[0],
    targetDbRange[1],
  );

  return (
    value >= targetMin - toleranceDb &&
    value <= targetMax + toleranceDb
  );
}

function createEmptyMeasurement(
  windowMs: number,
  durationSec: number,
  repetitions: number,
): VolumeBandMeasurement {
  const safeWindowMs =
    Number.isFinite(windowMs) && windowMs > 0
      ? windowMs
      : DEFAULT_WINDOW_MS;

  const safeDurationSec =
    Number.isFinite(durationSec) && durationSec > 0
      ? durationSec
      : DEFAULT_DURATION_SECONDS;

  const windowsPerRep = Math.max(
    1,
    Math.round((safeDurationSec * 1000) / safeWindowMs),
  );

  const expectedWindowCount = windowsPerRep * repetitions;

  return {
    dbValues: [],
    repConsistency: Array.from(
      { length: repetitions },
      () => 0,
    ),
    consistency: 0,
    averageDb: 0,
    minDb: 0,
    maxDb: 0,
    targetReached: false,
    repTargetReached: Array.from(
      { length: repetitions },
      () => false,
    ),
    validWindowCount: 0,
    expectedWindowCount,
    measurementQuality: 0,
  };
}

export function measureVolumeBandTargeting(
  samples: Float32Array,
  sampleRate = 44100,
  options: MeasureOptions = {},
): VolumeBandMeasurement {
  const windowMs =
    options.windowMs ?? DEFAULT_WINDOW_MS;

  const targetDbRange =
    options.targetDbRange ?? DEFAULT_TARGET_RANGE;

  const durationSec =
    options.durationSec ?? DEFAULT_DURATION_SECONDS;

  const repetitions = Math.max(
    1,
    Math.round(
      options.repetitions ?? DEFAULT_REPETITIONS,
    ),
  );

  const toleranceDb = Math.max(
    0,
    options.toleranceDb ?? DEFAULT_TOLERANCE_DB,
  );

  if (
    !samples ||
    samples.length === 0 ||
    !Number.isFinite(sampleRate) ||
    sampleRate <= 0 ||
    !Number.isFinite(windowMs) ||
    windowMs <= 0 ||
    !Number.isFinite(durationSec) ||
    durationSec <= 0
  ) {
    return createEmptyMeasurement(
      windowMs,
      durationSec,
      repetitions,
    );
  }

  const rmsValues = calcRMSWindows(
    samples,
    windowMs,
    sampleRate,
  );

  const rawDbValues = toDbArray(rmsValues);

  if (rawDbValues.length === 0) {
    return createEmptyMeasurement(
      windowMs,
      durationSec,
      repetitions,
    );
  }

  const shiftedDbValues: Array<number | null> =
    rawDbValues.map((db) => {
      if (!Number.isFinite(db) || db < SILENCE_THRESHOLD_DBFS) {
        return null;
      }

      return db + VOLUME_DISPLAY_OFFSET_DB;
    });

  const windowsPerRep = Math.max(
    1,
    Math.round((durationSec * 1000) / windowMs),
  );

  const expectedWindowCount =
    windowsPerRep * repetitions;

  const effectiveValues = shiftedDbValues.slice(
    0,
    expectedWindowCount,
  );

  const repConsistency = Array.from(
    { length: repetitions },
    (_, repIndex) => {
      const start = repIndex * windowsPerRep;
      const end = Math.min(
        start + windowsPerRep,
        effectiveValues.length,
      );

      const repValues = effectiveValues
        .slice(start, end)
        .filter((value): value is number => value !== null);

      return calculateVolumeConsistency(repValues);
    },
  );

  const repTargetReached = Array.from(
    { length: repetitions },
    (_, repIndex) => {
      const start = repIndex * windowsPerRep;
      const end = Math.min(
        start + windowsPerRep,
        effectiveValues.length,
      );

      const repValues = effectiveValues
        .slice(start, end)
        .filter((value): value is number => value !== null);

      if (repValues.length === 0) {
        return false;
      }

      return isInsideTargetBand(
        average(repValues),
        targetDbRange,
        toleranceDb,
      );
    },
  );

  const allValidValues = effectiveValues.filter(
    (value): value is number => value !== null,
  );

  const consistency = average(repConsistency);
  const averageDb = average(allValidValues);

  const minDb =
    allValidValues.length > 0
      ? Math.min(...allValidValues)
      : 0;

  const maxDb =
    allValidValues.length > 0
      ? Math.max(...allValidValues)
      : 0;

  const targetReached =
    allValidValues.length > 0 &&
    isInsideTargetBand(
      averageDb,
      targetDbRange,
      toleranceDb,
    );

  const measurementQuality = clamp(
    (allValidValues.length / expectedWindowCount) * 100,
    0,
    100,
  );

  return {
    dbValues: allValidValues,
    repConsistency,
    consistency,
    averageDb,
    minDb,
    maxDb,
    targetReached,
    repTargetReached,
    validWindowCount: allValidValues.length,
    expectedWindowCount,
    measurementQuality,
  };
}