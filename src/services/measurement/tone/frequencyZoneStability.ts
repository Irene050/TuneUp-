import {
  calcFrequencyZoneStability,
  classifyFrequencyZone,
  type FrequencyZone,
} from '@/utils/dsp/spectral';

export interface FrequencyZoneStabilityMeasurement {
  zoneSequence: FrequencyZone[];
  stabilityPct: number;
  pitchStabilityPct: number;
  zoneStabilityPct: number;
  detectionCoveragePct: number;
  validPitchCount: number;
  durationSec: number;
}

const EXPECTED_FRAME_INTERVAL_SEC = 0.12;

export function measureFrequencyZoneStability(
  pitches: ArrayLike<number>,
  durationSec: number,
): FrequencyZoneStabilityMeasurement {
  const validPitches: number[] = [];

  for (let i = 0; i < pitches.length; i++) {
    const pitch = pitches[i];

    if (
      typeof pitch === 'number' &&
      Number.isFinite(pitch) &&
      pitch >= 60 &&
      pitch <= 1500
    ) {
      validPitches.push(pitch);
    }
  }

  const zoneSequence = validPitches.map(
    classifyFrequencyZone,
  );

  const zoneStabilityPct =
    calcFrequencyZoneStability(zoneSequence);

  let pitchStabilityPct = 0;

  if (validPitches.length >= 2) {
    const mean =
      validPitches.reduce(
        (sum, pitch) => sum + pitch,
        0,
      ) / validPitches.length;

    const meanAbsoluteDeviation =
      validPitches.reduce(
        (sum, pitch) =>
          sum + Math.abs(pitch - mean),
        0,
      ) / validPitches.length;

    const relativeDeviation =
      mean > 0
        ? meanAbsoluteDeviation / mean
        : 1;

    pitchStabilityPct = Math.max(
      0,
      Math.min(
        100,
        100 - relativeDeviation * 500,
      ),
    );
  }

  const safeDuration = Math.max(
    0,
    Number.isFinite(durationSec)
      ? durationSec
      : 0,
  );

  const expectedFrames =
    safeDuration / EXPECTED_FRAME_INTERVAL_SEC;

  const detectionCoveragePct =
    expectedFrames > 0
      ? Math.min(
          100,
          (validPitches.length / expectedFrames) *
            100,
        )
      : 0;

  const stabilityPct =
    pitchStabilityPct * 0.7 +
    zoneStabilityPct * 0.3;

  return {
    zoneSequence,
    stabilityPct,
    pitchStabilityPct,
    zoneStabilityPct,
    detectionCoveragePct,
    validPitchCount: validPitches.length,
    durationSec: safeDuration,
  };
}