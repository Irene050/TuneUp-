import { frequencyToMidi } from '@/utils/music/notes';

export type VoiceClassification =
  | 'Soprano'
  | 'Alto'
  | 'Tenor'
  | 'Bass';

const VOICE_CLASSIFICATION_RANGES: {
  type: VoiceClassification;
  lowMidi: number;
  highMidi: number;
}[] = [
  {
    type: 'Soprano',
    lowMidi: 60,
    highMidi: 84,
  },
  {
    type: 'Alto',
    lowMidi: 53,
    highMidi: 77,
  },
  {
    type: 'Tenor',
    lowMidi: 48,
    highMidi: 72,
  },
  {
    type: 'Bass',
    lowMidi: 40,
    highMidi: 64,
  },
];

export function classifyVoice(
  lowHz: number,
  highHz: number,
): VoiceClassification {
  const detectedLow = frequencyToMidi(lowHz);
  const detectedHigh = frequencyToMidi(highHz);

  let bestClassification: VoiceClassification = 'Soprano';
  let greatestOverlap = -1;
  let smallestDistance = Infinity;

  for (const range of VOICE_CLASSIFICATION_RANGES) {
    const overlap = Math.max(
      0,
      Math.min(detectedHigh, range.highMidi) -
        Math.max(detectedLow, range.lowMidi),
    );

    const distance =
      Math.pow(detectedLow - range.lowMidi, 2) +
      Math.pow(detectedHigh - range.highMidi, 2);

    if (
      overlap > greatestOverlap ||
      (overlap === greatestOverlap && distance < smallestDistance)
    ) {
      greatestOverlap = overlap;
      smallestDistance = distance;
      bestClassification = range.type;
    }
  }

  return bestClassification;
}
