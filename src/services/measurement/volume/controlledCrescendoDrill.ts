// src/services/measurement/volume/controlledCrescendoDrill.ts

import {
  calcRMSWindows,
  toDbArray,
} from '@/utils/dsp/volumeAnalysis';

export interface ControlledCrescendoMeasurement {
  dbValues: number[];
  repetitionValues: number[][];
  validWindowCount: number;
  durationSeconds: number;
  minDb: number;
  maxDb: number;
  startDb: number;
  endDb: number;
  averageDb: number;
  derivativeValues: number[];
  meanDerivative: number;
  derivativeVariance: number;
  smoothness: number;
  targetRange: [number, number];
  targetReached: boolean;
  repetitionSmoothness: number[];
  overallMeasurementQuality: number;
}

interface MeasureOptions {
  windowMs?: number;
  targetRange?: [number, number];
  expectedDurationSeconds?: number;
  repetitions?: number;
  volumeIncreaseThreshold?: number;
}

export function measureControlledCrescendo(
  samples: Float32Array,
  sampleRate = 44100,
  options: MeasureOptions = {},
): ControlledCrescendoMeasurement {
  const windowMs = options.windowMs ?? 50;
  const targetRange = options.targetRange ?? [40, 50];
  const expectedDurationSeconds = options.expectedDurationSeconds ?? 4;
  const repetitions = options.repetitions ?? 2;
  const volumeIncreaseThreshold = options.volumeIncreaseThreshold ?? 10;

  if (
    samples.length === 0 ||
    sampleRate <= 0 ||
    windowMs <= 0 ||
    expectedDurationSeconds <= 0 ||
    repetitions <= 0 ||
    volumeIncreaseThreshold < 0
  ) {
    return createEmptyMeasurement(targetRange);
  }

  const rmsValues = calcRMSWindows(samples, windowMs, sampleRate);
  if (rmsValues.length === 0) {
    return createEmptyMeasurement(targetRange);
  }

  // Keep the existing positive dB convention used by the exercise targets.
  // Higher values now correctly represent louder audio.
  const SILENCE_FLOOR_DBFS = -60;

  const dbValues = toDbArray(rmsValues)
    .filter(
      (db) => Number.isFinite(db) && db > SILENCE_FLOOR_DBFS,
    );

  if (dbValues.length < 2) {
    return createEmptyMeasurement(targetRange);
  }

  const expectedWindowCount = Math.max(
    1,
    Math.floor((expectedDurationSeconds * 1000) / windowMs),
  );

  const effectiveValues = dbValues.slice(0, expectedWindowCount);
  if (effectiveValues.length < 2) {
    return createEmptyMeasurement(targetRange);
  }

  const derivativeValues = calculateDerivatives(effectiveValues);
  const meanDerivative = average(derivativeValues);
  const derivativeVariance = variance(derivativeValues);

  // Score how consistently volume rises, not how small the derivative is.
  const positiveChanges = derivativeValues.filter((value) => value > 0);
  const positiveRatio =
    derivativeValues.length > 0
      ? positiveChanges.length / derivativeValues.length
      : 0;

  const meanAbsoluteChange =
    derivativeValues.length > 0
      ? average(derivativeValues.map((value) => Math.abs(value)))
      : 0;

  const smoothness = clamp(
    positiveRatio * 70 +
      (meanAbsoluteChange > 0 ? 30 : 0) -
      Math.min(30, Math.sqrt(Math.max(0, derivativeVariance)) * 3),
    0,
    100,
  );

  const repetitionWindowCount = Math.max(
    1,
    Math.floor(effectiveValues.length / repetitions),
  );

  const repetitionValues = Array.from(
    { length: repetitions },
    (_, index) => {
      const start = index * repetitionWindowCount;
      const end =
        index === repetitions - 1
          ? effectiveValues.length
          : Math.min(start + repetitionWindowCount, effectiveValues.length);

      return effectiveValues.slice(start, end);
    },
  ).filter((values) => values.length > 1);

  const repetitionSmoothness = repetitionValues.map((values) => {
    const changes = calculateDerivatives(values);
    if (changes.length === 0) return 0;

    const risingRatio =
      changes.filter((value) => value > 0).length / changes.length;

    return clamp(risingRatio * 100, 0, 100);
  });

  const minDb = Math.min(...effectiveValues);
  const maxDb = Math.max(...effectiveValues);
  const startDb = effectiveValues[0];
  const endDb = effectiveValues[effectiveValues.length - 1];
  const averageDb = average(effectiveValues);
  const achievedVolumeIncrease = endDb - startDb;

  const targetReached =
    endDb >= targetRange[0] &&
    endDb <= targetRange[1] &&
    achievedVolumeIncrease >= volumeIncreaseThreshold;

  const actualDurationSeconds =
    (effectiveValues.length * windowMs) / 1000;

  const overallMeasurementQuality = clamp(
    (effectiveValues.length / expectedWindowCount) * 100,
    0,
    100,
  );

  return {
    dbValues: effectiveValues,
    repetitionValues,
    validWindowCount: effectiveValues.length,
    durationSeconds: actualDurationSeconds,
    minDb,
    maxDb,
    startDb,
    endDb,
    averageDb,
    derivativeValues,
    meanDerivative,
    derivativeVariance,
    smoothness,
    targetRange,
    targetReached,
    repetitionSmoothness,
    overallMeasurementQuality,
  };
}


function calculateDerivatives(
  values: number[],
): number[] {
  if (values.length < 2) {
    return [];
  }

  const derivatives: number[] = [];

  for (
    let index = 1;
    index < values.length;
    index += 1
  ) {
    derivatives.push(
      values[index] -
        values[index - 1],
    );
  }

  return derivatives.filter(
    Number.isFinite,
  );
}

function calculateSmoothness(
  derivatives: number[],
): number {
  if (derivatives.length === 0) {
    return 0;
  }

  const meanDerivative =
    average(
      derivatives,
    );

  const derivativeVariance =
    variance(
      derivatives,
    );

  /*
   * A crescendo requires an overall positive
   * volume progression.
   */
  if (meanDerivative <= 0) {
    return 0;
  }

  return clamp(
    100 -
      (
        derivativeVariance /
        meanDerivative
      ) *
        100,
    0,
    100,
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
      (
        sum,
        value,
      ) =>
        sum + value,
      0,
    ) /
    values.length
  );
}

function variance(
  values: number[],
): number {
  if (values.length === 0) {
    return 0;
  }

  const mean =
    average(values);

  return average(
    values.map(
      (value) =>
        (
          value - mean
        ) ** 2,
    ),
  );
}

function clamp(
  value: number,
  min: number,
  max: number,
): number {
  return Math.max(
    min,
    Math.min(
      max,
      value,
    ),
  );
}

function createEmptyMeasurement(
  targetRange: [number, number],
): ControlledCrescendoMeasurement {
  return {
    dbValues: [],
    repetitionValues: [],
    validWindowCount: 0,
    durationSeconds: 0,
    minDb: 0,
    maxDb: 0,
    startDb: 0,
    endDb: 0,
    averageDb: 0,
    derivativeValues: [],
    meanDerivative: 0,
    derivativeVariance: 0,
    smoothness: 0,
    targetRange,
    targetReached: false,
    repetitionSmoothness: [],
    overallMeasurementQuality: 0,
  };
}