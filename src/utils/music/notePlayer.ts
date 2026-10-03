import { AudioContext } from "react-native-audio-api";

export interface NoteToPlay {
  frequencyHz: number;
  durationSec: number;
}

const PEAK_GAIN = 0.08;
const ATTACK_SEC = 0.05;
const RELEASE_SEC = 0.08;
const GAP_SEC = 0.12;

let audioContext: AudioContext | null = null;

async function getAudioContext(): Promise<AudioContext> {
  if (!audioContext) {
    audioContext = new AudioContext();
  }

  if (audioContext.state !== "running") {
    await audioContext.resume();
  }

  return audioContext;
}

export async function playSingleNote(
  frequencyHz: number,
  durationSec = 1.5
): Promise<void> {
  if (!Number.isFinite(frequencyHz) || frequencyHz <= 0) {
    throw new Error(`Invalid frequency: ${frequencyHz}`);
  }

  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new Error(`Invalid duration: ${durationSec}`);
  }

  const context = await getAudioContext();

  console.log("🔊 NOTE PLAYER");
  console.log("   frequency:", frequencyHz);
  console.log("   duration:", durationSec);
  console.log("   context:", context.state);

  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = "sine";
  oscillator.frequency.value = frequencyHz;

  oscillator.connect(gain);
  gain.connect(context.destination);

  const now = context.currentTime;
  const end = now + durationSec;

  const attackEnd = Math.min(
    now + ATTACK_SEC,
    end
  );

  const releaseStart = Math.max(
    attackEnd,
    end - RELEASE_SEC
  );

  gain.gain.setValueAtTime(0, now);

  gain.gain.linearRampToValueAtTime(
    PEAK_GAIN,
    attackEnd
  );

  gain.gain.setValueAtTime(
    PEAK_GAIN,
    releaseStart
  );

  gain.gain.linearRampToValueAtTime(
    0,
    end
  );

  oscillator.start(now);
  oscillator.stop(end);

  await new Promise<void>((resolve) => {
    setTimeout(
      resolve,
      durationSec * 1000 + 100
    );
  });

  console.log("   🎵 note finished");
}

export async function playNoteSequence(
  notes: NoteToPlay[]
): Promise<void> {
  if (!notes.length) return;

  for (const note of notes) {
    await playSingleNote(
      note.frequencyHz,
      note.durationSec
    );

    await new Promise<void>((resolve) => {
      setTimeout(resolve, GAP_SEC * 1000);
    });
  }
}

/**
 * Call this when the assessment screen is completely finished.
 */
export async function disposeNotePlayer(): Promise<void> {
  if (!audioContext) return;

  try {
    await audioContext.close();
  } catch (error) {
    console.warn(
      "⚠️ Failed to close note audio context:",
      error
    );
  } finally {
    audioContext = null;
  }
}