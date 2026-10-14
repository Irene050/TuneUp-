import {
  calcRMSWindows,
  toDbArray,
} from '@/utils/dsp/volumeAnalysis';

export interface DynamicRangeMeasurement {
  dbValues: number[];
  rangeMin: number;
  rangeMax: number;
  validWindowCount: number;
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
  repetitionDurationSeconds?: number;
}

export function measureDynamicRange(
  samples: Float32Array,
  sampleRate = 44100,
  options: MeasureOptions = {},
): DynamicRangeMeasurement {
  const windowMs = options.windowMs ?? 50;
  const targetRange = options.targetRange ?? [40, 55];
  const expectedDurationSeconds =
    options.expectedDurationSeconds ?? 9;
  const repetitionDurationSeconds =
    options.repetitionDurationSeconds ??
    expectedDurationSeconds;

  if (
    samples.length === 0 ||
    sampleRate <= 0 ||
    windowMs <= 0 ||
    expectedDurationSeconds <= 0 ||
    repetitionDurationSeconds <= 0
  ) {
    return createEmptyMeasurement();
  }

  const rmsValues = calcRMSWindows(samples, windowMs, sampleRate);
  const allDbValues = toDbArray(rmsValues);

  if (allDbValues.length < 3) {
    return createEmptyMeasurement();
  }

  // Preserve the original time positions, including quiet windows.
  const expectedWindowCount = Math.floor(
    (expectedDurationSeconds * 1000) / windowMs,
  );

  const dbValues = allDbValues
    .slice(0, expectedWindowCount)
    .map((value) =>
      Number.isFinite(value) ? value : -100,
    );

  if (dbValues.length < 3) {
    return createEmptyMeasurement();
  }

  // Ignore silence and near-silence when evaluating the user's
// vocal volume. Keep all windows for phase timing and analysis.
  const ACTIVE_VOICE_FLOOR_DBFS = -45;

  const activeDbValues = dbValues.filter(
    (value) => value > ACTIVE_VOICE_FLOOR_DBFS,
  );

  const windowsPerPhase = Math.max(
    1,
    Math.floor(
      (repetitionDurationSeconds * 1000) / (3 * windowMs),
    ),
  );

  const repetitionCount = Math.max(
    1,
    Math.ceil(expectedDurationSeconds / repetitionDurationSeconds),
  );

  const firstValues: number[] = [];
  const middleValues: number[] = [];
  const finalValues: number[] = [];

  const risingConsistencies: number[] = [];
  const fallingConsistencies: number[] = [];
  const risingSlopes: number[] = [];
  const fallingSlopes: number[] = [];
  const peakAccuracies: number[] = [];

  for (let repetition = 0; repetition < repetitionCount; repetition++) {
    const repetitionStart = Math.round(
      (repetition * repetitionDurationSeconds * 1000) / windowMs,
    );

    const firstStart = repetitionStart;
    const middleStart = firstStart + windowsPerPhase;
    const finalStart = middleStart + windowsPerPhase;
    const repetitionEnd = Math.min(
      dbValues.length,
      Math.round(
        ((repetition + 1) * repetitionDurationSeconds * 1000) /
          windowMs,
      ),
    );

    const first = dbValues.slice(
      firstStart,
      Math.min(middleStart, repetitionEnd),
    );

    const middle = dbValues.slice(
      middleStart,
      Math.min(finalStart, repetitionEnd),
    );

    const final = dbValues.slice(finalStart, repetitionEnd);

    if (!first.length || !middle.length || !final.length) {
      continue;
    }

    firstValues.push(average(first));
    middleValues.push(average(middle));
    finalValues.push(average(final));

    risingConsistencies.push(
      calculateDirectionalConsistency(first, 'increasing'),
    );

    fallingConsistencies.push(
      calculateDirectionalConsistency(final, 'decreasing'),
    );

    risingSlopes.push(calculateSlope(first));
    fallingSlopes.push(calculateSlope(final));

    peakAccuracies.push(
      calculatePeakAccuracy(
        average(first),
        average(middle),
        average(final),
      ),
    );
  }

  if (!firstValues.length) {
    return createEmptyMeasurement();
  }

  
const firstPhaseAverage = average(firstValues);
const middlePhaseAverage = average(middleValues);
const finalPhaseAverage = average(finalValues);

// Dynamic Range should become louder in the middle
// and quieter again in the final phase.
const repetitionContrasts = firstValues.map(
  (first, index) => {
    const middle = middleValues[index];
    const final = finalValues[index];

    // A positive contrast means the middle phase is
    // louder than the average of the two soft phases.
    const contrast =
      middle - (first + final) / 2;

    // Do not award range accuracy if either soft phase
    // is as loud as, or louder than, the middle phase.
    if (middle <= first || middle <= final) {
      return 0;
    }

    return contrast;
  },
);

const targetMin = targetRange[0];
const targetMax = targetRange[1];

const repetitionScores = repetitionContrasts.map(
  (contrast) => {
    if (contrast <= 0) return 0;

    if (contrast < targetMin) {
      return (contrast / targetMin) * 100;
    }

    if (contrast <= targetMax) {
      return 100;
    }

    // Give a reduced score for contrast beyond the
    // intended target rather than rewarding it endlessly.
    return clamp(
      (targetMax / contrast) * 100,
      0,
      100,
    );
  },
);

const rangeAccuracy =
  repetitionScores.length > 0
    ? average(repetitionScores)
    : 0;

const inTargetWindowCount =
  repetitionContrasts.filter(
    (contrast) =>
      contrast >= targetMin &&
      contrast <= targetMax,
  ).length;

const risingSlope = average(risingSlopes);
const fallingSlope = average(fallingSlopes);

const risingConsistency = average(risingConsistencies);
const fallingConsistency = average(fallingConsistencies);
const peakAccuracy = average(peakAccuracies);


  const rampConsistency = clamp(
    risingConsistency * 0.4 +
      fallingConsistency * 0.4 +
      peakAccuracy * 0.2,
    0,
    100,
  );

  const overallMeasurementQuality = clamp(
    (dbValues.length / expectedWindowCount) * 100,
    0,
    100,
  );

  return {
    dbValues,
    rangeMin: activeDbValues.length
      ? Math.min(...activeDbValues)
      : 0,
    rangeMax: activeDbValues.length
      ? Math.max(...activeDbValues)
      : 0,
    validWindowCount: activeDbValues.length,
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
  if (!values.length) return 0;

  return values.reduce((sum, value) => sum + value, 0) /
    values.length;
}

function calculateSlope(values: number[]): number {
  if (values.length < 2) return 0;

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

  const denominator = n * sumXX - sumX * sumX;

  if (denominator === 0) return 0;

  return (n * sumXY - sumX * sumY) / denominator;
}

function calculateDirectionalConsistency(
  values: number[],
  direction: 'increasing' | 'decreasing',
): number {
  if (values.length < 2) return 0;

  let totalChange = 0;
  let desiredChange = 0;

  for (let i = 1; i < values.length; i++) {
    const difference = values[i] - values[i - 1];

    totalChange += Math.abs(difference);

    if (
      (direction === 'increasing' && difference > 0) ||
      (direction === 'decreasing' && difference < 0)
    ) {
      desiredChange += Math.abs(difference);
    }
  }

  if (totalChange === 0) return 0;

  return clamp((desiredChange / totalChange) * 100, 0, 100);
}

function calculatePeakAccuracy(
  first: number,
  middle: number,
  final: number,
): number {
  // dBFS values closer to zero represent louder sound.
  const middleRise = middle - first;
  const middleFall = middle - final;

  // Both transitions should have a meaningful loudness difference.
  const riseScore = clamp((middleRise / 10) * 100, 0, 100);
  const fallScore = clamp((middleFall / 10) * 100, 0, 100);

  return (riseScore + fallScore) / 2;
}

function clamp(
  value: number,
  min: number,
  max: number,
): number {
  return Math.max(min, Math.min(max, value));
}

function createEmptyMeasurement(): DynamicRangeMeasurement {
  return {
    dbValues: [],
    rangeMin: 0,
    rangeMax: 0,
    validWindowCount: 0,
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