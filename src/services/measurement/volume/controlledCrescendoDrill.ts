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
}

const DEFAULT_WINDOW_MS = 50;
const DEFAULT_TARGET_RANGE: [number, number] = [40, 50];
const DEFAULT_DURATION_SECONDS = 4;
const DEFAULT_REPETITIONS = 2;

export function measureControlledCrescendo(
  samples: Float32Array,
  sampleRate = 44100,
  options: MeasureOptions = {},
): ControlledCrescendoMeasurement {
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const targetRange = options.targetRange ?? DEFAULT_TARGET_RANGE;
  const expectedDurationSeconds =
    options.expectedDurationSeconds ?? DEFAULT_DURATION_SECONDS;
  const repetitions =
    options.repetitions ?? DEFAULT_REPETITIONS;

  if (
    samples.length === 0 ||
    sampleRate <= 0 ||
    windowMs <= 0 ||
    repetitions <= 0
  ) {
    return createEmptyMeasurement(targetRange);
  }

  const rmsValues = calcRMSWindows(
    samples,
    windowMs,
    sampleRate,
  );

  if (rmsValues.length === 0) {
    return createEmptyMeasurement(targetRange);
  }

  const dbValues = toDbArray(rmsValues)
    .filter(Number.isFinite)
    .map((db) => Math.abs(db));

  if (dbValues.length === 0) {
    return createEmptyMeasurement(targetRange);
  }

  const expectedWindowCount = Math.max(
    1,
    Math.floor(
      (expectedDurationSeconds *
        repetitions *
        1000) /
        windowMs,
    ),
  );

  const effectiveValues = dbValues.slice(
    0,
    expectedWindowCount,
  );

  const derivativeValues = calculateDerivatives(
    effectiveValues,
  );

  const meanDerivative = average(
    derivativeValues,
  );

  const derivativeVariance = variance(
    derivativeValues,
  );

  const smoothness = calculateSmoothness(
    derivativeValues,
  );

  const repetitionWindowCount = Math.max(
    1,
    Math.floor(
      effectiveValues.length / repetitions,
    ),
  );

  const repetitionValues = Array.from(
    { length: repetitions },
    (_, index) => {
      const start = index * repetitionWindowCount;
      const end =
        index === repetitions - 1
          ? effectiveValues.length
          : Math.min(
              start + repetitionWindowCount,
              effectiveValues.length,
            );

      return effectiveValues.slice(start, end);
    },
  ).filter((values) => values.length > 0);

  const repetitionSmoothness = repetitionValues.map(
    (values) =>
      calculateSmoothness(
        calculateDerivatives(values),
      ),
  );

  const minDb = Math.min(...effectiveValues);
  const maxDb = Math.max(...effectiveValues);
  const startDb = effectiveValues[0] ?? 0;
  const endDb =
    effectiveValues[effectiveValues.length - 1] ??
    0;

  const averageDb = average(effectiveValues);

  const targetReached =
    maxDb >= targetRange[0] &&
    minDb <= targetRange[1] &&
    endDb > startDb;

  const actualDurationSeconds =
    (effectiveValues.length * windowMs) / 1000;

  const overallMeasurementQuality = clamp(
    (effectiveValues.length /
      expectedWindowCount) *
      100,
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

  for (let index = 1; index < values.length; index += 1) {
    derivatives.push(
      values[index] - values[index - 1],
    );
  }

  return derivatives.filter(Number.isFinite);
}

function calculateSmoothness(
  derivatives: number[],
): number {
  if (derivatives.length === 0) {
    return 0;
  }

  const meanDerivative = average(derivatives);
  const derivativeVariance = variance(derivatives);

  if (meanDerivative <= 0) {
    return 0;
  }

  return clamp(
    100 -
      (derivativeVariance / meanDerivative) *
        100,
    0,
    100,
  );
}

function average(values: number[]): number {
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

function variance(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const mean = average(values);

  return average(
    values.map(
      (value) => (value - mean) ** 2,
    ),
  );
}

function clamp(
  value: number,
  min: number,
  max: number,
): number {
  return Math.max(min, Math.min(max, value));
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
