import { calcRMS, calcRMSConsistency, rmsToDb } from '@/utils/dsp/rms';

export interface VolumeLiveReading {
  volumeDb: number;
  consistencyPct: number;
}

export function measureVolumeFreeModeFrame(
  runningBuffer: Float32Array,
  sampleRate: number
): VolumeLiveReading {
  return {
    volumeDb: rmsToDb(calcRMS(runningBuffer), 1),
    consistencyPct: calcRMSConsistency(runningBuffer, 50, sampleRate),
  };
}