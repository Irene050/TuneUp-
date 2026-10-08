import {
  calcIntervalAccuracy,
  calcPulseConsistency,
  detectPulses,
  type Peak,
} from '@/utils/dsp/pulses';

import { calcRMS } from '@/utils/dsp/rms';

export interface ControlledBreathReleaseMeasurement {
  peaks: Peak[];
  intervalsSec: number[];
  pulseConsistencyPct: number;
  intervalAccuracyPct: number;
}

export function measureControlledBreathRelease(
  samples: Float32Array,
  targetIntervalSec: number,
  sampleRate: number,
): ControlledBreathReleaseMeasurement {
  const rmsLevel = calcRMS(samples);

  const peaks = detectPulses(
    samples,
    rmsLevel,
    sampleRate,
  );

  const intervalsSec: number[] = [];

  for (let i = 1; i < peaks.length; i += 1) {
    const previous = peaks[i - 1];
    const current = peaks[i];

    const interval =
      current.timestamp - previous.timestamp;

    if (Number.isFinite(interval) && interval > 0) {
      intervalsSec.push(interval);
    }
  }

  return {
    peaks,
    intervalsSec,
    pulseConsistencyPct: calcPulseConsistency(peaks),
    intervalAccuracyPct: calcIntervalAccuracy(
      peaks,
      targetIntervalSec,
    ),
  };
}