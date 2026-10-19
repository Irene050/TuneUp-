import { analyzePitchFrame } from '@/utils/dsp/pitch';
import { calcRMS, rmsToDb } from '@/utils/dsp/rms';

export const SINGING_ASSESSMENT_BPM = 100;
export const SINGING_ASSESSMENT_SAMPLE_RATE = 44100;
export const SINGING_ASSESSMENT_BUFFER_SIZE = 2048;

export const MARY_MELODY = [
  { lyric: 'Ma-', midi: 64, beats: 1 },
  { lyric: 'ry', midi: 62, beats: 1 },
  { lyric: 'had', midi: 60, beats: 1 },
  { lyric: 'a', midi: 62, beats: 1 },
  { lyric: 'lit-', midi: 64, beats: 1 },
  { lyric: '-tle', midi: 64, beats: 1 },
  { lyric: 'lamb', midi: 64, beats: 2 },
  { lyric: 'lit-', midi: 62, beats: 1 },
  { lyric: '-tle', midi: 62, beats: 1 },
  { lyric: 'lamb', midi: 62, beats: 2 },
  { lyric: 'lit-', midi: 64, beats: 1 },
  { lyric: '-tle', midi: 67, beats: 1 },
  { lyric: 'lamb', midi: 67, beats: 2 },
  { lyric: 'Ma-', midi: 64, beats: 1 },
  { lyric: 'ry', midi: 62, beats: 1 },
  { lyric: 'had', midi: 60, beats: 1 },
  { lyric: 'a', midi: 62, beats: 1 },
  { lyric: 'lit-', midi: 64, beats: 1 },
  { lyric: '-tle', midi: 64, beats: 1 },
  { lyric: 'lamb', midi: 64, beats: 1 },
  { lyric: 'its', midi: 64, beats: 1 },
  { lyric: 'fleece', midi: 62, beats: 1 },
  { lyric: 'was', midi: 62, beats: 1 },
  { lyric: 'white', midi: 64, beats: 1 },
  { lyric: 'as', midi: 62, beats: 1 },
  { lyric: 'snow', midi: 60, beats: 2 },
] as const;

export type SingingAssessmentResult = {
  overallScore: number;
  pitchAccuracy: number;
  pitchStability: number;
  vocalConsistency: number;
  voicedFrameCount: number;
  detectedNoteCount: number;
  durationSeconds: number;
  feedback: string[];
};

type PitchFrame = {
  midi: number;
  clarity: number;
  db: number;
};

type NoteEvent = {
  midi: number;
  frames: PitchFrame[];
};

const MIN_RMS = 0.002;
const MIN_CLARITY = 0.7;
const MIN_HZ = 60;
const MAX_HZ = 1500;
const MIN_EVENT_FRAMES = 2;
const MAX_FRAME_GAP_SEMITONES = 0.8;

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function frequencyToMidi(frequency: number): number {
  return 69 + 12 * Math.log2(frequency / 440);
}

function centsDistance(a: number, b: number): number {
  return Math.abs(a - b) * 100;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function getPitchFrames(samples: Float32Array, sampleRate: number): PitchFrame[] {
  const frames: PitchFrame[] = [];
  const frameSize = SINGING_ASSESSMENT_BUFFER_SIZE;
  const hopSize = 1024;

  for (let offset = 0; offset + frameSize <= samples.length; offset += hopSize) {
    const chunk = samples.subarray(offset, offset + frameSize);
    const rms = calcRMS(chunk);
    if (!Number.isFinite(rms) || rms < MIN_RMS) continue;

    let pitchResult: ReturnType<typeof analyzePitchFrame>;
    try {
      pitchResult = analyzePitchFrame(chunk, sampleRate);
    } catch {
      continue;
    }

    const frequency = pitchResult.frequency;
    const clarity = pitchResult.clarity;
    if (
      !Number.isFinite(frequency) ||
      frequency < MIN_HZ ||
      frequency > MAX_HZ ||
      !Number.isFinite(clarity) ||
      clarity < MIN_CLARITY
    ) {
      continue;
    }

    frames.push({
      midi: frequencyToMidi(frequency),
      clarity,
      db: rmsToDb(rms),
    });
  }

  return frames;
}

function segmentNotes(frames: PitchFrame[]): NoteEvent[] {
  const events: NoteEvent[] = [];
  let current: PitchFrame[] = [];

  const flush = () => {
    if (current.length >= MIN_EVENT_FRAMES) {
      events.push({
        midi: median(current.map((frame) => frame.midi)),
        frames: current,
      });
    }
    current = [];
  };

  for (const frame of frames) {
    if (!current.length) {
      current.push(frame);
      continue;
    }

    const currentMedian = median(current.map((item) => item.midi));
    if (Math.abs(frame.midi - currentMedian) <= MAX_FRAME_GAP_SEMITONES) {
      current.push(frame);
    } else {
      flush();
      current.push(frame);
    }
  }

  flush();
  return events;
}

function calculateMelodyAccuracy(events: NoteEvent[]): number {
  if (!events.length) return 0;

  const reference = MARY_MELODY.map((note) => note.midi);
  let bestScore = 0;

  for (let transpose = -18; transpose <= 18; transpose += 1) {
    const rows = reference.length + 1;
    const cols = events.length + 1;
    const dp = Array.from({ length: rows }, () => Array<number>(cols).fill(0));

    for (let i = 1; i < rows; i += 1) dp[i][0] = i * 0.8;
    for (let j = 1; j < cols; j += 1) dp[0][j] = j * 0.8;

    for (let i = 1; i < rows; i += 1) {
      for (let j = 1; j < cols; j += 1) {
        const semitoneError = Math.abs(events[j - 1].midi - (reference[i - 1] + transpose));
        const pitchCost = Math.min(2, semitoneError / 2);
        dp[i][j] = Math.min(
          dp[i - 1][j - 1] + pitchCost,
          dp[i - 1][j] + 0.8,
          dp[i][j - 1] + 0.8,
        );
      }
    }

    const normalizedCost = dp[rows - 1][cols - 1] / Math.max(reference.length, events.length);
    bestScore = Math.max(bestScore, clamp(100 - normalizedCost * 45));
  }

  return round1(bestScore);
}

function calculateStability(events: NoteEvent[]): number {
  const usable = events.filter((event) => event.frames.length >= MIN_EVENT_FRAMES);
  if (!usable.length) return 0;

  const eventScores = usable.map((event) => {
    const center = median(event.frames.map((frame) => frame.midi));
    const meanAbsoluteCents = event.frames.reduce(
      (sum, frame) => sum + centsDistance(frame.midi, center),
      0,
    ) / event.frames.length;

    // 0 cents variation maps to 100; 100 cents mean variation maps to 0.
    return clamp(100 - meanAbsoluteCents);
  });

  return round1(eventScores.reduce((sum, score) => sum + score, 0) / eventScores.length);
}

function calculateVocalConsistency(frames: PitchFrame[]): number {
  if (frames.length < 5) return 0;
  const levels = frames.map((frame) => frame.db);
  const mean = levels.reduce((sum, value) => sum + value, 0) / levels.length;
  const variance = levels.reduce((sum, value) => sum + (value - mean) ** 2, 0) / levels.length;
  const standardDeviation = Math.sqrt(variance);

  // This is relative microphone-level consistency, not calibrated SPL or
  // a direct measure of vocal tone/technique.
  return round1(clamp(100 - standardDeviation * 5));
}

export function calculateSingingAssessmentScore(
  samples: Float32Array,
  sampleRate = SINGING_ASSESSMENT_SAMPLE_RATE,
): SingingAssessmentResult {
  const safeSampleRate = Number.isFinite(sampleRate) && sampleRate > 0
    ? sampleRate
    : SINGING_ASSESSMENT_SAMPLE_RATE;
  const durationSeconds = samples.length / safeSampleRate;
  const frames = getPitchFrames(samples, safeSampleRate);
  const events = segmentNotes(frames);

  if (durationSeconds < 5 || frames.length < 12 || events.length < 4) {
    throw new Error(
      'We could not detect enough clear singing. Please move closer to the microphone and try again.',
    );
  }

  const pitchAccuracy = calculateMelodyAccuracy(events);
  const pitchStability = calculateStability(events);
  const vocalConsistency = calculateVocalConsistency(frames);
  const overallScore = round1(
    pitchAccuracy * 0.5 + pitchStability * 0.3 + vocalConsistency * 0.2,
  );

  const feedback: string[] = [];
  if (pitchAccuracy < 70) {
    feedback.push('Practice matching each note in the reference melody before singing the full song.');
  } else {
    feedback.push('Your notes generally followed the reference melody. Keep listening closely to each pitch.');
  }
  if (pitchStability < 70) {
    feedback.push('Try holding each note steadily and avoid sliding between notes unless the melody calls for it.');
  } else {
    feedback.push('Your sustained notes were relatively steady. Continue practicing relaxed, controlled singing.');
  }
  if (vocalConsistency < 70) {
    feedback.push('Try keeping a comfortable, consistent distance from the microphone and maintaining a steady vocal level.');
  } else {
    feedback.push('Your recorded vocal level was relatively consistent. Remember that microphone distance can affect this measurement.');
  }

  return {
    overallScore,
    pitchAccuracy,
    pitchStability,
    vocalConsistency,
    voicedFrameCount: frames.length,
    detectedNoteCount: events.length,
    durationSeconds: round1(durationSeconds),
    feedback,
  };
}

export function getSingingScoreMessage(score: number): string {
  if (score >= 90) return 'Excellent work! Keep building consistency with regular practice.';
  if (score >= 75) return 'Good foundation. Focus on the areas highlighted below.';
  if (score >= 60) return 'You are developing your singing skills. Practice the melody slowly and repeat the assessment.';
  return 'Keep practicing. Listen to the reference, then focus on matching one note at a time.';
}
