import { calcJitterStability, filterByClarity, trackPitchOverTime } from '@/utils/dsp/pitch';

export interface PitchLiveReading {
  detectedFrequency: number;
  stabilityPct: number;
}

export function measurePitchFreeModeFrame(
  runningBuffer: Float32Array,
  sampleRate: number
): PitchLiveReading {
  const frames = filterByClarity(trackPitchOverTime(runningBuffer, 30, sampleRate), 0.8);
  if (frames.length === 0) return { detectedFrequency: 0, stabilityPct: 0 };

  const latest = frames[frames.length - 1].frequency;
  const stabilityPct = calcJitterStability(frames.map((f) => f.frequency));
  return { detectedFrequency: latest, stabilityPct };
}