import { PitchFrame } from './pitch';

export interface PitchTransition {
  fromFreq: number;
  toFreq: number;
  timestamp: number;
}

export function detectPitchChanges(pitchFrames: PitchFrame[], changeThresholdHz = 15): PitchTransition[] {
  const transitions: PitchTransition[] = [];
  for (let i = 1; i < pitchFrames.length; i++) {
    const diff = Math.abs(pitchFrames[i].frequency - pitchFrames[i - 1].frequency);
    if (diff > changeThresholdHz) {
      transitions.push({
        fromFreq: pitchFrames[i - 1].frequency,
        toFreq: pitchFrames[i].frequency,
        timestamp: pitchFrames[i].timestamp,
      });
    }
  }
  return transitions;
}

export function calcTransitionSpeed(transitionCount: number, durationSec: number): number {
  return durationSec === 0 ? 0 : transitionCount / durationSec;
}

export function calcJumpTime(note1EndTimestamp: number, note2StartTimestamp: number): number {
  return note2StartTimestamp - note1EndTimestamp;
}

export function calcTrillAccuracy(alternations: PitchTransition[], targetNotes: [number, number]): number {
  if (alternations.length === 0) return 0;
  let correct = 0;
  for (const t of alternations) {
    const matchesFrom =
      Math.abs(t.fromFreq - targetNotes[0]) / targetNotes[0] < 0.05 ||
      Math.abs(t.fromFreq - targetNotes[1]) / targetNotes[1] < 0.05;
    const matchesTo =
      Math.abs(t.toFreq - targetNotes[0]) / targetNotes[0] < 0.05 ||
      Math.abs(t.toFreq - targetNotes[1]) / targetNotes[1] < 0.05;
    if (matchesFrom && matchesTo) correct++;
  }
  return (correct / alternations.length) * 100;
}