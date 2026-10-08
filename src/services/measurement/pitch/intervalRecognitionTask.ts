import {
  calcIntervalRatio,
  filterByClarity,
  trackPitchOverTime,
} from '@/utils/dsp/pitch';

export interface IntervalRecognitionAttemptMeasurement {
  freq1: number;
  freq2: number;
  detectedRatio: number;

  hasFirstNote: boolean;
  hasSecondNote: boolean;

  firstNoteClarity: number;
  secondNoteClarity: number;
}

export interface IntervalRecognitionMeasurement {
  freq1: number;
  freq2: number;
  detectedRatio: number;

  hasFirstNote: boolean;
  hasSecondNote: boolean;

  firstNoteClarity: number;
  secondNoteClarity: number;

  attempts: IntervalRecognitionAttemptMeasurement[];
}

const FRAME_MS = 30;
const NOTE_CHANGE_SEMITONES = 1.5;
const MIN_NOTE_FRAMES = 5;
const MIN_PITCH_HZ = 80;
const MAX_PITCH_HZ = 1000;

function emptyResult(): IntervalRecognitionMeasurement {
  return {
    freq1: 0,
    freq2: 0,
    detectedRatio: 0,

    hasFirstNote: false,
    hasSecondNote: false,

    firstNoteClarity: 0,
    secondNoteClarity: 0,

    attempts: [],
  };
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort(
    (a, b) => a - b,
  );

  const middle = Math.floor(
    sorted.length / 2,
  );

  return sorted.length % 2 === 0
    ? (
        sorted[middle - 1] +
        sorted[middle]
      ) / 2
    : sorted[middle];
}

function frequencyToMidi(
  frequency: number,
): number {
  if (
    !Number.isFinite(frequency) ||
    frequency <= 0
  ) {
    return 0;
  }

  return (
    69 +
    12 *
      Math.log2(
        frequency / 440,
      )
  );
}

interface PitchPoint {
  frequency: number;
  clarity: number;
  timestamp: number;
}

interface DetectedNote {
  frequency: number;
  clarity: number;
  start: number;
  end: number;
}

/**
 * Converts the raw recording into usable pitch frames.
 *
 * Low-clarity frames are discarded before attempting
 * to detect note transitions.
 */
function getPitchFrames(
  samples: Float32Array,
  sampleRate: number,
  minClarity: number,
): PitchPoint[] {
  const frames =
    trackPitchOverTime(
      samples,
      FRAME_MS,
      sampleRate,
    );

  return filterByClarity(
    frames,
    minClarity,
  )
    .filter(
      frame =>
        Number.isFinite(
          frame.frequency,
        ) &&
        frame.frequency >=
          MIN_PITCH_HZ &&
        frame.frequency <=
          MAX_PITCH_HZ,
    )
    .map(frame => ({
      frequency: frame.frequency,
      clarity: frame.clarity,
      timestamp: frame.timestamp,
    }));
}

/**
 * Groups pitch frames into stable notes.
 *
 * Unlike the old implementation, this does NOT require
 * silence between two notes.
 */
function detectNotes(
  frames: PitchPoint[],
): DetectedNote[] {
  if (frames.length === 0) {
    return [];
  }

  const notes: DetectedNote[] = [];

  let currentFrames: PitchPoint[] = [];

  const flushCurrentNote = () => {
    if (
      currentFrames.length <
      MIN_NOTE_FRAMES
    ) {
      currentFrames = [];
      return;
    }

    const frequencies =
      currentFrames.map(
        frame => frame.frequency,
      );

    const clarities =
      currentFrames.map(
        frame => frame.clarity,
      );

    notes.push({
      frequency:
        median(frequencies),

      clarity:
        clarities.reduce(
          (sum, value) =>
            sum + value,
          0,
        ) /
        clarities.length,

      start:
        currentFrames[0]
          ?.timestamp ?? 0,

      end:
        currentFrames[
          currentFrames.length - 1
        ]?.timestamp ?? 0,
    });

    currentFrames = [];
  };

  for (const frame of frames) {
    if (currentFrames.length === 0) {
      currentFrames.push(frame);
      continue;
    }

    const lastFrame =
      currentFrames[
        currentFrames.length - 1
      ];

    const lastMidi =
      frequencyToMidi(
        lastFrame.frequency,
      );

    const currentMidi =
      frequencyToMidi(
        frame.frequency,
      );

    const semitoneDifference =
      Math.abs(
        currentMidi - lastMidi,
      );

    /*
     * Small pitch movement is considered normal
     * vibrato / natural singing variation.
     */
    if (
      semitoneDifference <
      NOTE_CHANGE_SEMITONES
    ) {
      currentFrames.push(frame);
      continue;
    }

    /*
     * A sufficiently large pitch movement means
     * the singer probably moved to another note.
     */
    if (
      currentFrames.length >=
      MIN_NOTE_FRAMES
    ) {
      flushCurrentNote();
      currentFrames.push(frame);
      continue;
    }

    /*
     * Current note was too short to be reliable.
     * Start building the new note instead.
     */
    currentFrames = [frame];
  }

  flushCurrentNote();

  /*
   * Remove accidental duplicate notes that can occur
   * when the pitch detector briefly jumps and then
   * returns to the original pitch.
   */
  const cleaned: DetectedNote[] = [];

  for (const note of notes) {
    const previous =
      cleaned[cleaned.length - 1];

    if (!previous) {
      cleaned.push(note);
      continue;
    }

    const difference =
      Math.abs(
        frequencyToMidi(
          note.frequency,
        ) -
          frequencyToMidi(
            previous.frequency,
          ),
      );

    if (
      difference <
      NOTE_CHANGE_SEMITONES
    ) {
      previous.frequency =
        median([
          previous.frequency,
          note.frequency,
        ]);

      previous.clarity =
        (
          previous.clarity +
          note.clarity
        ) / 2;

      previous.end =
        note.end;
    } else {
      cleaned.push(note);
    }
  }

  return cleaned;
}

/**
 * Builds root -> target interval attempts.
 *
 * Example:
 *
 * C4 G4 C4 G4
 *
 * becomes:
 *
 * Attempt 1: C4 -> G4
 * Attempt 2: C4 -> G4
 */
function buildAttempts(
  notes: DetectedNote[],
  expectedRepetitions: number,
): IntervalRecognitionAttemptMeasurement[] {
  const requested =
    Math.max(
      1,
      Math.round(
        expectedRepetitions,
      ),
    );

  const attempts: IntervalRecognitionAttemptMeasurement[] =
    [];

  for (
    let i = 0;
    i + 1 < notes.length &&
    attempts.length < requested;
    i += 2
  ) {
    const first = notes[i];
    const second = notes[i + 1];

    if (!first || !second) {
      continue;
    }

    const hasFirstNote =
      Number.isFinite(
        first.frequency,
      ) &&
      first.frequency > 0;

    const hasSecondNote =
      Number.isFinite(
        second.frequency,
      ) &&
      second.frequency > 0;

    const detectedRatio =
      hasFirstNote &&
      hasSecondNote
        ? calcIntervalRatio(
            first.frequency,
            second.frequency,
          )
        : 0;

    attempts.push({
      freq1: first.frequency,
      freq2: second.frequency,

      detectedRatio,

      hasFirstNote,
      hasSecondNote,

      firstNoteClarity:
        first.clarity,

      secondNoteClarity:
        second.clarity,
    });
  }

  return attempts;
}

export function measureIntervalRecognition(
  samples: Float32Array,
  sampleRate: number,
  minClarity = 0.70,
  expectedRepetitions = 1,
): IntervalRecognitionMeasurement {
  if (
    !samples ||
    samples.length < 4096 ||
    !Number.isFinite(sampleRate) ||
    sampleRate <= 0
  ) {
    return emptyResult();
  }

  try {
    const pitchFrames =
      getPitchFrames(
        samples,
        sampleRate,
        minClarity,
      );

    if (pitchFrames.length === 0) {
      return emptyResult();
    }

    const notes =
      detectNotes(
        pitchFrames,
      );

    console.log(
      '🎵 INTERVAL PITCH FRAMES:',
      pitchFrames.length,
    );

    console.log(
      '🎵 INTERVAL DETECTED NOTES:',
      notes.map(note => ({
        frequency:
          Math.round(
            note.frequency * 100,
          ) / 100,

        midi:
          Math.round(
            frequencyToMidi(
              note.frequency,
            ) * 100,
          ) / 100,

        clarity:
          Math.round(
            note.clarity * 100,
          ) / 100,

        start:
          Math.round(
            note.start * 1000,
          ) / 1000,

        end:
          Math.round(
            note.end * 1000,
          ) / 1000,
      })),
    );

    if (notes.length < 2) {
      return emptyResult();
    }

    const attempts =
      buildAttempts(
        notes,
        expectedRepetitions,
      );

    console.log(
      '🎵 INTERVAL ATTEMPTS:',
      attempts.map(
        attempt => ({
          freq1:
            Math.round(
              attempt.freq1 * 100,
            ) / 100,

          freq2:
            Math.round(
              attempt.freq2 * 100,
            ) / 100,

          ratio:
            Math.round(
              attempt.detectedRatio *
                1000,
            ) / 1000,

          clarity1:
            Math.round(
              attempt.firstNoteClarity *
                100,
            ) / 100,

          clarity2:
            Math.round(
              attempt.secondNoteClarity *
                100,
            ) / 100,
        }),
      ),
    );

    if (attempts.length === 0) {
      return emptyResult();
    }

    const validAttempts =
      attempts.filter(
        attempt =>
          attempt.hasFirstNote &&
          attempt.hasSecondNote &&
          Number.isFinite(
            attempt.detectedRatio,
          ) &&
          attempt.detectedRatio > 0,
      );

    if (
      validAttempts.length === 0
    ) {
      return {
        ...emptyResult(),
        attempts,
      };
    }

    const aggregateFreq1 =
      median(
        validAttempts.map(
          attempt =>
            attempt.freq1,
        ),
      );

    const aggregateFreq2 =
      median(
        validAttempts.map(
          attempt =>
            attempt.freq2,
        ),
      );

    const aggregateRatio =
      median(
        validAttempts.map(
          attempt =>
            attempt.detectedRatio,
        ),
      );

    const aggregateFirstClarity =
      validAttempts.reduce(
        (sum, attempt) =>
          sum +
          attempt.firstNoteClarity,
        0,
      ) /
      validAttempts.length;

    const aggregateSecondClarity =
      validAttempts.reduce(
        (sum, attempt) =>
          sum +
          attempt.secondNoteClarity,
        0,
      ) /
      validAttempts.length;

    return {
      freq1:
        aggregateFreq1,

      freq2:
        aggregateFreq2,

      detectedRatio:
        aggregateRatio,

      hasFirstNote: true,
      hasSecondNote: true,

      firstNoteClarity:
        aggregateFirstClarity,

      secondNoteClarity:
        aggregateSecondClarity,

      attempts,
    };
  } catch (error) {
    console.error(
      'Interval recognition measurement error:',
      error,
    );

    return emptyResult();
  }
}