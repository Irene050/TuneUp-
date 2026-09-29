import {
  calcRMSWindows,
  toDbArray,
} from '@/utils/dsp/volumeAnalysis';

const DEFAULT_WINDOW_MS = 50;

const DEFAULT_TARGET_RANGE: [number, number] = [
  40,
  55,
];

const DEFAULT_DURATION_SECONDS = 3;
const DEFAULT_REPETITIONS = 2;
const DEFAULT_TOLERANCE_DB = 5;

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
  return Math.max(
    min,
    Math.min(max, value),
  );
}

function average(
  values: number[],
): number {
  if (values.length === 0) {
    return 0;
  }

  return (
    values.reduce(
      (sum, value) =>
        sum + value,
      0,
    ) / values.length
  );
}

function standardDeviation(
  values: number[],
): number {
  if (values.length < 2) {
    return 0;
  }

  const mean =
    average(values);

  const variance =
    average(
      values.map(
        (value) =>
          (value - mean) ** 2,
      ),
    );

  return Math.sqrt(
    Math.max(variance, 0),
  );
}

export function calculateVolumeConsistency(
  dbValues: number[],
): number {
  if (dbValues.length < 2) {
    return 0;
  }

  const finiteValues =
    dbValues.filter(
      Number.isFinite,
    );

  if (
    finiteValues.length < 2
  ) {
    return 0;
  }

  const mean =
    average(finiteValues);

  if (
    !Number.isFinite(mean) ||
    mean <= 0
  ) {
    return 0;
  }

  const stdDev =
    standardDeviation(
      finiteValues,
    );

  return clamp(
    100 -
      (stdDev / mean) * 100,
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

  const targetMin =
    Math.min(
      targetDbRange[0],
      targetDbRange[1],
    );

  const targetMax =
    Math.max(
      targetDbRange[0],
      targetDbRange[1],
    );

  return (
    value >=
      targetMin - toleranceDb &&
    value <=
      targetMax + toleranceDb
  );
}

function createEmptyMeasurement(
  windowMs: number,
  durationSec: number,
  repetitions: number,
): VolumeBandMeasurement {
  const windowsPerRep =
    Math.max(
      1,
      Math.round(
        (durationSec * 1000) /
          windowMs,
      ),
    );

  const expectedWindowCount =
    windowsPerRep *
    repetitions;

  return {
    dbValues: [],

    repConsistency:
      Array.from(
        {
          length:
            repetitions,
        },
        () => 0,
      ),

    consistency: 0,

    averageDb: 0,

    minDb: 0,
    maxDb: 0,

    targetReached: false,

    repTargetReached:
      Array.from(
        {
          length:
            repetitions,
        },
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
    options.windowMs ??
    DEFAULT_WINDOW_MS;

  const targetDbRange =
    options.targetDbRange ??
    DEFAULT_TARGET_RANGE;

  const durationSec =
    options.durationSec ??
    DEFAULT_DURATION_SECONDS;

  const repetitions =
    Math.max(
      1,
      Math.round(
        options.repetitions ??
          DEFAULT_REPETITIONS,
      ),
    );

  const toleranceDb =
    Math.max(
      0,
      options.toleranceDb ??
        DEFAULT_TOLERANCE_DB,
    );

  if (
    samples.length === 0 ||
    sampleRate <= 0
  ) {
    return createEmptyMeasurement(
      windowMs,
      durationSec,
      repetitions,
    );
  }

  /*
   * PCM
   * ↓
   * RMS windows
   * ↓
   * dB magnitude
   */
  const rmsValues =
    calcRMSWindows(
      samples,
      windowMs,
      sampleRate,
    );

  const dbValues =
    toDbArray(rmsValues)
      .filter(
        Number.isFinite,
      )
      .map((db) =>
        Math.abs(db),
      );

  if (dbValues.length === 0) {
    return createEmptyMeasurement(
      windowMs,
      durationSec,
      repetitions,
    );
  }

  const windowsPerRep =
    Math.max(
      1,
      Math.round(
        (durationSec * 1000) /
          windowMs,
      ),
    );

  const expectedWindowCount =
    windowsPerRep *
    repetitions;

  const effectiveValues =
    dbValues.slice(
      0,
      Math.min(
        dbValues.length,
        expectedWindowCount,
      ),
    );

  const repConsistency =
    Array.from(
      {
        length:
          repetitions,
      },
      (_, repIndex) => {
        const start =
          repIndex *
          windowsPerRep;

        const end =
          Math.min(
            start +
              windowsPerRep,
            effectiveValues.length,
          );

        return calculateVolumeConsistency(
          effectiveValues.slice(
            start,
            end,
          ),
        );
      },
    );

  const repTargetReached =
    Array.from(
      {
        length:
          repetitions,
      },
      (_, repIndex) => {
        const start =
          repIndex *
          windowsPerRep;

        const end =
          Math.min(
            start +
              windowsPerRep,
            effectiveValues.length,
          );

        const repValues =
          effectiveValues.slice(
            start,
            end,
          );

        if (
          repValues.length === 0
        ) {
          return false;
        }

        const repAverage =
          average(repValues);

        return isInsideTargetBand(
          repAverage,
          targetDbRange,
          toleranceDb,
        );
      },
    );

  const consistency =
    average(
      repConsistency,
    );

  const averageDb =
    average(
      effectiveValues,
    );

  const minDb =
    effectiveValues.length > 0
      ? Math.min(
          ...effectiveValues,
        )
      : 0;

  const maxDb =
    effectiveValues.length > 0
      ? Math.max(
          ...effectiveValues,
        )
      : 0;

  const targetReached =
    isInsideTargetBand(
      averageDb,
      targetDbRange,
      toleranceDb,
    );

  const measurementQuality =
    clamp(
      (
        effectiveValues.length /
        expectedWindowCount
      ) * 100,
      0,
      100,
    );

  return {
    dbValues:
      effectiveValues,

    repConsistency,

    consistency,

    averageDb,

    minDb,
    maxDb,

    targetReached,

    repTargetReached,

    validWindowCount:
      effectiveValues.length,

    expectedWindowCount,

    measurementQuality,
  };
}