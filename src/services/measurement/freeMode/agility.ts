import { calcTransitionSpeed, detectPitchChanges } from '@/utils/dsp/agility';
import {
  filterByClarity,
  trackPitchOverTime,
} from '@/utils/dsp/pitch';

export interface AgilityLiveReading {
  speedNotesPerSec: number;
  accuracyPct: number;
}

export function measureAgilityFreeModeFrame(
  runningBuffer: Float32Array,
  sampleRate: number
): AgilityLiveReading {
  if (
    sampleRate <= 0 ||
    runningBuffer.length < 2048
  ) {
    return {
      speedNotesPerSec: 0,
      accuracyPct: 0,
    };
  }

  const frames = trackPitchOverTime(
    runningBuffer,
    30,
    sampleRate
  );

  if (frames.length === 0) {
    return {
      speedNotesPerSec: 0,
      accuracyPct: 0,
    };
  }

  /*
   * Only use sufficiently clear/voiced pitch frames
   * when detecting note movement.
   */
  const voicedFrames = filterByClarity(
    frames,
    0.8
  );

  /*
   * Free Mode has no target sequence.
   * Therefore, "accuracy" represents pitch detection
   * clarity rather than target-note accuracy.
   */
  const accuracyPct =
    Math.round(
      (voicedFrames.length / frames.length) * 100
    );

  /*
   * Detect transitions only between valid voiced
   * pitch frames.
   */
  const transitions = detectPitchChanges(
    voicedFrames,
    15
  );

  /*
   * Use the actual analyzed buffer duration.
   */
  const durationSec =
    runningBuffer.length / sampleRate;

  return {
    speedNotesPerSec:
      calcTransitionSpeed(
        transitions.length,
        durationSec
      ),

    accuracyPct,
  };
}