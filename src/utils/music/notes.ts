export interface MusicalNote {
  name: string;
  frequency: number;
}

export interface VocalRange {
  lowHz: number;
  highHz: number;
}

/**
 * Convert a MIDI note number to frequency.
 *
 * A4 (MIDI 69) = 440 Hz.
 */
export function midiToFrequency(
  midi: number,
): number {
  return (
    440 *
    Math.pow(
      2,
      (midi - 69) / 12,
    )
  );
}

/**
 * Convert frequency to MIDI.
 */
export function frequencyToMidi(
  frequency: number,
): number {
  return (
    69 +
    12 *
      Math.log2(
        frequency / 440,
      )
  );
}

/**
 * Convert MIDI number to note name.
 */
export function midiToNoteName(
  midi: number,
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
  midi: number,
): MusicalNote {
  return {
    name: midiToNoteName(midi),
    frequency: midiToFrequency(midi),
  };
}

/**
 * Get the usable MIDI boundaries for a detected vocal range.
 *
 * Notes are rounded inward so generated notes remain inside
 * the actual detected frequency range.
 */
export function getVocalRangeMidiBounds(
  vocalRange?: VocalRange | null,
): {
  lowMidi: number;
  highMidi: number;
} | null {
  if (
    !vocalRange ||
    !Number.isFinite(vocalRange.lowHz) ||
    !Number.isFinite(vocalRange.highHz) ||
    vocalRange.lowHz <= 0 ||
    vocalRange.highHz <= vocalRange.lowHz
  ) {
    return null;
  }

  const lowMidi = Math.ceil(
    frequencyToMidi(
      vocalRange.lowHz,
    ),
  );

  const highMidi = Math.floor(
    frequencyToMidi(
      vocalRange.highHz,
    ),
  );

  if (
    !Number.isFinite(lowMidi) ||
    !Number.isFinite(highMidi) ||
    lowMidi > highMidi
  ) {
    return null;
  }

  return {
    lowMidi,
    highMidi,
  };
}

/**
 * Get the default pitch range for an ADS tier.
 *
 * ADS controls difficulty. These defaults are only used when
 * no detected vocal range is available.
 */
function getTierMidiBounds(
  tier:
    | 'beginner'
    | 'intermediate'
    | 'advanced',
): {
  minMidi: number;
  maxMidi: number;
} {
  if (tier === 'intermediate') {
    return {
      minMidi: 57,
      maxMidi: 76,
    };
  }

  if (tier === 'advanced') {
    return {
      minMidi: 55,
      maxMidi: 79,
    };
  }

  return {
    minMidi: 60,
    maxMidi: 72,
  };
}

/**
 * Get the usable MIDI range for an exercise.
 *
 * When an assessment range exists, it becomes the basis for
 * target-note selection. The tier range is used only as a
 * secondary safety limit.
 *
 * If the two ranges do not overlap, the detected vocal range
 * takes priority because it represents the singer's assessed range.
 */
export function getPitchGenerationMidiBounds(
  tier:
    | 'beginner'
    | 'intermediate'
    | 'advanced',
  vocalRange?: VocalRange | null,
): {
  minMidi: number;
  maxMidi: number;
} {
  const tierBounds =
    getTierMidiBounds(tier);

  const detectedBounds =
    getVocalRangeMidiBounds(
      vocalRange,
    );

  if (!detectedBounds) {
    return tierBounds;
  }

  const minMidi = Math.max(
    tierBounds.minMidi,
    detectedBounds.lowMidi,
  );

  const maxMidi = Math.min(
    tierBounds.maxMidi,
    detectedBounds.highMidi,
  );

  if (minMidi <= maxMidi) {
    return {
      minMidi,
      maxMidi,
    };
  }

  // The assessed vocal range is authoritative when it does not
  // overlap the tier's default range.
  return {
    minMidi: detectedBounds.lowMidi,
    maxMidi: detectedBounds.highMidi,
  };
}

/**
 * Generate a random pitch note inside the singer's detected
 * vocal range.
 */
export function getRandomPitchNote(
  tier:
    | 'beginner'
    | 'intermediate'
    | 'advanced',
  vocalRange?: VocalRange | null,
): MusicalNote {
  const {
    minMidi,
    maxMidi,
  } =
    getPitchGenerationMidiBounds(
      tier,
      vocalRange,
    );

  const midi =
    Math.floor(
      Math.random() *
        (maxMidi - minMidi + 1),
    ) +
    minMidi;

  return createMusicalNote(
    midi,
  );
}

/**
 * Generate a scale whose notes all remain inside the
 * detected vocal range.
 */
export function getRandomScale(
  tier:
    | 'beginner'
    | 'intermediate'
    | 'advanced',
  noteCount: number,
  vocalRange?: VocalRange | null,
): MusicalNote[] {
  const scaleIntervals = [
    0,
    2,
    4,
    5,
    7,
    9,
    11,
    12,
  ];

  const intervals =
    scaleIntervals.slice(
      0,
      Math.min(
        noteCount,
        scaleIntervals.length,
      ),
    );

  if (intervals.length === 0) {
    return [];
  }

  const {
    minMidi,
    maxMidi,
  } =
    getPitchGenerationMidiBounds(
      tier,
      vocalRange,
    );

  const maxInterval =
    intervals[intervals.length - 1];

  let rootMin = minMidi;
  let rootMax =
    maxMidi - maxInterval;

  /*
   * If the assessed range is narrower than the complete
   * requested scale, use the largest possible scale starting
   * inside the range.
   */
  if (rootMax < rootMin) {
    const availableIntervals =
      intervals.filter(
        offset =>
          minMidi + offset <=
          maxMidi,
      );

    if (
      availableIntervals.length === 0
    ) {
      return [
        createMusicalNote(minMidi),
      ];
    }

    const rootMidi =
      Math.floor(
        Math.random() *
          (maxMidi - minMidi + 1),
      ) + minMidi;

    return availableIntervals.map(
      offset => {
        const midi = Math.min(
          rootMidi + offset,
          maxMidi,
        );

        return createMusicalNote(
          midi,
        );
      },
    );
  }

  const rootMidi =
    Math.floor(
      Math.random() *
        (rootMax - rootMin + 1),
    ) +
    rootMin;

  return intervals.map(
    offset =>
      createMusicalNote(
        rootMidi + offset,
      ),
  );
}

/**
 * Generate two notes separated by a specified interval,
 * with both notes inside the detected vocal range.
 */
export function getRandomIntervalNotes(
  tier:
    | 'beginner'
    | 'intermediate'
    | 'advanced',
  intervalSemitones: number,
  vocalRange?: VocalRange | null,
): [MusicalNote, MusicalNote] {
  const {
    minMidi,
    maxMidi,
  } =
    getPitchGenerationMidiBounds(
      tier,
      vocalRange,
    );

  const safeInterval =
    Math.max(
      1,
      Math.round(
        Math.abs(
          intervalSemitones,
        ),
      ),
    );

  const rootMax =
    maxMidi - safeInterval;

  if (rootMax < minMidi) {
    const rootMidi =
      minMidi;

    const secondMidi =
      Math.min(
        rootMidi + safeInterval,
        maxMidi,
      );

    return [
      createMusicalNote(
        rootMidi,
      ),
      createMusicalNote(
        secondMidi,
      ),
    ];
  }

  const rootMidi =
    Math.floor(
      Math.random() *
        (rootMax - minMidi + 1),
    ) +
    minMidi;

  return [
    createMusicalNote(
      rootMidi,
    ),
    createMusicalNote(
      rootMidi +
        safeInterval,
    ),
  ];
}

/**
 * Convert frequency to the nearest musical note name.
 *
 * Example:
 * 440 Hz → A4
 * 261.63 Hz → C4
 */
export function frequencyToNoteName(
  frequency: number,
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
          frequency / 440,
        ),
  );

  return midiToNoteName(
    midi,
  );
}