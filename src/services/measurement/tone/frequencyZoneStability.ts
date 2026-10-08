import {
  calcFrequencyZoneStability,
  classifyFrequencyZone,
  type FrequencyZone,
} from '@/utils/dsp/spectral';

export interface FrequencyZoneStabilityMeasurement {
  zoneSequence: FrequencyZone[];
  stabilityPct: number;
  durationSec: number;
}
export function measureFrequencyZoneStability(
  pitches: ArrayLike<number>,
  durationSec: number,
): FrequencyZoneStabilityMeasurement {
  const validPitches: number[] = [];

  for (let i = 0; i < pitches.length; i++) {
    const pitch = pitches[i];

    if (
      Number.isFinite(pitch) &&
      pitch > 0
    ) {
      validPitches.push(pitch);
    }
  }

  const zoneSequence =
    validPitches.map(
      classifyFrequencyZone,
    );

  return {
    zoneSequence,
    stabilityPct:
      calcFrequencyZoneStability(
        zoneSequence,
      ),
    durationSec,
  };
}