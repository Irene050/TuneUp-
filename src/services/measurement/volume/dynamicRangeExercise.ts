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

export interface RepetitionInterval {
  startSeconds: number;
  endSeconds: number;
}

interface MeasureOptions {
  windowMs?: number;
  targetRange?: [number, number];
  expectedDurationSeconds?: number;
  repetitionDurationSeconds?: number;
  repetitionIntervals?: RepetitionInterval[];
}

const ACTIVE_VOICE_FLOOR_DBFS = -45;
const PHASES_PER_REPETITION = 3;

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
    !Number.isFinite(sampleRate) ||
    sampleRate <= 0 ||
    !Number.isFinite(windowMs) ||
    windowMs <= 0 ||
    !Number.isFinite(expectedDurationSeconds) ||
    expectedDurationSeconds <= 0 ||
    !Number.isFinite(repetitionDurationSeconds) ||
    repetitionDurationSeconds <= 0 ||
    !Number.isFinite(targetRange[0]) ||
    !Number.isFinite(targetRange[1]) ||
    targetRange[0] < 0 ||
    targetRange[1] <= targetRange[0]
  ) {
    return createEmptyMeasurement();
  }

  const rmsValues = calcRMSWindows(
    samples,
    windowMs,
    sampleRate,
  );

  const allDbValues = toDbArray(rmsValues).map(value =>
    Number.isFinite(value) ? value : -100,
  );

  if (allDbValues.length < PHASES_PER_REPETITION) {
    return createEmptyMeasurement();
  }

  const actualRecordingDurationSeconds =
    samples.length / sampleRate;

  // Prefer actual repetition boundaries. When they aren't supplied,
  // fall back to contiguous repetitions for backward compatibility.
  const repetitionIntervals =
    options.repetitionIntervals?.length
      ? options.repetitionIntervals
      : createContiguousIntervals(
          expectedDurationSeconds,
          repetitionDurationSeconds,
        );

  const firstValues: number[] = [];
  const middleValues: number[] = [];
  const finalValues: number[] = [];

  const risingConsistencies: number[] = [];
  const fallingConsistencies: number[] = [];
  const risingSlopes: number[] = [];
  const fallingSlopes: number[] = [];
  const peakAccuracies: number[] = [];

  const analyzedDbValues: number[] = [];

  let requestedRepetitions = 0;
  let incompleteRepetitionCount = 0;

  for (const interval of repetitionIntervals) {
    if (
      !Number.isFinite(interval.startSeconds) ||
      !Number.isFinite(interval.endSeconds) ||
      interval.startSeconds < 0 ||
      interval.endSeconds <= interval.startSeconds
    ) {
      incompleteRepetitionCount++;
      continue;
    }

    requestedRepetitions++;

    const startIndex = Math.max(
      0,
      Math.floor(
        (interval.startSeconds * 1000) / windowMs,
      ),
    );

    const endIndex = Math.min(
      allDbValues.length,
      Math.ceil(
        (interval.endSeconds * 1000) / windowMs,
      ),
    );

    const repetition = allDbValues.slice(
      startIndex,
      endIndex,
    );

    if (repetition.length < PHASES_PER_REPETITION) {
      incompleteRepetitionCount++;
      continue;
    }

    // Split the available windows proportionally into three phases.
    const firstEnd = Math.ceil(
      repetition.length / PHASES_PER_REPETITION,
    );

    const middleEnd = Math.ceil(
      (repetition.length * 2) / PHASES_PER_REPETITION,
    );

    const first = repetition.slice(0, firstEnd);
    const middle = repetition.slice(firstEnd, middleEnd);
    const final = repetition.slice(middleEnd);

    if (!first.length || !middle.length || !final.length) {
      incompleteRepetitionCount++;
      continue;
    }

    const firstAverage = average(first);
    const middleAverage = average(middle);
    const finalAverage = average(final);

    firstValues.push(firstAverage);
    middleValues.push(middleAverage);
    finalValues.push(finalAverage);

    analyzedDbValues.push(...repetition);

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
        firstAverage,
        middleAverage,
        finalAverage,
      ),
    );
  }

  if (firstValues.length === 0) {
    console.warn(
      '[DynamicRange] No complete repetitions were available for analysis.',
      {
        actualRecordingDurationSeconds,
        availableWindowCount: allDbValues.length,
        requestedRepetitions,
        incompleteRepetitionCount,
      },
    );

    return createEmptyMeasurement();
  }

  const firstPhaseAverage = average(firstValues);
  const middlePhaseAverage = average(middleValues);
  const finalPhaseAverage = average(finalValues);

  const [targetMin, targetMax] = targetRange;

  const repetitionScores = firstValues.map((first, index) => {
    const middle = middleValues[index];
    const final = finalValues[index];

    const contrast = middle - (first + final) / 2;

    if (middle <= first || middle <= final || contrast <= 0) {
      return 0;
    }

    if (contrast < targetMin) {
      return (contrast / targetMin) * 100;
    }

    if (contrast <= targetMax) {
      return 100;
    }

    return clamp(
      (targetMax / contrast) * 100,
      0,
      100,
    );
  });

  const rangeAccuracy = average(repetitionScores);

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

  const expectedWindowCount = Math.max(
    1,
    Math.floor(
      (expectedDurationSeconds * 1000) / windowMs,
    ),
  );

  const windowCoverage = clamp(
    (analyzedDbValues.length / expectedWindowCount) * 100,
    0,
    100,
  );

  const repetitionCoverage = clamp(
    (firstValues.length /
      Math.max(1, requestedRepetitions)) *
      100,
    0,
    100,
  );

  const overallMeasurementQuality = Math.min(
    windowCoverage,
    repetitionCoverage,
  );

  const activeDbValues = analyzedDbValues.filter(
    value => value > ACTIVE_VOICE_FLOOR_DBFS,
  );

  console.log(
    '[DynamicRange] Measurement summary',
    {
      actualRecordingDurationSeconds,
      expectedDurationSeconds,
      repetitionDurationSeconds,
      availableWindowCount: allDbValues.length,
      analyzedWindowCount: analyzedDbValues.length,
      requestedRepetitions,
      completedRepetitions: firstValues.length,
      incompleteRepetitionCount,
      firstPhaseAverage,
      middlePhaseAverage,
      finalPhaseAverage,
      rangeAccuracy,
      rampConsistency,
      overallMeasurementQuality,
    },
  );

  return {
    dbValues: analyzedDbValues,
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

function createContiguousIntervals(
  expectedDurationSeconds: number,
  repetitionDurationSeconds: number,
): RepetitionInterval[] {
  const count = Math.max(
    1,
    Math.ceil(
      expectedDurationSeconds / repetitionDurationSeconds,
    ),
  );

  return Array.from({ length: count }, (_, index) => ({
    startSeconds: index * repetitionDurationSeconds,
    endSeconds: Math.min(
      expectedDurationSeconds,
      (index + 1) * repetitionDurationSeconds,
    ),
  }));
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

  const denominator = n * sumXX - sumX * sumX;

  if (denominator === 0) {
    return 0;
  }

  return (
    (n * sumXY - sumX * sumY) /
    denominator
  );
}

function calculateDirectionalConsistency(
  values: number[],
  direction: 'increasing' | 'decreasing',
): number {
  if (values.length < 2) {
    return 0;
  }

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

  if (totalChange === 0) {
    return 0;
  }

  return clamp(
    (desiredChange / totalChange) * 100,
    0,
    100,
  );
}

function calculatePeakAccuracy(
  first: number,
  middle: number,
  final: number,
): number {
  const middleRise = middle - first;
  const middleFall = middle - final;

  const riseScore = clamp(
    (middleRise / 10) * 100,
    0,
    100,
  );

  const fallScore = clamp(
    (middleFall / 10) * 100,
    0,
    100,
  );

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