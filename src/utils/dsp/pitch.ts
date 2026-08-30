import { PitchDetector } from 'pitchy';

export interface PitchFrame {
  frequency: number;
  clarity: number;
  timestamp: number;
}

const detector = PitchDetector.forFloat32Array(2048);

export function filterByClarity(frames: PitchFrame[], clarityThreshold = 0.8): PitchFrame[] {
  return frames.filter((f) => f.clarity >= clarityThreshold);
}

export function trackPitchOverTime(
  samples: Float32Array,
  frameSizeMs: number,
  sampleRate: number
): PitchFrame[] {
  const frameSize = Math.floor((frameSizeMs / 1000) * sampleRate);
  const frames: PitchFrame[] = [];
  for (let i = 0; i + frameSize <= samples.length; i += frameSize) {
    const chunk = samples.subarray(i, i + frameSize);
    const [frequency, clarity] = detector.findPitch(chunk, sampleRate);
    frames.push({ frequency, clarity, timestamp: i / sampleRate });
  }
  return frames;
}

export function calcPitchAccuracy(detectedFreq: number, targetFreq: number): number {
  if (targetFreq === 0) return 0;
  const deviation = Math.abs(detectedFreq - targetFreq) / targetFreq;
  return Math.max(0, 100 - deviation * 100);
}

export function calcJitterStability(pitchArray: number[]): number {
  if (pitchArray.length === 0) return 0;
  const mean = pitchArray.reduce((a, b) => a + b, 0) / pitchArray.length;
  const variance = pitchArray.reduce((sum, v) => sum + Math.abs(v - mean), 0) / pitchArray.length;
  const relativeVar = mean === 0 ? 1 : variance / mean;
  return Math.max(0, 100 - relativeVar * 100);
}

export function calcIntervalRatio(freq1: number, freq2: number): number {
  if (freq1 === 0) return 0;
  return freq2 / freq1;
}

export function segmentAudioByPause(
  samples: Float32Array,
  silenceThreshold = 0.01,
  minSilenceMs = 100,
  sampleRate = 44100
): [Float32Array, Float32Array] {
  const minSilenceSamples = Math.floor((minSilenceMs / 1000) * sampleRate);
  let silenceStart = -1;
  let splitIndex = Math.floor(samples.length / 2);

  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]) < silenceThreshold) {
      if (silenceStart === -1) silenceStart = i;
      if (i - silenceStart >= minSilenceSamples) {
        splitIndex = silenceStart;
        break;
      }
    } else {
      silenceStart = -1;
    }
  }

  return [samples.subarray(0, splitIndex), samples.subarray(splitIndex)];
}

export function segmentIntoNotes(
  samples: Float32Array,
  noteCount: number,
  _silenceThreshold = 0.01,
  _sampleRate = 44100
): Float32Array[] {
  // Simplified equal-split segmentation for a first working version.
  // A later pass should detect onset/pause boundaries per note instead
  // of dividing the recording evenly.
  const segments: Float32Array[] = [];
  const segmentLength = Math.floor(samples.length / noteCount);
  for (let n = 0; n < noteCount; n++) {
    segments.push(samples.subarray(n * segmentLength, (n + 1) * segmentLength));
  }
  return segments;
}

export function calcTransitionSmoothness(detectedFreqs: number[]): number {
  if (detectedFreqs.length < 2) return 100;
  const diffs: number[] = [];
  for (let i = 1; i < detectedFreqs.length; i++) {
    diffs.push(Math.abs(detectedFreqs[i] - detectedFreqs[i - 1]));
  }
  const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  const variance = diffs.reduce((sum, d) => sum + Math.abs(d - mean), 0) / diffs.length;
  return Math.max(0, 100 - variance * 0.5);
}

export function calcNoteAccuracyBatch(detectedFreqs: number[], targetFreqs: number[]): number {
  if (detectedFreqs.length === 0) return 0;
  let withinTolerance = 0;
  for (let i = 0; i < detectedFreqs.length; i++) {
    if (calcPitchAccuracy(detectedFreqs[i], targetFreqs[i]) >= 93) withinTolerance++;
  }
  return (withinTolerance / detectedFreqs.length) * 100;
}

export function calcPatternAccuracy(detectedFreqs: number[], targetFreqs: number[]): number {
  return calcNoteAccuracyBatch(detectedFreqs, targetFreqs);
}

export function calcRhythmAccuracy(noteTimestamps: number[], targetTimestamps: number[]): number {
  if (noteTimestamps.length === 0) return 0;
  let totalDeviation = 0;
  for (let i = 0; i < noteTimestamps.length; i++) {
    totalDeviation += Math.abs(noteTimestamps[i] - targetTimestamps[i]);
  }
  return Math.max(0, 100 - (totalDeviation / noteTimestamps.length) * 100);
}