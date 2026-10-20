
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
  timestamp: number;
};

type NoteEvent = {
  midi: number;
  frames: PitchFrame[];
  startTime: number;
  endTime: number;
};

type ReferenceNote = {
  midi: number;
  startTime: number;
  endTime: number;
};

type NoteEvaluation = {
  expectedMidi: number;
  detectedMidi: number | null;
  accuracy: number;
  frameCount: number;
};

const MIN_RMS = 0.002;
const MIN_CLARITY = 0.7;
const MIN_HZ = 60;
const MAX_HZ = 1500;

const MIN_EVENT_FRAMES = 2;
const MAX_FRAME_GAP_SECONDS = 0.12;
const NOTE_CHANGE_SEMITONES = 1.5;

const MIN_DURATION_SECONDS = 5;
const MIN_VOICED_FRAMES = 12;
const MIN_DETECTED_EVENTS = 4;
const MIN_VOICED_COVERAGE = 0.12;

// Ignore note boundaries when measuring pitch, because transitions
// between syllables often contain brief slides and consonant sounds.
const NOTE_EDGE_IGNORE_RATIO = 0.15;

// Permit a short leading delay before the first sung note.
// This shifts the evaluation windows but does not award rhythm points.
const MAX_START_OFFSET_SECONDS = 2;
const START_OFFSET_STEP_SECONDS = 0.05;

// Pitch error scoring in cents:
// 0 cents = 100, 50 cents = 50, 100 cents or more = 0.
const CENTS_FOR_ZERO_ACCURACY = 100;

// A reference note needs enough pitch frames to be evaluated.
const MIN_FRAMES_PER_REFERENCE_NOTE = 2;

function clamp(
  value: number,
  min = 0,
  max = 100,
): number {
  if (!Number.isFinite(value)) return min;
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

  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function getPitchFrames(
  samples: Float32Array,
  sampleRate: number,
): PitchFrame[] {
  const frames: PitchFrame[] = [];
  const frameSize = SINGING_ASSESSMENT_BUFFER_SIZE;
  const hopSize = Math.floor(frameSize / 2);

  for (
    let offset = 0;
    offset + frameSize <= samples.length;
    offset += hopSize
  ) {
    const chunk = samples.subarray(offset, offset + frameSize);
    const rms = calcRMS(chunk);

    if (!Number.isFinite(rms) || rms < MIN_RMS) {
      continue;
    }

    let pitchResult: ReturnType<typeof analyzePitchFrame>;

    try {
      pitchResult = analyzePitchFrame(chunk, sampleRate);
    } catch {
      continue;
    }

    const { frequency, clarity } = pitchResult;

    if (
      !Number.isFinite(frequency) ||
      frequency < MIN_HZ ||
      frequency > MAX_HZ ||
      !Number.isFinite(clarity) ||
      clarity < MIN_CLARITY
    ) {
      continue;
    }

    const midi = frequencyToMidi(frequency);

    if (!Number.isFinite(midi)) {
      continue;
    }

    frames.push({
      midi,
      clarity,
      db: rmsToDb(rms),
      timestamp: offset / sampleRate,
    });
  }

  return frames;
}

/**
 * Creates reference-note windows using the melody's expected beat lengths.
 *
 * The timestamps are relative to the start of the melody, not to the
 * current UI highlight or the recording's final duration.
 */
function buildReferenceTimeline(): ReferenceNote[] {
  const secondsPerBeat = 60 / SINGING_ASSESSMENT_BPM;
  let cursor = 0;

  return MARY_MELODY.map((note) => {
    const startTime = cursor;
    const endTime = startTime + note.beats * secondsPerBeat;

    cursor = endTime;

    return {
      midi: note.midi,
      startTime,
      endTime,
    };
  });
}

const REFERENCE_TIMELINE = buildReferenceTimeline();

function getExpectedMelodyDuration(): number {
  if (!REFERENCE_TIMELINE.length) return 0;

  return REFERENCE_TIMELINE[
    REFERENCE_TIMELINE.length - 1
  ].endTime;
}

/**
 * Group detected pitches for diagnostic note counts and stability analysis.
 * The final melody-accuracy score does not depend on these event boundaries.
 */
function segmentNotes(frames: PitchFrame[]): NoteEvent[] {
  const events: NoteEvent[] = [];
  let current: PitchFrame[] = [];

  const flush = () => {
    if (current.length >= MIN_EVENT_FRAMES) {
      events.push({
        midi: median(current.map((frame) => frame.midi)),
        frames: [...current],
        startTime: current[0].timestamp,
        endTime: current[current.length - 1].timestamp,
      });
    }

    current = [];
  };

  for (const frame of frames) {
    if (!current.length) {
      current.push(frame);
      continue;
    }

    const previous = current[current.length - 1];
    const center = median(current.map((item) => item.midi));

    const timeGap = frame.timestamp - previous.timestamp;
    const pitchChange = Math.abs(frame.midi - center);

    if (
      timeGap > MAX_FRAME_GAP_SECONDS ||
      pitchChange > NOTE_CHANGE_SEMITONES
    ) {
      flush();
    }

    current.push(frame);
  }

  flush();

  return events;
}

/**
 * Maps an absolute pitch error in cents to an accuracy score.
 * Large errors, including octave errors, receive zero accuracy.
 */
function centsToAccuracy(errorCents: number): number {
  return round1(
    clamp(
      100 * (1 - errorCents / CENTS_FOR_ZERO_ACCURACY),
    ),
  );
}

/**
 * Collects usable pitch frames from the interior of one expected note.
 *
 * A frame must fall within the reference note's interior, not just near
 * its start or end. This reduces the effect of pitch transitions.
 */
function getFramesForReferenceNote(
  frames: PitchFrame[],
  note: ReferenceNote,
  startOffset: number,
): PitchFrame[] {
  const duration = note.endTime - note.startTime;

  const usableStart =
    note.startTime + duration * NOTE_EDGE_IGNORE_RATIO + startOffset;

  const usableEnd =
    note.endTime - duration * NOTE_EDGE_IGNORE_RATIO + startOffset;

  return frames.filter(
    (frame) =>
      frame.timestamp >= usableStart &&
      frame.timestamp < usableEnd,
  );
}

/**
 * Evaluate the median pitch within each expected note window.
 *
 * Every reference note contributes to the final score. A note without
 * sufficient usable pitch data receives zero accuracy instead of being
 * silently omitted. The time windows identify notes; timing deviations
 * are not separately deducted as a rhythm score.
 */
function evaluateReferenceNotes(
  frames: PitchFrame[],
  startOffset: number,
): NoteEvaluation[] {
  return REFERENCE_TIMELINE.map((referenceNote) => {
    const noteFrames = getFramesForReferenceNote(
      frames,
      referenceNote,
      startOffset,
    );

    if (noteFrames.length < MIN_FRAMES_PER_REFERENCE_NOTE) {
      return {
        expectedMidi: referenceNote.midi,
        detectedMidi: null,
        accuracy: 0,
        frameCount: noteFrames.length,
      };
    }

    const detectedMidi = median(
      noteFrames.map((frame) => frame.midi),
    );

    const errorCents = centsDistance(
      detectedMidi,
      referenceNote.midi,
    );

    return {
      expectedMidi: referenceNote.midi,
      detectedMidi,
      accuracy: centsToAccuracy(errorCents),
      frameCount: noteFrames.length,
    };
  });
}

/**
 * Select the leading offset that best fits the reference melody.
 *
 * A small offset helps when the singer starts just after the recording
 * begins. It does not transpose the melody or change the reference key.
 */
function findBestMelodyAlignment(
  frames: PitchFrame[],
  durationSeconds: number,
): {
  startOffset: number;
  evaluations: NoteEvaluation[];
} {
  const expectedDuration = getExpectedMelodyDuration();

  const latestUsefulOffset = Math.max(
    0,
    Math.min(
      MAX_START_OFFSET_SECONDS,
      durationSeconds - expectedDuration * 0.5,
    ),
  );

  let bestOffset = 0;
  let bestEvaluations = evaluateReferenceNotes(frames, 0);
  let bestScore = scoreEvaluations(bestEvaluations);

  for (
    let offset = START_OFFSET_STEP_SECONDS;
    offset <= latestUsefulOffset + 0.0001;
    offset += START_OFFSET_STEP_SECONDS
  ) {
    const evaluations = evaluateReferenceNotes(frames, offset);
    const score = scoreEvaluations(evaluations);

    if (score > bestScore) {
      bestScore = score;
      bestOffset = offset;
      bestEvaluations = evaluations;
    }
  }

  return {
    startOffset: bestOffset,
    evaluations: bestEvaluations,
  };
}

function scoreEvaluations(
  evaluations: NoteEvaluation[],
): number {
  if (!evaluations.length) return 0;

  const total = evaluations.reduce(
    (sum, evaluation) => sum + evaluation.accuracy,
    0,
  );

  return total / evaluations.length;
}

function calculateMelodyAccuracy(
  evaluations: NoteEvaluation[],
): number {
  return round1(clamp(scoreEvaluations(evaluations)));
}

/**
 * Calculate pitch stability within reference-note windows.
 *
 * This measures variation around each window's median pitch. It avoids
 * penalizing a legitimate transition from one reference note to another.
 * Notes without enough frames are excluded from stability, but they still
 * count as missing in pitch accuracy.
 */

function calculateStability(events: NoteEvent[]): number {
  const usableEvents = events.filter(
    (event) => event.frames.length >= MIN_EVENT_FRAMES,
  );

  if (!usableEvents.length) return 0;

  let totalVariation = 0;
  let totalFrames = 0;

  for (const event of usableEvents) {
    const center = median(
      event.frames.map((frame) => frame.midi),
    );

    for (const frame of event.frames) {
      totalVariation += centsDistance(frame.midi, center);
      totalFrames += 1;
    }
  }

  if (!totalFrames) return 0;

  const averageVariation = totalVariation / totalFrames;

  // Smoothly reduce the score as within-note pitch variation increases.
  // 0 cents = 100; 25 cents = 75; 50 cents = 50; 100 cents = 0.
  return round1(
    clamp(100 - averageVariation),
  );
}

/**
 * Measures recorded microphone-level consistency, not vocal quality.
 */
function calculateVocalConsistency(
  frames: PitchFrame[],
): number {
  if (frames.length < 5) return 0;

  const levels = frames.map((frame) => frame.db);

  const mean =
    levels.reduce((sum, value) => sum + value, 0) /
    levels.length;

  const variance =
    levels.reduce(
      (sum, value) => sum + (value - mean) ** 2,
      0,
    ) / levels.length;

  const standardDeviation = Math.sqrt(variance);

  return round1(clamp(100 - standardDeviation * 5));
}

function createFeedback(
  pitchAccuracy: number,
  pitchStability: number,
  vocalConsistency: number,
  voicedCoverage: number,
  evaluations: NoteEvaluation[],
): string[] {
  const feedback: string[] = [];

  const missingNotes = evaluations.filter(
    (evaluation) => evaluation.detectedMidi === null,
  ).length;

  if (voicedCoverage < 0.35) {
    feedback.push(
      'Much of the recording did not contain clearly detected singing. Try singing the complete melody closer to the microphone in a quiet room.',
    );
  }

  if (missingNotes > 0) {
    feedback.push(
      `${missingNotes} reference note${missingNotes === 1 ? ' was' : 's were'} not detected clearly enough to score. Make sure you sing the full melody and hold each note long enough for detection.`,
    );
  }

  if (pitchAccuracy < 50) {
    feedback.push(
      'Many notes were far from the reference pitches or could not be detected. Practice one reference note at a time before singing the complete melody.',
    );
  } else if (pitchAccuracy < 75) {
    feedback.push(
      'Some notes matched the reference, but others need work. Focus on matching each note instead of sliding between pitches.',
    );
  } else if (pitchAccuracy < 90) {
    feedback.push(
      'Your detected pitches generally followed the reference melody. Keep working on the notes that are slightly sharp or flat.',
    );
  } else {
    feedback.push(
      'Your detected pitches closely matched the reference melody. Continue practicing to maintain that accuracy consistently.',
    );
  }

  if (pitchStability < 50) {
    feedback.push(
      'Your detected pitch varied considerably within notes. Try holding each note steadily without unintended slides.',
    );
  } else if (pitchStability < 75) {
    feedback.push(
      'Work on maintaining a steady pitch while holding notes. Slow practice may help reduce unintended fluctuations.',
    );
  } else {
    feedback.push(
      'The detected pitches were relatively steady within the evaluated notes.',
    );
  }

  if (vocalConsistency < 50) {
    feedback.push(
      'The recorded microphone level varied considerably. Keep a comfortable, consistent distance from the microphone. Automatic microphone gain can also affect this measurement.',
    );
  } else {
    feedback.push(
      'The recorded microphone level was relatively consistent. This measures recording level, not vocal quality directly.',
    );
  }

  return feedback;
}

export function calculateSingingAssessmentScore(
  samples: Float32Array,
  sampleRate = SINGING_ASSESSMENT_SAMPLE_RATE,
): SingingAssessmentResult {
  if (
    !Number.isFinite(sampleRate) ||
    sampleRate <= 0 ||
    !(samples instanceof Float32Array) ||
    samples.length === 0
  ) {
    throw new Error(
      'The recording is invalid. Please record the song again.',
    );
  }

  const durationSeconds = samples.length / sampleRate;

  if (
    !Number.isFinite(durationSeconds) ||
    durationSeconds < MIN_DURATION_SECONDS
  ) {
    throw new Error(
      'The recording is too short to score reliably. Please record the complete melody and try again.',
    );
  }

  const frames = getPitchFrames(samples, sampleRate);
  const events = segmentNotes(frames);

  const hopSize = Math.floor(
    SINGING_ASSESSMENT_BUFFER_SIZE / 2,
  );

  // This is an estimate because pitch-analysis windows overlap.
  // It is used only as a rough data-quality check, not as a score.
  const voicedDurationEstimate = Math.min(
    durationSeconds,
    frames.length * (hopSize / sampleRate),
  );

  const voicedCoverage = clamp(
    (voicedDurationEstimate / Math.max(durationSeconds, 0.001)) * 100,
    0,
    100,
  ) / 100;

  if (
    frames.length < MIN_VOICED_FRAMES ||
    events.length < MIN_DETECTED_EVENTS ||
    voicedCoverage < MIN_VOICED_COVERAGE
  ) {
    throw new Error(
      'We could not detect enough clear singing to score this recording reliably. Please sing the complete melody closer to the microphone in a quiet room and try again.',
    );
  }

  const alignment = findBestMelodyAlignment(
    frames,
    durationSeconds,
  );

  const pitchAccuracy = calculateMelodyAccuracy(
    alignment.evaluations,
  );

  const pitchStability = calculateStability(events);

  const vocalConsistency = calculateVocalConsistency(frames);

  // Keep the original scoring contract: pitch correctness is primary.
  // Vocal consistency remains informational and is not part of the total.
  const overallScore = round1(
    clamp(
      pitchAccuracy * 0.8 +
      pitchStability * 0.2,
    ),
  );

  const feedback = createFeedback(
    pitchAccuracy,
    pitchStability,
    vocalConsistency,
    voicedCoverage,
    alignment.evaluations,
  );

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
  if (score >= 90) {
    return 'Excellent work! Keep building consistency with regular practice.';
  }

  if (score >= 75) {
    return 'Good foundation. Focus on the areas highlighted below.';
  }

  if (score >= 60) {
    return 'You are developing your singing skills. Practice the melody slowly and repeat the assessment.';
  }

  return 'Keep practicing. Listen to the reference, then focus on matching one note at a time.';
}