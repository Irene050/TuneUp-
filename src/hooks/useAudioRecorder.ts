import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  AudioManager,
  AudioRecorder,
} from 'react-native-audio-api';

import { analyzePitchFrame } from '@/utils/dsp/pitch';
import {
  calcRMS,
  rmsToDb,
} from '@/utils/dsp/rms';

const DEFAULT_SAMPLE_RATE = 44100;
const BUFFER_LENGTH = 2048;
const CHANNEL_COUNT = 1;
const LIVE_ANALYSIS_INTERVAL_MS = 50;
const MIN_VOICED_DB = -45;
const MIN_PITCH_HZ = 60;
const MAX_PITCH_HZ = 1500;
const MIN_PITCH_CLARITY = 0.70;
const LIVE_DROPOUT_TOLERANCE_MS = 250;

const OCTAVE_JUMP_CENTS = 1200;
const OCTAVE_TOLERANCE_CENTS = 100;
const OCTAVE_CONFIRMATION_FRAMES = 3;

function centsBetween(
  frequencyA: number,
  frequencyB: number,
): number {
  if (
    !Number.isFinite(frequencyA) ||
    !Number.isFinite(frequencyB) ||
    frequencyA <= 0 ||
    frequencyB <= 0
  ) {
    return Infinity;
  }

  return 1200 * Math.log2(frequencyA / frequencyB);
}

interface UseAudioRecorderOptions {
  onFrame?: (frame: LiveAudioFrame) => void;
  onStop?: (
    samples: Float32Array,
    sampleRate: number,
  ) => void;
}

export interface LiveAudioFrame {
  pitch: number;
  note: string;
  clarity: number;
  volume: number;
  samples: Float32Array;
  sampleRate: number;
}

function calculatePeak(samples: Float32Array): number {
  let peak = 0;

  for (let i = 0; i < samples.length; i++) {
    const value = samples[i];

    if (!Number.isFinite(value)) continue;

    peak = Math.max(peak, Math.abs(value));
  }

  return peak;
}

function calculateDCOffset(samples: Float32Array): number {
  if (samples.length === 0) return 0;

  let sum = 0;
  let count = 0;

  for (let i = 0; i < samples.length; i++) {
    const value = samples[i];

    if (!Number.isFinite(value)) continue;

    sum += value;
    count++;
  }

  return count > 0 ? sum / count : 0;
}

interface LiveSignalMetrics {
  rms: number;
  db: number;
  peak: number;
}

/**
 * Calculates only the signal metrics needed during live recording.
 * More expensive diagnostics are calculated after recording stops.
 */
function analyzeLiveSignal(
  samples: Float32Array,
): LiveSignalMetrics {
  const rms = calcRMS(samples);

  return {
    rms,
    db: rmsToDb(rms),
    peak: calculatePeak(samples),
  };
}

function analyzeAudioSignal(
  samples: Float32Array,
  sampleRate: number,
) {
  let finiteSamples = 0;
  let zeroSamples = 0;

  for (let i = 0; i < samples.length; i++) {
    const value = samples[i];

    if (!Number.isFinite(value)) continue;

    finiteSamples++;

    if (value === 0) {
      zeroSamples++;
    }
  }

  const rms = calcRMS(samples);
  const db = rmsToDb(rms);
  const peak = calculatePeak(samples);
  const dcOffset = calculateDCOffset(samples);

  return {
    sampleRate,
    length: samples.length,
    finiteSamples,
    zeroSamples,
    rms,
    db,
    peak,
    dcOffset,
  };
}

/**
 * Appends incoming samples to a rolling buffer and retains
 * only the most recent maxLength samples.
 */
function appendToRollingBuffer(
  previousSamples: Float32Array,
  incomingSamples: Float32Array,
  maxLength: number,
): Float32Array {
  if (incomingSamples.length >= maxLength) {
    return incomingSamples.slice(
      incomingSamples.length - maxLength,
    );
  }

  const combinedLength =
    previousSamples.length + incomingSamples.length;

  if (combinedLength <= maxLength) {
    const combined = new Float32Array(combinedLength);

    combined.set(previousSamples);
    combined.set(incomingSamples, previousSamples.length);

    return combined;
  }

  const previousSamplesToKeep =
    maxLength - incomingSamples.length;

  const combined = new Float32Array(maxLength);

  combined.set(
    previousSamples.subarray(
      previousSamples.length - previousSamplesToKeep,
    ),
  );

  combined.set(
    incomingSamples,
    previousSamplesToKeep,
  );

  return combined;
}

export function useAudioRecorder(
  options: UseAudioRecorderOptions = {},
) {
  const [isRecording, setIsRecording] = useState(false);

  const onFrameRef =
    useRef<UseAudioRecorderOptions['onFrame']>(
      options.onFrame,
    );

  const onStopRef =
    useRef<UseAudioRecorderOptions['onStop']>(
      options.onStop,
    );

  useEffect(() => {
    onFrameRef.current = options.onFrame;
  }, [options.onFrame]);

  useEffect(() => {
    onStopRef.current = options.onStop;
  }, [options.onStop]);

  const recorderRef = useRef<AudioRecorder | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const sampleCountRef = useRef(0);
  const lastLiveAnalysisRef = useRef(0);
  const sessionActiveRef = useRef(false);

  // Keeps enough recent audio for pitch analysis even when
  // an individual audio callback contains fewer than 2048 samples.
  const pitchBufferRef = useRef<Float32Array>(
    new Float32Array(0),
  );

  const pendingOctavePitchRef = useRef<number | null>(null);
  const pendingOctaveCountRef = useRef(0);

  const startingRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const discardOnStopRef = useRef(false);

  const startTaskRef = useRef<Promise<void> | null>(null);
  const stopTaskRef = useRef<Promise<void> | null>(null);

  const lastValidPitchRef = useRef(0);
  const lastValidNoteRef = useRef('--');
  const lastValidClarityRef = useRef(0);
  const lastValidPitchTimeRef = useRef(0);

  const resetLiveDetection = useCallback(() => {
    lastValidPitchRef.current = 0;
    lastValidNoteRef.current = '--';
    lastValidClarityRef.current = 0;
    lastValidPitchTimeRef.current = 0;

    pendingOctavePitchRef.current = null;
    pendingOctaveCountRef.current = 0;

    pitchBufferRef.current = new Float32Array(0);
  }, []);

  const emitLiveFrame = useCallback(
    (frame: LiveAudioFrame) => {
      if (stopRequestedRef.current) return;

      try {
        onFrameRef.current?.(frame);
      } catch (error) {
        console.error(
          'Live frame callback error:',
          error,
        );
      }
    },
    [],
  );

  const startRecording = useCallback((): Promise<void> => {
    if (
      startingRef.current ||
      recorderRef.current ||
      startTaskRef.current ||
      stopTaskRef.current
    ) {
      console.warn(
        'Recorder is already active, starting, or stopping.',
      );

      return Promise.resolve();
    }

    startingRef.current = true;

    console.log(
      '[AudioRecorder] 🎙️ RECORDER STARTING',
      new Date().toISOString(),
    );

    stopRequestedRef.current = false;
    discardOnStopRef.current = false;

    const startTask = (async () => {
      let recorder: AudioRecorder | null = null;

      try {
        const permission =
          await AudioManager.requestRecordingPermissions();

        if (stopRequestedRef.current) return;

        if (permission !== 'Granted') {
          throw new Error(
            'Microphone permission was not granted.',
          );
        }

        try {
          AudioManager.setAudioSessionOptions({
            iosCategory: 'record',
            iosMode: 'default',
            iosOptions: [],
          });
        } catch (error) {
          console.warn(
            'Failed to configure audio session:',
            error,
          );
        }

        if (stopRequestedRef.current) return;

        chunksRef.current = [];
        sampleCountRef.current = 0;
        lastLiveAnalysisRef.current = 0;

        resetLiveDetection();

        recorder = new AudioRecorder({
          androidInputPreset: 'voiceRecognition',
        });

        recorder.onError((error) => {
          console.error('Audio recorder error:', error);
        });

        recorder.onAudioReady(
          {
            sampleRate: DEFAULT_SAMPLE_RATE,
            bufferLength: BUFFER_LENGTH,
            channelCount: CHANNEL_COUNT,
          },
          ({ buffer, numFrames }) => {
            try {
              if (
                stopRequestedRef.current ||
                recorderRef.current !== recorder
              ) {
                return;
              }

              const channelData = buffer.getChannelData(0);

              if (!channelData) {
                console.warn('No channel 0 data received.');
                return;
              }

              const frameLength = Math.min(
                Math.max(0, numFrames),
                channelData.length,
              );

              if (frameLength === 0) return;

              // Copy the current callback samples so they remain
              // independent of the audio API's reusable buffer.
              const samples = new Float32Array(frameLength);

              samples.set(
                channelData.subarray(0, frameLength),
              );

              // Preserve every received chunk for final analysis.
              chunksRef.current.push(samples);
              sampleCountRef.current += samples.length;

              // Update the rolling pitch buffer on every callback,
              // not only when live analysis is due.
              pitchBufferRef.current = appendToRollingBuffer(
                pitchBufferRef.current,
                samples,
                BUFFER_LENGTH,
              );

              const signal = analyzeLiveSignal(samples);

              const now = Date.now();

              if (
                now - lastLiveAnalysisRef.current <
                LIVE_ANALYSIS_INTERVAL_MS
              ) {
                return;
              }

              lastLiveAnalysisRef.current = now;

              const emitInvalidFrame = () => {
                const timeSinceLastValidPitch =
                  lastValidPitchTimeRef.current > 0
                    ? now - lastValidPitchTimeRef.current
                    : Infinity;

                if (
                  lastValidPitchRef.current > 0 &&
                  timeSinceLastValidPitch <
                    LIVE_DROPOUT_TOLERANCE_MS
                ) {
                  emitLiveFrame({
                    pitch: lastValidPitchRef.current,
                    note: lastValidNoteRef.current,
                    clarity: lastValidClarityRef.current,
                    volume: signal.db,
                    samples,
                    sampleRate: DEFAULT_SAMPLE_RATE,
                  });

                  return;
                }

                emitLiveFrame({
                  pitch: 0,
                  note: '--',
                  clarity: 0,
                  volume: signal.db,
                  samples,
                  sampleRate: DEFAULT_SAMPLE_RATE,
                });
              };

              const signalIsQuiet =
                !Number.isFinite(signal.db) ||
                signal.db < MIN_VOICED_DB ||
                signal.peak <= 0;

              if (signalIsQuiet) {
                pendingOctavePitchRef.current = null;
                pendingOctaveCountRef.current = 0;

                emitInvalidFrame();
                return;
              }

              // Pitch analysis requires a complete 2048-sample frame.
              // If there is not enough audio yet, wait for more samples.
              if (
                pitchBufferRef.current.length < BUFFER_LENGTH
              ) {
                pendingOctavePitchRef.current = null;
                pendingOctaveCountRef.current = 0;

                emitInvalidFrame();
                return;
              }

              let pitchResult: ReturnType<
                typeof analyzePitchFrame
              >;

              try {
                pitchResult = analyzePitchFrame(
                  pitchBufferRef.current,
                  DEFAULT_SAMPLE_RATE,
                );
              } catch (error) {
                console.warn(
                  'Live pitch analysis failed:',
                  error,
                );

                pitchResult = {
                  frequency: 0,
                  note: '--',
                  clarity: 0,
                };
              }

              const detectedPitch = pitchResult.frequency;
              const detectedNote = pitchResult.note;
              const detectedClarity = pitchResult.clarity;

              const validVolume =
                Number.isFinite(signal.db) &&
                signal.db >= MIN_VOICED_DB &&
                signal.peak > 0;

              const validPitch =
                Number.isFinite(detectedPitch) &&
                detectedPitch >= MIN_PITCH_HZ &&
                detectedPitch <= MAX_PITCH_HZ;

              const validClarity =
                Number.isFinite(detectedClarity) &&
                detectedClarity >= MIN_PITCH_CLARITY;

              const validNote =
                typeof detectedNote === 'string' &&
                detectedNote !== '--' &&
                detectedNote.length > 0;

              if (
                !validVolume ||
                !validPitch ||
                !validClarity ||
                !validNote
              ) {
                pendingOctavePitchRef.current = null;
                pendingOctaveCountRef.current = 0;

                emitInvalidFrame();
                return;
              }

              const previousPitch = lastValidPitchRef.current;

              if (previousPitch > 0) {
                const pitchDifferenceCents = Math.abs(
                  centsBetween(
                    detectedPitch,
                    previousPitch,
                  ),
                );

                const isOctaveJump =
                  Math.abs(
                    pitchDifferenceCents - OCTAVE_JUMP_CENTS,
                  ) <= OCTAVE_TOLERANCE_CENTS;

                if (isOctaveJump) {
                  const pendingPitch =
                    pendingOctavePitchRef.current;

                  const matchesPendingPitch =
                    pendingPitch !== null &&
                    Math.abs(
                      centsBetween(
                        detectedPitch,
                        pendingPitch,
                      ),
                    ) <= OCTAVE_TOLERANCE_CENTS;

                  if (matchesPendingPitch) {
                    pendingOctaveCountRef.current += 1;
                  } else {
                    pendingOctavePitchRef.current =
                      detectedPitch;

                    pendingOctaveCountRef.current = 1;
                  }

                  console.warn(
                    '[Pitch Tracking] Possible octave jump',
                    {
                      previousPitchHz: Number(
                        previousPitch.toFixed(2),
                      ),
                      detectedPitchHz: Number(
                        detectedPitch.toFixed(2),
                      ),
                      differenceCents: Number(
                        pitchDifferenceCents.toFixed(1),
                      ),
                      confirmationCount:
                        pendingOctaveCountRef.current,
                    },
                  );

                  if (
                    pendingOctaveCountRef.current <
                    OCTAVE_CONFIRMATION_FRAMES
                  ) {
                    emitInvalidFrame();
                    return;
                  }
                }
              }

              pendingOctavePitchRef.current = null;
              pendingOctaveCountRef.current = 0;

              lastValidPitchRef.current = detectedPitch;
              lastValidNoteRef.current = detectedNote;
              lastValidClarityRef.current = detectedClarity;
              lastValidPitchTimeRef.current = now;

              emitLiveFrame({
                pitch: detectedPitch,
                note: detectedNote,
                clarity: detectedClarity,
                volume: signal.db,
                samples,
                sampleRate: DEFAULT_SAMPLE_RATE,
              });
            } catch (error) {
              console.error(
                'Audio callback error:',
                error,
              );
            }
          },
        );

        if (stopRequestedRef.current) {
          recorder.clearOnAudioReady();
          return;
        }

        await AudioManager.setAudioSessionActivity(true);
        sessionActiveRef.current = true;

        if (stopRequestedRef.current) {
          recorder.clearOnAudioReady();

          await AudioManager.setAudioSessionActivity(false);
          sessionActiveRef.current = false;

          return;
        }

        recorderRef.current = recorder;

        const result = await recorder.start();

        if (result && result.status === 'error') {
          throw new Error(result.message);
        }

        if (!stopRequestedRef.current) {
          setIsRecording(true);

          console.log(
            '[AudioRecorder] ✅ RECORDER STARTED SUCCESSFULLY',
            new Date().toISOString(),
          );
        }
      } catch (error) {
        console.error(
          '[AudioRecorder] ❌ RECORDER START FAILED',
          error,
          new Date().toISOString(),
        );

        if (recorder) {
          try {
            recorder.clearOnAudioReady();
          } catch {
            // Continue resource cleanup.
          }

          if (recorderRef.current === recorder) {
            recorderRef.current = null;
          }

          try {
            await recorder.stop();
          } catch {
            // The recorder may not have started.
          }
        }

        if (sessionActiveRef.current) {
          try {
            await AudioManager.setAudioSessionActivity(false);
          } catch (cleanupError) {
            console.warn(
              'Failed to clean up audio session:',
              cleanupError,
            );
          }

          sessionActiveRef.current = false;
        }

        chunksRef.current = [];
        sampleCountRef.current = 0;
        lastLiveAnalysisRef.current = 0;

        resetLiveDetection();
        setIsRecording(false);

        if (!stopRequestedRef.current) {
          throw error;
        }
      } finally {
        startingRef.current = false;
      }
    })();

    startTaskRef.current = startTask;

    const clearStartTask = () => {
      if (startTaskRef.current === startTask) {
        startTaskRef.current = null;
      }
    };

    void startTask.then(clearStartTask, clearStartTask);

    return startTask;
  }, [resetLiveDetection, emitLiveFrame]);

  const stopRecording = useCallback((): Promise<void> => {
    stopRequestedRef.current = true;

    if (stopTaskRef.current) {
      return stopTaskRef.current;
    }

    console.log(
      '[AudioRecorder] ⏹️ RECORDER STOPPING',
      new Date().toISOString(),
    );

    let stopTask: Promise<void>;

    stopTask = Promise.resolve().then(async () => {
      try {
        const pendingStart = startTaskRef.current;

        if (pendingStart) {
          try {
            await pendingStart;
          } catch {
            // Startup handles its own cleanup.
          }
        }

        const recorder = recorderRef.current;

        if (recorder) {
          try {
            await recorder.stop();

            console.log(
              '[AudioRecorder] ✅ RECORDER STOPPED SUCCESSFULLY',
              new Date().toISOString(),
            );
          } catch (error) {
            console.error(
              '[AudioRecorder] ❌ FAILED TO STOP RECORDER',
              error,
            );
          }

          try {
            recorder.clearOnAudioReady();
          } catch (error) {
            console.warn(
              'Failed to clear audio callback:',
              error,
            );
          }
        }

        if (sessionActiveRef.current) {
          try {
            await AudioManager.setAudioSessionActivity(false);
          } catch (error) {
            console.warn(
              'Failed to deactivate audio session:',
              error,
            );
          }

          sessionActiveRef.current = false;
        }

        const chunks = chunksRef.current;
        const totalSamples = sampleCountRef.current;
        const shouldDiscard = discardOnStopRef.current;

        recorderRef.current = null;
        chunksRef.current = [];
        sampleCountRef.current = 0;
        lastLiveAnalysisRef.current = 0;

        console.log(
          '[AudioRecorder] 🧹 RECORDER CLEANUP COMPLETE',
          {
            recorderExists: !!recorderRef.current,
            audioSessionActive: sessionActiveRef.current,
            timestamp: new Date().toISOString(),
          },
        );

        resetLiveDetection();
        setIsRecording(false);

        if (!recorder || shouldDiscard) {
          return;
        }

        const fullBuffer = new Float32Array(totalSamples);
        let offset = 0;

        for (const chunk of chunks) {
          fullBuffer.set(chunk, offset);
          offset += chunk.length;
        }

        const finalSignal = analyzeAudioSignal(
          fullBuffer,
          DEFAULT_SAMPLE_RATE,
        );

        const durationSeconds =
          fullBuffer.length / DEFAULT_SAMPLE_RATE;

        console.log(
          '[AudioRecorder] Recording summary',
          {
            sampleRate: DEFAULT_SAMPLE_RATE,
            durationSeconds: Number(
              durationSeconds.toFixed(2),
            ),
            sampleCount: fullBuffer.length,
            rms: Number(finalSignal.rms.toFixed(4)),
            volumeDb: Number.isFinite(finalSignal.db)
              ? Number(finalSignal.db.toFixed(2))
              : finalSignal.db,
            peak: Number(finalSignal.peak.toFixed(4)),
            dcOffset: Number(
              finalSignal.dcOffset.toFixed(4),
            ),
          },
        );

        try {
          onStopRef.current?.(
            fullBuffer,
            DEFAULT_SAMPLE_RATE,
          );
        } catch (error) {
          console.error(
            'onStop callback error:',
            error,
          );
        }
      } finally {
        if (stopTaskRef.current === stopTask) {
          stopTaskRef.current = null;
          stopRequestedRef.current = false;
          discardOnStopRef.current = false;
        }
      }
    });

    stopTaskRef.current = stopTask;

    return stopTask;
  }, [resetLiveDetection]);

  const cancelRecording = useCallback((): Promise<void> => {
    discardOnStopRef.current = true;
    stopRequestedRef.current = true;

    return stopRecording();
  }, [stopRecording]);

  useEffect(() => {
    return () => {
      discardOnStopRef.current = true;
      stopRequestedRef.current = true;

      void stopRecording().catch((error) => {
        console.error(
          'Failed to clean up recorder on unmount:',
          error,
        );
      });
    };
  }, [stopRecording]);

  return {
    startRecording,
    stopRecording,
    cancelRecording,
    isRecording,
  };
}