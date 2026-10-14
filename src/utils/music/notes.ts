export interface MusicalNote {
  name: string;
  frequency: number;
}

export interface VocalRange {
  lowHz: number;
  highHz: number;
}

type Tier = 'beginner' | 'intermediate' | 'advanced';

interface MidiBounds {
  minMidi: number;
  maxMidi: number;
}

export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function frequencyToMidi(frequency: number): number {
  return 69 + 12 * Math.log2(frequency / 440);
}

export function midiToNoteName(midi: number): string {
  const noteNames = [
    'C', 'C#', 'D', 'D#', 'E', 'F',
    'F#', 'G', 'G#', 'A', 'A#', 'B',
  ];

  const noteIndex = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;

  return `${noteNames[noteIndex]}${octave}`;
}

export function createMusicalNote(midi: number): MusicalNote {
  return {
    name: midiToNoteName(midi),
    frequency: midiToFrequency(midi),
  };
}

export function getVocalRangeMidiBounds(
  vocalRange?: VocalRange | null,
): { lowMidi: number; highMidi: number } | null {
  if (
    !vocalRange ||
    !Number.isFinite(vocalRange.lowHz) ||
    !Number.isFinite(vocalRange.highHz) ||
    vocalRange.lowHz <= 0 ||
    vocalRange.highHz <= vocalRange.lowHz
  ) {
    return null;
  }

  const lowMidi = Math.ceil(frequencyToMidi(vocalRange.lowHz));
  const highMidi = Math.floor(frequencyToMidi(vocalRange.highHz));

  if (
    !Number.isFinite(lowMidi) ||
    !Number.isFinite(highMidi) ||
    lowMidi > highMidi
  ) {
    return null;
  }

  return { lowMidi, highMidi };
}

function getTierMidiBounds(tier: Tier): MidiBounds {
  if (tier === 'intermediate') {
    return { minMidi: 57, maxMidi: 76 };
  }

  if (tier === 'advanced') {
    return { minMidi: 55, maxMidi: 79 };
  }

  return { minMidi: 60, maxMidi: 72 };
}

export function getPitchGenerationMidiBounds(
  tier: Tier,
  vocalRange?: VocalRange | null,
): MidiBounds {
  const tierBounds = getTierMidiBounds(tier);
  const detectedBounds = getVocalRangeMidiBounds(vocalRange);

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
    return { minMidi, maxMidi };
  }

  return {
    minMidi: detectedBounds.lowMidi,
    maxMidi: detectedBounds.highMidi,
  };
}

export function getRandomPitchNote(
  tier: Tier,
  vocalRange?: VocalRange | null,
): MusicalNote {
  const { minMidi, maxMidi } = getPitchGenerationMidiBounds(
    tier,
    vocalRange,
  );

  const midi =
    Math.floor(Math.random() * (maxMidi - minMidi + 1)) +
    minMidi;

  return createMusicalNote(midi);
}

export function getRandomScale(
  tier: Tier,
  noteCount: number,
  vocalRange?: VocalRange | null,
): MusicalNote[] {
  const scaleIntervals = [0, 2, 4, 5, 7, 9, 11, 12];
  const intervals = scaleIntervals.slice(
    0,
    Math.min(noteCount, scaleIntervals.length),
  );

  if (intervals.length === 0) {
    return [];
  }

  const { minMidi, maxMidi } = getPitchGenerationMidiBounds(
    tier,
    vocalRange,
  );

  const maxInterval = intervals[intervals.length - 1];
  const rootMin = minMidi;
  const rootMax = maxMidi - maxInterval;

  if (rootMax < rootMin) {
    const availableIntervals = intervals.filter(
      offset => minMidi + offset <= maxMidi,
    );

    if (availableIntervals.length === 0) {
      return [createMusicalNote(minMidi)];
    }

    const rootMidi =
      Math.floor(Math.random() * (maxMidi - minMidi + 1)) +
      minMidi;

    return availableIntervals.map(offset =>
      createMusicalNote(Math.min(rootMidi + offset, maxMidi)),
    );
  }

  const rootMidi =
    Math.floor(Math.random() * (rootMax - rootMin + 1)) +
    rootMin;

  return intervals.map(offset =>
    createMusicalNote(rootMidi + offset),
  );
}

export function getRandomIntervalNotes(
  tier: Tier,
  intervalSemitones: number,
  vocalRange?: VocalRange | null,
): [MusicalNote, MusicalNote] {
  const { minMidi, maxMidi } = getPitchGenerationMidiBounds(
    tier,
    vocalRange,
  );

  const safeInterval = Math.max(
    1,
    Math.round(Math.abs(intervalSemitones)),
  );

  const rootMax = maxMidi - safeInterval;

  if (rootMax < minMidi) {
    const rootMidi = minMidi;
    const secondMidi = Math.min(
      rootMidi + safeInterval,
      maxMidi,
    );

    return [
      createMusicalNote(rootMidi),
      createMusicalNote(secondMidi),
    ];
  }

  const rootMidi =
    Math.floor(Math.random() * (rootMax - minMidi + 1)) +
    minMidi;

  return [
    createMusicalNote(rootMidi),
    createMusicalNote(rootMidi + safeInterval),
  ];
}

export function frequencyToNoteName(frequency: number): string {
  if (!Number.isFinite(frequency) || frequency <= 0) {
    return '--';
  }

  return midiToNoteName(Math.round(frequencyToMidi(frequency)));
}