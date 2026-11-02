import { calcRMS, calcRMSConsistency, rmsToDb } from '@/utils/dsp/rms';

export interface FreeModeLiveReading {
  volumeDb: number;
  consistencyPct: number;
}

export function measureFreeModeFrame(
  runningBuffer: Float32Array,
  sampleRate: number,
): FreeModeLiveReading {
  return {
    volumeDb: rmsToDb(calcRMS(runningBuffer), 1),
    consistencyPct: calcRMSConsistency(runningBuffer, 50, sampleRate),
  };
}