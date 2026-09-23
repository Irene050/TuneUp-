import { calcIntervalAccuracy, calcPulseConsistency, detectPulses, Peak } from '@/utils/dsp/pulses';
import { calcRMS } from '@/utils/dsp/rms';

export interface ControlledBreathReleaseMeasurement {
  peaks: Peak[];
  pulseConsistencyPct: number;
  intervalAccuracyPct: number;
}

export function measureControlledBreathRelease(
  samples: Float32Array,
  targetIntervalSec: number,
  sampleRate: number
): ControlledBreathReleaseMeasurement {
  const meanAmp = calcRMS(samples);
  const peaks = detectPulses(samples, meanAmp, sampleRate);

  return {
    peaks,
    pulseConsistencyPct: calcPulseConsistency(peaks),
    intervalAccuracyPct: calcIntervalAccuracy(peaks, targetIntervalSec),
  };
}