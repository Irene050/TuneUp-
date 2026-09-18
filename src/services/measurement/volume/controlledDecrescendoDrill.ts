import {
    calcRMSWindows,
    toDbArray,
} from '@/utils/dsp/volumeAnalysis';

const WINDOW_MS = 50;

const START_VOLUME = 50;
const END_VOLUME = 40;

const DURATION_SECONDS = 4;
const REPETITIONS = 2;

const VOLUME_VARIANCE_PERCENT = 15;

export interface ControlledDecrescendoMeasurement {
  dbValues: number[];

  repSmoothness: number[];

  smoothness: number;

  startDb: number;
  endDb: number;

  minDb: number;
  maxDb: number;

  targetStartReached: boolean;
  targetEndReached: boolean;
  targetReached: boolean;

  directionCorrect: boolean;

  validWindowCount: number;
  expectedWindowCount: number;

  measurementQuality: number;
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

function variance(
  values: number[],
): number {
  if (values.length < 2) {
    return 0;
  }

  const mean =
    average(values);

  return average(
    values.map(
      (value) =>
        (value - mean) ** 2,
    ),
  );
}

/**
 * Decrescendo smoothness.

 * Formula:
 * 100 - (derivative variance /
 *        absolute mean derivative) * 100
 */
export function calculateDecrescendoSmoothness(
  dbValues: number[],
): number {
  if (dbValues.length < 3) {
    return 0;
  }

  const derivatives: number[] = [];

  for (
    let index = 1;
    index < dbValues.length;
    index += 1
  ) {
    derivatives.push(
      dbValues[index] -
        dbValues[index - 1],
    );
  }

  const meanDerivative =
    average(derivatives);

  if (
    !Number.isFinite(
      meanDerivative,
    ) ||
    meanDerivative >= 0
  ) {
    return 0;
  }

  const derivativeVariance =
    variance(derivatives);

  const smoothness =
    100 -
    (
      derivativeVariance /
      Math.abs(meanDerivative)
    ) *
      100;

  return clamp(
    smoothness,
    0,
    100,
  );
}

function targetTolerance(
  target: number,
): number {
  return (
    target *
    (VOLUME_VARIANCE_PERCENT /
      100)
  );
}

function withinTolerance(
  value: number,
  target: number,
): boolean {
  return (
    Math.abs(value - target) <=
    targetTolerance(target)
  );
}

function emptyMeasurement(): ControlledDecrescendoMeasurement {
  const expectedWindowCount =
    Math.round(
      (DURATION_SECONDS * 1000) /
        WINDOW_MS,
    ) * REPETITIONS;

  return {
    dbValues: [],
    repSmoothness: [0, 0],
    smoothness: 0,
    startDb: 0,
    endDb: 0,
    minDb: 0,
    maxDb: 0,
    targetStartReached: false,
    targetEndReached: false,
    targetReached: false,
    directionCorrect: false,
    validWindowCount: 0,
    expectedWindowCount,
    measurementQuality: 0,
  };
}

export function measureControlledDecrescendo(
  samples: Float32Array,
  sampleRate = 44100,
): ControlledDecrescendoMeasurement {
  if (
    samples.length === 0 ||
    sampleRate <= 0
  ) {
    return emptyMeasurement();
  }

  /*
   * PCM
   * ↓
   * 50 ms RMS windows
   * ↓
   * dB
   */
  const rmsValues =
    calcRMSWindows(
      samples,
      WINDOW_MS,
      sampleRate,
    );

  /*
   * The existing Volume implementation
   * represents the dBFS magnitude as
   * a positive dB value.
   */
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

  const repSmoothness =
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

        return calculateDecrescendoSmoothness(
          repValues,
        );
      },
    );

  const smoothness =
    average(repSmoothness);

  const startDb =
    effectiveValues[0] ?? 0;

  const endDb =
    effectiveValues[
      effectiveValues.length - 1
    ] ?? 0;

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

  const targetStartReached =
    withinTolerance(
      startDb,
      START_VOLUME,
    );

  const targetEndReached =
    withinTolerance(
      endDb,
      END_VOLUME,
    );

  const targetReached =
    targetStartReached &&
    targetEndReached;

  const directionCorrect =
    effectiveValues.length >= 2 &&
    endDb < startDb;

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
    dbValues: effectiveValues,
    repSmoothness,
    smoothness,
    startDb,
    endDb,
    minDb,
    maxDb,
    targetStartReached,
    targetEndReached,
    targetReached,
    directionCorrect,
    validWindowCount:
      effectiveValues.length,
    expectedWindowCount,
    measurementQuality,
  };
}