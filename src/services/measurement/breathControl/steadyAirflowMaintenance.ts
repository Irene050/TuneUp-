import { calcAirflowStability } from '@/utils/dsp/airflow';
import { detectOnsetOffset } from '@/utils/dsp/onsetOffset';

export interface SteadyAirflowMeasurement {
  stabilityPct: number;
  durationSec: number;
  detected: boolean;
}

export function measureSteadyAirflow(
  samples: Float32Array,
  threshold: number,
  sampleRate: number
): SteadyAirflowMeasurement {
  const { onsetIndex, offsetIndex, durationSeconds } = detectOnsetOffset(samples, threshold, sampleRate);

  if (durationSeconds === 0) {
    return { stabilityPct: 0, durationSec: 0, detected: false };
  }

  const segment = samples.subarray(onsetIndex, offsetIndex);

  return {
    stabilityPct: calcAirflowStability(segment, 50, sampleRate),
    durationSec: durationSeconds,
    detected: true,
  };
}