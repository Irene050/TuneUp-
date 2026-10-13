import { AudioContext } from 'react-native-audio-api';

export interface NoteToPlay {
  frequencyHz: number;
  durationSec: number;
}

const PEAK_GAIN = 0.25;
const ATTACK_SEC = 0.03;
const RELEASE_SEC = 0.08;
const GAP_SEC = 0.12;

let audioContext: AudioContext | null = null;

async function getAudioContext(): Promise<AudioContext> {
  if (!audioContext || audioContext.state === 'closed') {
    audioContext = new AudioContext();
  }

  if (audioContext.state !== 'running') {
    await audioContext.resume();
  }

  if (audioContext.state !== 'running') {
    throw new Error(
      `AudioContext could not be started. Current state: ${audioContext.state}`,
    );
  }

  return audioContext;
}

export async function playSingleNote(
  frequencyHz: number,
  durationSec = 1.5,
): Promise<void> {
  if (!Number.isFinite(frequencyHz) || frequencyHz <= 0) {
    throw new Error(`Invalid frequency: ${frequencyHz}`);
  }

  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new Error(`Invalid duration: ${durationSec}`);
  }

  const context = await getAudioContext();

  console.log('🔊 NOTE PLAYER');
  console.log('   frequency:', frequencyHz);
  console.log('   duration:', durationSec);
  console.log('   context:', context.state);
  console.log('   sampleRate:', context.sampleRate);

  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = 'sine';
  oscillator.frequency.value = frequencyHz;

  oscillator.connect(gain);
  gain.connect(context.destination);

  const startTime = context.currentTime + 0.01;
  const endTime = startTime + durationSec;
  const attackEnd = Math.min(startTime + ATTACK_SEC, endTime);
  const releaseStart = Math.max(attackEnd, endTime - RELEASE_SEC);

  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(PEAK_GAIN, attackEnd);
  gain.gain.setValueAtTime(PEAK_GAIN, releaseStart);
  gain.gain.linearRampToValueAtTime(0, endTime);

  oscillator.start(startTime);
  oscillator.stop(endTime);

  console.log('✅ Note playback started');

  await new Promise<void>(resolve => {
    setTimeout(resolve, durationSec * 1000 + 100);
  });

  console.log('⏹️ Note playback finished');
}

export async function playNoteSequence(
  notes: NoteToPlay[],
  gapSec = GAP_SEC,
): Promise<void> {
  if (notes.length === 0) return;

  if (!Number.isFinite(gapSec) || gapSec < 0) {
    throw new Error(`Invalid note gap: ${gapSec}`);
  }

  console.log('🎼 NOTE SEQUENCE STARTED', {
    noteCount: notes.length,
    gapSec,
  });

  for (let index = 0; index < notes.length; index++) {
    const note = notes[index];

    console.log(`🎵 Playing note ${index + 1}/${notes.length}`);

    await playSingleNote(note.frequencyHz, note.durationSec);

    if (index < notes.length - 1 && gapSec > 0) {
      await new Promise<void>(resolve => {
        setTimeout(resolve, gapSec * 1000);
      });
    }
  }

  console.log('✅ NOTE SEQUENCE FINISHED');
}

export async function disposeNotePlayer(): Promise<void> {
  if (!audioContext) return;

  try {
    await audioContext.close();
    console.log('🔇 Note player AudioContext closed');
  } catch (error) {
    console.warn('Failed to close note audio context:', error);
  } finally {
    audioContext = null;
  }
}