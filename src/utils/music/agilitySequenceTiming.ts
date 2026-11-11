export function getAgilitySequenceDurationSeconds(
  noteCount: number,
  noteDurationSec: number,
  gapSec: number,
): number {
  if (
    !Number.isInteger(noteCount) ||
    noteCount <= 0 ||
    !Number.isFinite(noteDurationSec) ||
    noteDurationSec <= 0 ||
    !Number.isFinite(gapSec) ||
    gapSec < 0
  ) {
    return 0;
  }

  return (
    noteCount * noteDurationSec +
    Math.max(0, noteCount - 1) * gapSec
  );
}

export function getAgilitySequenceNoteIndex(
  elapsedSeconds: number,
  noteCount: number,
  noteDurationSec: number,
  gapSec: number,
  repeat = false,
): number | null {
  if (
    !Number.isFinite(elapsedSeconds) ||
    elapsedSeconds < 0 ||
    !Number.isInteger(noteCount) ||
    noteCount <= 0 ||
    !Number.isFinite(noteDurationSec) ||
    noteDurationSec <= 0 ||
    !Number.isFinite(gapSec) ||
    gapSec < 0
  ) {
    return null;
  }

  const intervalSec = noteDurationSec + gapSec;
  const sequenceDurationSec = repeat
    ? noteCount * intervalSec
    : getAgilitySequenceDurationSeconds(
        noteCount,
        noteDurationSec,
        gapSec,
      );

  if (sequenceDurationSec <= 0) {
    return null;
  }

  const sequenceTime = repeat
    ? elapsedSeconds % sequenceDurationSec
    : elapsedSeconds;

  if (!repeat && sequenceTime >= sequenceDurationSec) {
    return null;
  }

  const index = Math.floor(sequenceTime / intervalSec);

  if (index >= noteCount) {
    return null;
  }

  const timeWithinNote = sequenceTime - index * intervalSec;
  return timeWithinNote < noteDurationSec ? index : null;
}
