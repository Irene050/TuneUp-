import { detectOnsetOffset } from '@/utils/dsp/onsetOffset';
import { calcRMSConsistency } from '@/utils/dsp/rms';

export interface SustainedBreathMeasurement {
  actualDurationSec: number;
  consistencyPct: number;
  detected: boolean;
}

export function measureSustainedBreath(
  samples: Float32Array,
  threshold: number,
  sampleRate: number,
): SustainedBreathMeasurement {
  const { onsetIndex, offsetIndex, durationSeconds } =
    detectOnsetOffset(samples, threshold, sampleRate);

  if (durationSeconds === 0) {
    return {
      actualDurationSec: 0,
      consistencyPct: 0,
      detected: false,
    };
  }

  const sustainedSegment = samples.subarray(onsetIndex, offsetIndex);

  return {
    actualDurationSec: durationSeconds,
    consistencyPct: calcRMSConsistency(
      sustainedSegment,
      50,
      sampleRate,
    ),
    detected: true,
  };
}
