export interface MusicalNote {
  name: string;
  frequency: number;
}


/**
 * Convert a MIDI note number to frequency.
 *
 * A4 (MIDI 69) = 440 Hz.
 */
export function midiToFrequency(
  midi: number
): number {
  return (
    440 *
    Math.pow(
      2,
      (midi - 69) / 12
    )
  );
}


/**
 * Convert MIDI number to note name.
 */
export function midiToNoteName(
  midi: number
): string {

  const noteNames = [
    'C',
    'C#',
    'D',
    'D#',
    'E',
    'F',
    'F#',
    'G',
    'G#',
    'A',
    'A#',
    'B',
  ];

  const noteIndex =
    ((midi % 12) + 12) % 12;

  const octave =
    Math.floor(midi / 12) - 1;

  return `${noteNames[noteIndex]}${octave}`;
}


/**
 * Create a musical note from a MIDI number.
 */
export function createMusicalNote(
  midi: number
): MusicalNote {

  return {
    name:
      midiToNoteName(midi),

    frequency:
      midiToFrequency(midi),
  };
}


/**
 * Generate a random comfortable singing note.
 *
 * Current range:
 *
 * C4 → C5
 *
 * This is intentionally limited so that
 * beginner users aren't immediately given
 * extreme notes.
 */
export function getRandomPitchNote(
  tier:
    | 'beginner'
    | 'intermediate'
    | 'advanced'
): MusicalNote {

  let minMidi = 60;
  let maxMidi = 72;


  if (tier === 'intermediate') {
    minMidi = 57;
    maxMidi = 76;
  }


  if (tier === 'advanced') {
    minMidi = 55;
    maxMidi = 79;
  }


  const midi =
    Math.floor(
      Math.random() *
        (maxMidi - minMidi + 1)
    ) +
    minMidi;


  return createMusicalNote(
    midi
  );
}

/**
 * Convert frequency to the nearest musical note name.
 *
 * Example:
 * 440 Hz → A4
 * 261.63 Hz → C4
 */
export function frequencyToNoteName(
  frequency: number
): string {
  if (
    !Number.isFinite(frequency) ||
    frequency <= 0
  ) {
    return '--';
  }

  const midi = Math.round(
    69 +
      12 *
        Math.log2(
          frequency / 440
        )
  );

  return midiToNoteName(midi);
}