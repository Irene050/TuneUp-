import {
  calcRMSWindows,
  toDbArray,
} from '@/utils/dsp/volumeAnalysis';

const WINDOW_MS = 50;
const DEFAULT_TARGET_RANGE: [number, number] = [35, 45];
const DEFAULT_DURATION_SECONDS = 4;
const DEFAULT_REPETITIONS = 2;
const DEFAULT_VOLUME_DECREASE_THRESHOLD = 10;
const TARGET_TOLERANCE_PERCENT = 15;

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

  achievedVolumeDecrease: number;

  validWindowCount: number;
  expectedWindowCount: number;

  measurementQuality: number;
}

interface MeasureOptions {
  windowMs?: number;
  targetRange?: [number, number];
  expectedDurationSeconds?: number;
  repetitions?: number;
  volumeDecreaseThreshold?: number;
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
 * Calculates decrescendo smoothness.
 *
 * Formula:
 * 100 - (derivative variance /
 *        absolute mean derivative) * 100
 *
 * A smooth decrescendo should have:
 * - a negative mean derivative
 * - relatively low derivative variance
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
    (
      TARGET_TOLERANCE_PERCENT /
      100
    )
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

function emptyMeasurement(
  windowMs: number,
  expectedDurationSeconds: number,
  repetitions: number,
): ControlledDecrescendoMeasurement {
  const expectedWindowCount =
    Math.max(
      1,
      Math.round(
        (
          expectedDurationSeconds *
          1000
        ) /
        windowMs,
      ),
    ) *
    repetitions;

  return {
    dbValues: [],

    repSmoothness:
      Array.from(
        {
          length:
            repetitions,
        },
        () => 0,
      ),

    smoothness: 0,

    startDb: 0,
    endDb: 0,

    minDb: 0,
    maxDb: 0,

    targetStartReached:
      false,

    targetEndReached:
      false,

    targetReached:
      false,

    directionCorrect:
      false,

    achievedVolumeDecrease:
      0,

    validWindowCount:
      0,

    expectedWindowCount,

    measurementQuality:
      0,
  };
}

export function measureControlledDecrescendo(
  samples: Float32Array,
  sampleRate = 44100,
  options: MeasureOptions = {},
): ControlledDecrescendoMeasurement {
  const windowMs =
    options.windowMs ??
    WINDOW_MS;

  const targetRange =
    options.targetRange ??
    DEFAULT_TARGET_RANGE;

  const expectedDurationSeconds =
    options.expectedDurationSeconds ??
    DEFAULT_DURATION_SECONDS;

  const repetitions =
    Math.max(
      1,
      Math.round(
        options.repetitions ??
        DEFAULT_REPETITIONS,
      ),
    );

  const volumeDecreaseThreshold =
    options.volumeDecreaseThreshold ??
    DEFAULT_VOLUME_DECREASE_THRESHOLD;

  if (
    samples.length === 0 ||
    sampleRate <= 0
  ) {
    return emptyMeasurement(
      windowMs,
      expectedDurationSeconds,
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
    return emptyMeasurement(
      windowMs,
      expectedDurationSeconds,
      repetitions,
    );
  }

  /*
   * Determine how many analysis windows
   * belong to each repetition.
   */
  const windowsPerRep =
    Math.max(
      1,
      Math.round(
        (
          expectedDurationSeconds *
          1000
        ) /
        windowMs,
      ),
    );

  const expectedWindowCount =
    windowsPerRep *
    repetitions;

  /*
   * Ignore analysis data beyond the
   * expected exercise duration.
   */
  const effectiveValues =
    dbValues.slice(
      0,
      Math.min(
        dbValues.length,
        expectedWindowCount,
      ),
    );

  /*
   * Calculate smoothness separately
   * for each repetition.
   */
  const repSmoothness =
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

        return calculateDecrescendoSmoothness(
          repValues,
        );
      },
    );

  const validRepSmoothness =
    repSmoothness.filter(
      Number.isFinite,
    );

  const smoothness =
    average(
      validRepSmoothness,
    );

  const startDb =
    effectiveValues[0] ??
    0;

  const endDb =
    effectiveValues[
      effectiveValues.length - 1
    ] ??
    0;

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

  /*
   * For a decrescendo:
   *
   * targetRange = [minimum, maximum]
   *
   * Start should be near the upper
   * end of the target range.
   */
  const targetStart =
    targetRange[1];

  /*
   * End should be near the lower
   * end of the target range.
   */
  const targetEnd =
    targetRange[0];

  const targetStartReached =
    withinTolerance(
      startDb,
      targetStart,
    );

  const targetEndReached =
    withinTolerance(
      endDb,
      targetEnd,
    );

  /*
   * Positive value means the singer
   * actually decreased volume.
   */
  const achievedVolumeDecrease =
    startDb - endDb;

  const targetReached =
    targetStartReached &&
    targetEndReached &&
    achievedVolumeDecrease >=
      volumeDecreaseThreshold;

  const directionCorrect =
    effectiveValues.length >= 2 &&
    endDb < startDb;

  const measurementQuality =
    clamp(
      (
        effectiveValues.length /
        expectedWindowCount
      ) *
        100,
      0,
      100,
    );

  return {
    dbValues:
      effectiveValues,

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

    achievedVolumeDecrease,

    validWindowCount:
      effectiveValues.length,

    expectedWindowCount,

    measurementQuality,
  };
}