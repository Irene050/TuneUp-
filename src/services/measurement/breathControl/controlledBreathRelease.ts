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

  console.log('🔎 MEASUREMENT STARTED:', {
  sampleCount: samples.length,
  sampleRate,
  durationSec: samples.length / sampleRate,
});

  const rmsLevel = calcRMS(samples);

  const peaks = detectPulses(
    samples,
    rmsLevel,
    sampleRate,
  );

  console.log('🔎 MEASUREMENT RESULT:', {
  detectedPulses: peaks.length,
  sampleCount: samples.length,
});

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