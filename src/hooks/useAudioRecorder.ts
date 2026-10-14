import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  AudioManager,
  AudioRecorder,
} from "react-native-audio-api";

import { analyzePitchFrame } from "@/utils/dsp/pitch";
import {
  calcRMS,
  rmsToDb,
} from "@/utils/dsp/rms";

const DEFAULT_SAMPLE_RATE = 44100;
const BUFFER_LENGTH = 2048;
const CHANNEL_COUNT = 1;
const LIVE_ANALYSIS_INTERVAL_MS = 120;
const MIN_VOICED_DB = -45;
const MIN_PITCH_HZ = 60;
const MAX_PITCH_HZ = 1500;
const MIN_PITCH_CLARITY = 0.70;
const LIVE_DROPOUT_TOLERANCE_MS = 250;

export interface LiveAudioFrame {
  pitch: number;
  note: string;
  clarity: number;
  volume: number;
  samples: Float32Array;
  sampleRate: number;
}

interface UseAudioRecorderOptions {
  onFrame?: (
    frame: LiveAudioFrame
  ) => void;

  onStop?: (
    samples: Float32Array,
    sampleRate: number
  ) => void;
}

function calculatePeak(
  samples: Float32Array
): number {
  let peak = 0;

  for (
    let i = 0;
    i < samples.length;
    i++
  ) {
    const value = samples[i];

    if (!Number.isFinite(value)) {
      continue;
    }

    const absolute =
      Math.abs(value);

    if (absolute > peak) {
      peak = absolute;
    }
  }

  return peak;
}

function calculateDCOffset(
  samples: Float32Array
): number {
  if (samples.length === 0) {
    return 0;
  }

  let sum = 0;
  let count = 0;

  for (
    let i = 0;
    i < samples.length;
    i++
  ) {
    const value = samples[i];

    if (!Number.isFinite(value)) {
      continue;
    }

    sum += value;
    count++;
  }

  if (count === 0) {
    return 0;
  }

  return sum / count;
}

function analyzeAudioSignal(
  samples: Float32Array,
  sampleRate: number
) {
  let finiteSamples = 0;
  let zeroSamples = 0;

  for (
    let i = 0;
    i < samples.length;
    i++
  ) {
    const value = samples[i];

    if (!Number.isFinite(value)) {
      continue;
    }

    finiteSamples++;

    if (value === 0) {
      zeroSamples++;
    }
  }

  const rms =
    calcRMS(samples);

  const db =
    rmsToDb(rms);

  const peak =
    calculatePeak(samples);

  const dcOffset =
    calculateDCOffset(samples);

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

export function useAudioRecorder(
  options: UseAudioRecorderOptions = {}
) {
  const [
    isRecording,
    setIsRecording,
  ] = useState(false);

  const onFrameRef =
    useRef<
      UseAudioRecorderOptions["onFrame"]
    >(options.onFrame);

  const onStopRef =
    useRef<
      UseAudioRecorderOptions["onStop"]
    >(options.onStop);

  useEffect(() => {
    onFrameRef.current =
      options.onFrame;
  }, [options.onFrame]);

  useEffect(() => {
    onStopRef.current =
      options.onStop;
  }, [options.onStop]);

  const recorderRef =
    useRef<AudioRecorder | null>(null);

  const chunksRef =
    useRef<Float32Array[]>([]);

  const sampleCountRef =
    useRef(0);

  const lastLiveAnalysisRef =
    useRef(0);

  const sessionActiveRef =
    useRef(false);

  const lastValidPitchRef =
    useRef(0);

  const lastValidNoteRef =
    useRef("--");

  const lastValidClarityRef =
    useRef(0);

  const lastValidPitchTimeRef =
    useRef(0);

  const resetLiveDetection =
    useCallback(() => {
      lastValidPitchRef.current = 0;

      lastValidNoteRef.current =
        "--";

      lastValidClarityRef.current =
        0;

      lastValidPitchTimeRef.current =
        0;
    }, []);

  const emitLiveFrame =
    useCallback(
      (
        frame: LiveAudioFrame
      ) => {
        try {
          onFrameRef.current?.(
            frame
          );
        } catch (error) {
          console.error(
            "❌ LIVE FRAME CALLBACK ERROR:",
            error
          );
        }
      },
      []
    );

  const startRecording =
    useCallback(
      async () => {
        if (
          recorderRef.current ||
          isRecording
        ) {
          console.warn(
            "🎤 Recorder is already active."
          );

          return;
        }

        console.log(
          "🎤 REQUESTING MICROPHONE..."
        );

        const permission =
          await AudioManager.requestRecordingPermissions();

        console.log(
          "🎤 MICROPHONE PERMISSION:",
          permission
        );

        if (
          permission !==
          "Granted"
        ) {
          throw new Error(
            "Microphone permission was not granted."
          );
        }

        try {
          AudioManager.setAudioSessionOptions(
            {
              iosCategory:
                "record",

              iosMode:
                "default",

              iosOptions: [],
            }
          );
        } catch (error) {
          console.warn(
            "⚠️ Failed to configure audio session:",
            error
          );
        }

        chunksRef.current = [];
        sampleCountRef.current = 0;
        lastLiveAnalysisRef.current = 0;
        resetLiveDetection();


        const recorder =
          new AudioRecorder();

        recorder.onError(
          (error) => {
            console.error(
              "❌ AUDIO RECORDER ERROR:",
              error
            );
          }
        );

        recorder.onAudioReady(
          {
            sampleRate:
              DEFAULT_SAMPLE_RATE,

            bufferLength:
              BUFFER_LENGTH,

            channelCount:
              CHANNEL_COUNT,
          },

          ({
            buffer,
            numFrames,
            when,
          }) => {
            console.log("🎧 ACTUAL AUDIO BUFFER:", {
              requestedSampleRate: DEFAULT_SAMPLE_RATE,
              actualBufferSampleRate: buffer.sampleRate,
              bufferLength: buffer.length,
              bufferDuration: buffer.duration,
              channelCount: buffer.numberOfChannels,
              numFrames,
            });
            try {
              const channelData =
                buffer.getChannelData(0);

              if (!channelData) {
                console.warn(
                  "⚠️ No channel 0 data received."
                );
                return;
              }

                const frameLength = Math.min(
                Math.max(0, numFrames),
                channelData.length,
              );

              if (frameLength === 0) {
                return;
              }

              const samples = new Float32Array(frameLength);
              samples.set(channelData.subarray(0, frameLength));
              chunksRef.current.push(
                samples
              );
              sampleCountRef.current +=
                samples.length;

              const signal =
                analyzeAudioSignal(
                  samples,
                  DEFAULT_SAMPLE_RATE
                );

              console.log(
                "🎙️ RAW MIC:",
                {
                  when,
                  numFrames,
                  ...signal,
                }
              );

              const now =
                Date.now();

              if (
                now -
                  lastLiveAnalysisRef.current <
                LIVE_ANALYSIS_INTERVAL_MS
              ) {
                return;
              }

              lastLiveAnalysisRef.current =
                now;

              const signalIsQuiet =
                !Number.isFinite(
                  signal.db
                ) ||
                signal.db <
                  MIN_VOICED_DB ||
                signal.peak <= 0;

              if (
                signalIsQuiet
              ) {
                const timeSinceLastValidPitch =
                  lastValidPitchTimeRef.current >
                  0
                    ? now -
                      lastValidPitchTimeRef.current
                    : Infinity;

                if (
                  lastValidPitchRef.current >
                    0 &&
                  timeSinceLastValidPitch <
                    LIVE_DROPOUT_TOLERANCE_MS
                ) {
                  emitLiveFrame(
                    {
                      pitch:
                        lastValidPitchRef.current,

                      note:
                        lastValidNoteRef.current,

                      clarity:
                        lastValidClarityRef.current,

                      volume:
                        signal.db,

                      samples,

                      sampleRate:
                        DEFAULT_SAMPLE_RATE,
                    }
                  );

                  return;
                }

                emitLiveFrame(
                  {
                    pitch: 0,
                    note: "--",
                    clarity: 0,
                    volume:
                      signal.db,
                    samples,
                    sampleRate:
                      DEFAULT_SAMPLE_RATE,
                  }
                );

                return;
              }

              let pitchResult;

              try {
                pitchResult =
                  analyzePitchFrame(
                    samples,
                    DEFAULT_SAMPLE_RATE
                  );
              } catch (error) {
                console.warn(
                  "⚠️ Live pitch analysis failed:",
                  error
                );

                pitchResult = {
                  frequency: 0,
                  note: "--",
                  clarity: 0,
                };
              }

              const detectedPitch =
                pitchResult.frequency;
              const detectedNote =
                pitchResult.note;
              const detectedClarity =
                pitchResult.clarity;
              const validVolume =
                Number.isFinite(
                  signal.db
                ) &&
                signal.db >=
                  MIN_VOICED_DB &&
                signal.peak > 0;

              const validPitch =
                Number.isFinite(
                  detectedPitch
                ) &&
                detectedPitch >=
                  MIN_PITCH_HZ &&
                detectedPitch <=
                  MAX_PITCH_HZ;

              const validClarity =
                Number.isFinite(
                  detectedClarity
                ) &&
                detectedClarity >=
                  MIN_PITCH_CLARITY;

              const validNote =
                typeof detectedNote ===
                  "string" &&
                detectedNote !==
                  "--" &&
                detectedNote.length >
                  0;

              if (
                !validVolume ||
                !validPitch ||
                !validClarity ||
                !validNote
              ) {
                const timeSinceLastValidPitch =
                  lastValidPitchTimeRef.current >
                  0
                    ? now -
                      lastValidPitchTimeRef.current
                    : Infinity;

                if (
                  lastValidPitchRef.current >
                    0 &&
                  timeSinceLastValidPitch <
                    LIVE_DROPOUT_TOLERANCE_MS
                ) {
                  emitLiveFrame(
                    {
                      pitch:
                        lastValidPitchRef.current,
                      note:
                        lastValidNoteRef.current,
                      clarity:
                        lastValidClarityRef.current,
                      volume:
                        signal.db,
                      samples,
                      sampleRate:
                        DEFAULT_SAMPLE_RATE,
                    }
                  );

                  return;
                }

                emitLiveFrame(
                  {
                    pitch: 0,
                    note: "--",
                    clarity: 0,
                    volume:
                      signal.db,
                    samples,
                    sampleRate:
                      DEFAULT_SAMPLE_RATE,
                  }
                );

                console.log(
                  "⚠️ LIVE PITCH REJECTED:",
                  {
                    pitch:
                      detectedPitch,
                    note:
                      detectedNote,
                    clarity:
                      detectedClarity,
                    volumeDb:
                      signal.db,
                    validVolume,
                    validPitch,
                    validClarity,
                    validNote,
                  }
                );

                return;
              }

              lastValidPitchRef.current =
                detectedPitch;
              lastValidNoteRef.current =
                detectedNote;
              lastValidClarityRef.current =
                detectedClarity;
              lastValidPitchTimeRef.current =
                now;

              const liveFrame:
                LiveAudioFrame =
                {
                  pitch:
                    detectedPitch,
                  note:
                    detectedNote,
                  clarity:
                    detectedClarity,
                  volume:
                    signal.db,
                  samples,
                  sampleRate:
                    DEFAULT_SAMPLE_RATE,
                };

              emitLiveFrame(
                liveFrame
              );
            } catch (error) {
              console.error(
                "❌ AUDIO CALLBACK ERROR:",
                error
              );
            }
          }
        );

        try {
          await AudioManager.setAudioSessionActivity(
            true
          );

          sessionActiveRef.current =
            true;

          console.log(
            "🎧 AUDIO SESSION ACTIVATED"
          );
        } catch (error) {
          console.error(
            "❌ FAILED TO ACTIVATE AUDIO SESSION:",
            error
          );

          try {
            recorder.clearOnAudioReady();
          } catch {
            // Ignore cleanup failure.
          }

          throw error;
        }

        try {
          recorderRef.current =
            recorder;

          const result =
            await recorder.start();

          if (
            result &&
            result.status ===
              "error"
          ) {
            console.error(
              "❌ RECORDER START ERROR:",
              result.message
            );

            recorderRef.current =
              null;

            try {
              recorder.clearOnAudioReady();
            } catch {

            }

            if (
              sessionActiveRef.current
            ) {
              try {
                await AudioManager.setAudioSessionActivity(
                  false
                );
              } catch {

              }

              sessionActiveRef.current =
                false;
            }

            throw new Error(
              result.message
            );
          }

          setIsRecording(true);

          console.log(
            "🎤 MICROPHONE STARTED"
          );

        } catch (error) {
          console.error(
            "❌ FAILED TO START MICROPHONE:",
            error
          );

          recorderRef.current =
            null;

          try {
            recorder.clearOnAudioReady();
          } catch {

          }

          if (
            sessionActiveRef.current
          ) {
            try {
              await AudioManager.setAudioSessionActivity(
                false
              );
            } catch {

            }

            sessionActiveRef.current =
              false;
          }

          resetLiveDetection();

          throw error;
        }
      },
      [
        isRecording,
        resetLiveDetection,
        emitLiveFrame,
      ]
    );
  
  const stoppingRef = useRef(false);

  const stopRecording =
    useCallback(async () => {
        const recorder = recorderRef.current;

        if (!recorder || stoppingRef.current) return;
        
        stoppingRef.current = true;

        console.log(
          "🛑 STOPPING RECORDER..."
        );

        try {
          const result = await recorder.stop();
          console.log("🛑 RECORDER STOP RESULT:", result);
        } catch (error) {
          console.error("❌ FAILED TO STOP RECORDER:", error);
        }

          try {
          recorder.clearOnAudioReady();
        } catch (error) {
          console.warn("⚠️ FAILED TO CLEAR AUDIO CALLBACK:", error);
        }

        if (
          sessionActiveRef.current
        ) {
          try {
            await AudioManager.setAudioSessionActivity(false);
            console.log("🎧 AUDIO SESSION DEACTIVATED");
          } catch (error) {
            console.warn("⚠️ FAILED TO DEACTIVATE AUDIO SESSION:", error);
          }

          sessionActiveRef.current =
            false;
        }

        const chunks = chunksRef.current;
        const totalSamples = sampleCountRef.current;

        recorderRef.current = null;
        chunksRef.current = [];
        sampleCountRef.current = 0;
        lastLiveAnalysisRef.current = 0;
        resetLiveDetection();
        setIsRecording(false);
        stoppingRef.current = false;

        const fullBuffer = new Float32Array(totalSamples);
        let offset = 0;

        for (const chunk of chunks) {
          fullBuffer.set(chunk, offset);
          offset += chunk.length;
        }

        const finalSignal = analyzeAudioSignal(fullBuffer, DEFAULT_SAMPLE_RATE);
        const durationSeconds = fullBuffer.length / DEFAULT_SAMPLE_RATE;

        console.log("🛑 RECORDING STOPPED");

        console.log("🎧 FINAL AUDIO SIGNAL:",
          {
            ...finalSignal,
            durationSeconds,
          }
        );

        try {
          onStopRef.current?.(
            fullBuffer,
            DEFAULT_SAMPLE_RATE
          );
        } catch (error) {
          console.error("❌ onStop CALLBACK ERROR:", error);
        }
      },
      [resetLiveDetection]
    );

  return {
    startRecording,
    stopRecording,
    isRecording,
  };
}