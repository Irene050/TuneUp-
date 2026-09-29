import { calcRMS, calcRMSVariance, rmsToDb } from '@/utils/dsp/rms';

export interface BreathControlLiveReading {
  volumeDb: number;
  consistencyPct: number;
}

export function measureBreathControlFreeModeFrame(
  runningBuffer: Float32Array,
  sampleRate: number
): BreathControlLiveReading {
  return {
    volumeDb: rmsToDb(calcRMS(runningBuffer), 1),
    consistencyPct: calcRMSVariance(runningBuffer, 50, sampleRate),
  };
}