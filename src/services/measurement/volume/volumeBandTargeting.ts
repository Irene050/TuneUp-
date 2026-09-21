import {
    calcRMSWindows,
    toDbArray,
} from '@/utils/dsp/volumeAnalysis';

const WINDOW_MS = 50;

const TARGET_MIN = 40;
const TARGET_MAX = 55;

const DURATION_SECONDS = 3;
const REPETITIONS = 2;

const TOLERANCE_DB = 5;

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

function clamp(
  value: number,
  min: number,
  max: number,
) {
  return Math.max(
    min,
    Math.min(max, value),
  );
}

function average(
  values: number[],
) {
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
) {
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
) {
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
) {
  if (!Number.isFinite(value)) {
    return false;
  }

  return (
    value >=
      TARGET_MIN - TOLERANCE_DB &&
    value <=
      TARGET_MAX + TOLERANCE_DB
  );
}

function emptyMeasurement(): VolumeBandMeasurement {
  const expectedWindowCount =
    Math.round(
      (DURATION_SECONDS * 1000) /
        WINDOW_MS,
    ) * REPETITIONS;

  return {
    dbValues: [],
    repConsistency: [0, 0],
    consistency: 0,
    averageDb: 0,
    minDb: 0,
    maxDb: 0,
    targetReached: false,
    repTargetReached: [
      false,
      false,
    ],
    validWindowCount: 0,
    expectedWindowCount,
    measurementQuality: 0,
  };
}

export function measureVolumeBandTargeting(
  samples: Float32Array,
  sampleRate = 44100,
): VolumeBandMeasurement {
  if (
    samples.length === 0 ||
    sampleRate <= 0
  ) {
    return emptyMeasurement();
  }

  /*
   * PCM
   * ↓
   * 50 ms RMS
   * ↓
   * dB
   */
  const rmsValues =
    calcRMSWindows(
      samples,
      WINDOW_MS,
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
    return emptyMeasurement();
  }

  const windowsPerRep =
    Math.max(
      1,
      Math.round(
        (DURATION_SECONDS *
          1000) /
          WINDOW_MS,
      ),
    );

  const expectedWindowCount =
    windowsPerRep *
    REPETITIONS;

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
      { length: REPETITIONS },
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
      { length: REPETITIONS },
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
    Math.min(
      ...effectiveValues,
    );

  const maxDb =
    Math.max(
      ...effectiveValues,
    );

  const targetReached =
    isInsideTargetBand(
      averageDb,
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