import {
    calcRMSWindows,
    toDbArray,
} from '@/utils/dsp/volumeAnalysis';

export interface DynamicRangeMeasurement {
  dbValues: number[];
  rangeMin: number;
  rangeMax: number;
  validWindowCount: number;
  inTargetWindowCount: number;
  rangeAccuracy: number;
  firstPhaseAverage: number;
  middlePhaseAverage: number;
  finalPhaseAverage: number;
  risingSlope: number;
  fallingSlope: number;
  rampConsistency: number;
  overallMeasurementQuality: number;
}

interface MeasureOptions {
  windowMs?: number;
  targetRange?: [number, number];
  expectedDurationSeconds?: number;
}

export function measureDynamicRange(
  samples: Float32Array,
  sampleRate = 44100,
  options: MeasureOptions = {}
): DynamicRangeMeasurement {
  const windowMs = options.windowMs ?? 50;
  const targetRange = options.targetRange ?? [40, 55];
  const expectedDurationSeconds =
    options.expectedDurationSeconds ?? 9;

  if (samples.length === 0 || sampleRate <= 0) {
    return createEmptyMeasurement();
  }

  const rmsValues = calcRMSWindows(
    samples,
    windowMs,
    sampleRate
  );

  if (rmsValues.length === 0) {
    return createEmptyMeasurement();
  }

  const rawDbValues = toDbArray(rmsValues);

  const dbValues = rawDbValues
    .filter(Number.isFinite)
    .map((db) => Math.abs(db));

  if (dbValues.length === 0) {
    return createEmptyMeasurement();
  }

  const validWindowCount = dbValues.length;

  const inTargetWindowCount = dbValues.filter(
    (value) =>
      value >= targetRange[0] &&
      value <= targetRange[1]
  ).length;

  const rangeAccuracy =
    (inTargetWindowCount / validWindowCount) * 100;

  const expectedWindowCount = Math.max(
    1,
    Math.floor(
      (expectedDurationSeconds * 1000) / windowMs
    )
  );

  const effectiveWindowCount = Math.min(
    dbValues.length,
    expectedWindowCount
  );

  const phaseWindowCount = Math.max(
    1,
    Math.floor(effectiveWindowCount / 3)
  );

  const firstPhase = dbValues.slice(
    0,
    phaseWindowCount
  );

  const middlePhase = dbValues.slice(
    phaseWindowCount,
    phaseWindowCount * 2
  );

  const finalPhase = dbValues.slice(
    phaseWindowCount * 2,
    effectiveWindowCount
  );

  const firstPhaseAverage = average(firstPhase);
  const middlePhaseAverage = average(middlePhase);
  const finalPhaseAverage = average(finalPhase);

  const risingSlope = calculateSlope(firstPhase);
  const fallingSlope = calculateSlope(finalPhase);

  const risingConsistency =
    calculateIncreasingConsistency(firstPhase);

  const fallingConsistency =
    calculateDecreasingConsistency(finalPhase);

  const peakAccuracy = calculatePeakAccuracy(
    firstPhaseAverage,
    middlePhaseAverage,
    finalPhaseAverage
  );

  const rampConsistency = clamp(
    risingConsistency * 0.4 +
      fallingConsistency * 0.4 +
      peakAccuracy * 0.2,
    0,
    100
  );

  const overallMeasurementQuality = clamp(
    (validWindowCount / expectedWindowCount) * 100,
    0,
    100
  );

  return {
    dbValues,
    rangeMin: Math.min(...dbValues),
    rangeMax: Math.max(...dbValues),
    validWindowCount,
    inTargetWindowCount,
    rangeAccuracy,
    firstPhaseAverage,
    middlePhaseAverage,
    finalPhaseAverage,
    risingSlope,
    fallingSlope,
    rampConsistency,
    overallMeasurementQuality,
  };
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

function calculateSlope(values: number[]): number {
  if (values.length < 2) {
    return 0;
  }

  const n = values.length;

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;

  for (let i = 0; i < n; i++) {
    const x = i;
    const y = values[i];

    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }

  const denominator =
    n * sumXX - sumX * sumX;

  if (denominator === 0) {
    return 0;
  }

  return (
    (n * sumXY - sumX * sumY) /
    denominator
  );
}

function calculateIncreasingConsistency(
  values: number[]
): number {
  if (values.length < 2) {
    return 0;
  }

  let totalChange = 0;
  let positiveChange = 0;

  for (let i = 1; i < values.length; i++) {
    const difference =
      values[i] - values[i - 1];

    totalChange += Math.abs(difference);

    if (difference > 0) {
      positiveChange += difference;
    }
  }

  if (totalChange === 0) {
    return 0;
  }

  return clamp(
    (positiveChange / totalChange) * 100,
    0,
    100
  );
}

function calculateDecreasingConsistency(
  values: number[]
): number {
  if (values.length < 2) {
    return 0;
  }

  let totalChange = 0;
  let negativeChange = 0;

  for (let i = 1; i < values.length; i++) {
    const difference =
      values[i] - values[i - 1];

    totalChange += Math.abs(difference);

    if (difference < 0) {
      negativeChange += Math.abs(difference);
    }
  }

  if (totalChange === 0) {
    return 0;
  }

  return clamp(
    (negativeChange / totalChange) * 100,
    0,
    100
  );
}

function calculatePeakAccuracy(
  first: number,
  middle: number,
  final: number
): number {
  const firstToMiddle = first - middle;
  const finalToMiddle = final - middle;

  const positiveDifferences = [
    firstToMiddle,
    finalToMiddle,
  ].filter((value) => value > 0);

  if (positiveDifferences.length === 0) {
    return 0;
  }

  const averageDifference = average(
    positiveDifferences
  );

  return clamp(
    (averageDifference / 10) * 100,
    0,
    100
  );
}

function clamp(
  value: number,
  min: number,
  max: number
): number {
  return Math.max(
    min,
    Math.min(max, value)
  );
}

function createEmptyMeasurement(): DynamicRangeMeasurement {
  return {
    dbValues: [],
    rangeMin: 0,
    rangeMax: 0,
    validWindowCount: 0,
    inTargetWindowCount: 0,
    rangeAccuracy: 0,
    firstPhaseAverage: 0,
    middlePhaseAverage: 0,
    finalPhaseAverage: 0,
    risingSlope: 0,
    fallingSlope: 0,
    rampConsistency: 0,
    overallMeasurementQuality: 0,
  };
}