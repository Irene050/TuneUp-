// src/hooks/useAudioRecorder.ts

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

// ============================================================
// CONFIGURATION
// ============================================================

const DEFAULT_SAMPLE_RATE = 44100;
const BUFFER_LENGTH = 2048;
const CHANNEL_COUNT = 1;

// How frequently the live UI is updated.
const LIVE_ANALYSIS_INTERVAL_MS = 120;

// Treat extremely quiet input as silence.
const MIN_VOICED_DB = -60;

// Singing pitch range.
const MIN_PITCH_HZ = 60;
const MAX_PITCH_HZ = 1500;

// Minimum Pitchy clarity required for a live pitch.
const MIN_PITCH_CLARITY = 0.45;

// Keep the previous valid pitch temporarily if the native
// microphone stream has a short dropout.
const LIVE_DROPOUT_TOLERANCE_MS = 700;


// ============================================================
// TYPES
// ============================================================

export interface LiveAudioFrame {
  pitch: number;
  note: string;
  clarity: number;
  volume: number;
  stability: number;
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


// ============================================================
// AUDIO SIGNAL HELPERS
// ============================================================

/**
 * Calculate RMS amplitude.
 */
function calculateRMS(
  samples: Float32Array
): number {
  if (samples.length === 0) {
    return 0;
  }

  let sumSquares = 0;
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

    sumSquares += value * value;
    count++;
  }

  if (count === 0) {
    return 0;
  }

  return Math.sqrt(
    sumSquares / count
  );
}


/**
 * Convert RMS amplitude to dBFS.
 */
function rmsToDb(
  rms: number
): number {
  if (
    !Number.isFinite(rms) ||
    rms <= 0
  ) {
    return -100;
  }

  return 20 * Math.log10(rms);
}


/**
 * Calculate largest absolute sample.
 */
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


/**
 * Calculate DC offset.
 */
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


/**
 * Analyze one raw PCM buffer.
 *
 * This function does NOT modify the samples.
 */
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
    calculateRMS(samples);

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


// ============================================================
// HOOK
// ============================================================

export function useAudioRecorder(
  options: UseAudioRecorderOptions = {}
) {
  const [
    isRecording,
    setIsRecording,
  ] = useState(false);


  // ==========================================================
  // CALLBACK REFS
  // ==========================================================
  //
  // Do NOT place the options object itself inside the native
  // recorder callback dependency chain.
  //
  // React components can create a new object on every render.
  // These refs let the recorder continue using the latest
  // callbacks without rebuilding the recorder callbacks.
  // ==========================================================

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


  // ==========================================================
  // RECORDER STATE
  // ==========================================================

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


  // ==========================================================
  // LIVE DETECTION MEMORY
  // ==========================================================
  //
  // IMPORTANT:
  //
  // These values are ONLY for smoothing the live UI.
  //
  // They NEVER alter the PCM recording.
  // ==========================================================

  const lastValidPitchRef =
    useRef(0);

  const lastValidNoteRef =
    useRef("--");

  const lastValidClarityRef =
    useRef(0);

  const lastValidVolumeRef =
    useRef(-100);

  const lastValidPitchTimeRef =
    useRef(0);


  // ==========================================================
  // RESET LIVE DETECTION
  // ==========================================================

  const resetLiveDetection =
    useCallback(() => {
      lastValidPitchRef.current = 0;

      lastValidNoteRef.current =
        "--";

      lastValidClarityRef.current =
        0;

      lastValidVolumeRef.current =
        -100;

      lastValidPitchTimeRef.current =
        0;
    }, []);


  // ==========================================================
  // EMIT LIVE FRAME
  // ==========================================================

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


  // ==========================================================
  // START RECORDING
  // ==========================================================

  const startRecording =
    useCallback(
      async () => {
        /*
         * Prevent duplicate recorder creation.
         */
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

        /*
         * Request microphone permission.
         */
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


        // ======================================================
        // AUDIO SESSION
        // ======================================================

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


        // ======================================================
        // RESET RECORDING STATE
        // ======================================================

        chunksRef.current = [];

        sampleCountRef.current = 0;

        lastLiveAnalysisRef.current = 0;

        resetLiveDetection();


        // ======================================================
        // CREATE RECORDER
        // ======================================================

        const recorder =
          new AudioRecorder();


        // ======================================================
        // NATIVE RECORDER ERRORS
        // ======================================================

        recorder.onError(
          (error) => {
            console.error(
              "❌ AUDIO RECORDER ERROR:",
              error
            );
          }
        );


        // ======================================================
        // AUDIO CALLBACK
        // ======================================================

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
            try {
              // ==================================================
              // GET CHANNEL DATA
              // ==================================================

              const channelData =
                buffer.getChannelData(0);

              if (!channelData) {
                console.warn(
                  "⚠️ No channel 0 data received."
                );

                return;
              }


              // ==================================================
              // COPY NATIVE BUFFER IMMEDIATELY
              // ==================================================
              //
              // Native audio buffers may be reused by the
              // recorder. Therefore we immediately copy them.
              // ==================================================

              const samples =
                new Float32Array(
                  channelData.length
                );

              samples.set(
                channelData
              );


              // ==================================================
              // ALWAYS STORE RAW AUDIO
              // ==================================================
              //
              // This happens BEFORE live analysis.
              //
              // Live detection can fail, timeout, or throw
              // without affecting the assessment recording.
              // ==================================================

              chunksRef.current.push(
                samples
              );

              sampleCountRef.current +=
                samples.length;


              // ==================================================
              // RAW SIGNAL DIAGNOSTICS
              // ==================================================

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


              // ==================================================
              // LIVE ANALYSIS THROTTLE
              // ==================================================

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


              // ==================================================
              // DETERMINE WHETHER SIGNAL IS QUIET
              // ==================================================

              const signalIsQuiet =
                !Number.isFinite(
                  signal.db
                ) ||
                signal.db <
                  MIN_VOICED_DB ||
                signal.peak <= 0;


              // ==================================================
              // HANDLE QUIET / DROPOUT
              // ======================================================

              if (
                signalIsQuiet
              ) {
                const timeSinceLastValidPitch =
                  lastValidPitchTimeRef.current >
                  0
                    ? now -
                      lastValidPitchTimeRef.current
                    : Infinity;


                /*
                 * Temporary dropout:
                 *
                 * Keep the previous note visible.
                 *
                 * The raw zeros remain untouched in the
                 * recording.
                 */

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

                      /*
                       * Show the current signal level.
                       */
                      volume:
                        signal.db,

                      stability:
                        0,
                    }
                  );

                  return;
                }


                /*
                 * Longer dropout:
                 *
                 * No reliable pitch.
                 */

                emitLiveFrame(
                  {
                    pitch: 0,

                    note: "--",

                    clarity: 0,

                    volume:
                      signal.db,

                    stability: 0,
                  }
                );

                return;
              }


              // ==================================================
              // PITCH DETECTION
              // ==================================================

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


              // ==================================================
              // VALIDATE PITCH
              // ==================================================

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


              // ==================================================
              // INVALID PITCH RESULT
              // ==================================================

              if (
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


                /*
                 * Short Pitchy failure:
                 *
                 * Keep previous good note.
                 */

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

                      stability:
                        0,
                    }
                  );

                  return;
                }


                /*
                 * Long failure:
                 *
                 * No reliable pitch.
                 */

                emitLiveFrame(
                  {
                    pitch: 0,

                    note: "--",

                    clarity: 0,

                    volume:
                      signal.db,

                    stability: 0,
                  }
                );

                return;
              }


              // ==================================================
              // VALID PITCH
              // ==================================================

              lastValidPitchRef.current =
                detectedPitch;

              lastValidNoteRef.current =
                detectedNote;

              lastValidClarityRef.current =
                detectedClarity;

              lastValidVolumeRef.current =
                signal.db;

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

                  stability:
                    0,
                };


              emitLiveFrame(
                liveFrame
              );


              console.log(
                "🎵 LIVE AUDIO:",
                {
                  pitch:
                    detectedPitch,

                  note:
                    detectedNote,

                  clarity:
                    detectedClarity,

                  volumeDb:
                    signal.db,

                  stability:
                    0,
                }
              );

            } catch (error) {
              /*
               * A live-analysis error must NEVER interrupt
               * raw audio collection.
               */
              console.error(
                "❌ AUDIO CALLBACK ERROR:",
                error
              );
            }
          }
        );


        // ======================================================
        // ACTIVATE AUDIO SESSION
        // ======================================================

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


        // ======================================================
        // START NATIVE RECORDER
        // ======================================================

        try {
          /*
           * Set the ref BEFORE awaiting start.
           *
           * This prevents another start request from creating
           * a second recorder while native start is pending.
           */
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
              // Ignore cleanup failure.
            }


            if (
              sessionActiveRef.current
            ) {
              try {
                await AudioManager.setAudioSessionActivity(
                  false
                );
              } catch {
                // Ignore cleanup failure.
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
            // Ignore cleanup failure.
          }


          if (
            sessionActiveRef.current
          ) {
            try {
              await AudioManager.setAudioSessionActivity(
                false
              );
            } catch {
              // Ignore cleanup failure.
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


  // ==========================================================
  // STOP RECORDING
  // ==========================================================

  const stopRecording =
    useCallback(
      async () => {
        const recorder =
          recorderRef.current;

        if (!recorder) {
          console.warn(
            "🛑 No active recorder."
          );

          return;
        }

        console.log(
          "🛑 STOPPING RECORDER..."
        );


        // ======================================================
        // STOP NATIVE RECORDER
        // ======================================================

        try {
          const result =
            await recorder.stop();

          console.log(
            "🛑 RECORDER STOP RESULT:",
            result
          );
        } catch (error) {
          console.error(
            "❌ FAILED TO STOP RECORDER:",
            error
          );
        }


        // ======================================================
        // STOP AUDIO CALLBACK
        // ======================================================

        try {
          recorder.clearOnAudioReady();
        } catch (error) {
          console.warn(
            "⚠️ FAILED TO CLEAR AUDIO CALLBACK:",
            error
          );
        }


        // ======================================================
        // DEACTIVATE AUDIO SESSION
        // ======================================================

        if (
          sessionActiveRef.current
        ) {
          try {
            await AudioManager.setAudioSessionActivity(
              false
            );

            console.log(
              "🎧 AUDIO SESSION DEACTIVATED"
            );
          } catch (error) {
            console.warn(
              "⚠️ FAILED TO DEACTIVATE AUDIO SESSION:",
              error
            );
          }

          sessionActiveRef.current =
            false;
        }


        // ======================================================
        // COMBINE RAW CHUNKS
        // ======================================================

        const totalSamples =
          sampleCountRef.current;

        const fullBuffer =
          new Float32Array(
            totalSamples
          );

        let offset = 0;

        for (
          const chunk
          of chunksRef.current
        ) {
          fullBuffer.set(
            chunk,
            offset
          );

          offset +=
            chunk.length;
        }


        // ======================================================
        // FINAL AUDIO DIAGNOSTICS
        // ======================================================

        const finalSignal =
          analyzeAudioSignal(
            fullBuffer,
            DEFAULT_SAMPLE_RATE
          );

        const durationSeconds =
          fullBuffer.length /
          DEFAULT_SAMPLE_RATE;


        console.log(
          "🛑 RECORDING STOPPED"
        );

        console.log(
          "🎧 FINAL AUDIO SIGNAL:",
          {
            ...finalSignal,

            durationSeconds,
          }
        );


        // ======================================================
        // SEND COMPLETE RAW RECORDING
        // ======================================================
        //
        // IMPORTANT:
        //
        // No filtering.
        // No silence removal.
        // No pitch smoothing.
        // No interpolation.
        //
        // The assessment receives the actual recorded PCM.
        // ======================================================

        try {
          onStopRef.current?.(
            fullBuffer,
            DEFAULT_SAMPLE_RATE
          );
        } catch (error) {
          console.error(
            "❌ onStop CALLBACK ERROR:",
            error
          );
        }


        // ======================================================
        // CLEANUP
        // ======================================================

        recorderRef.current =
          null;

        chunksRef.current = [];

        sampleCountRef.current =
          0;

        lastLiveAnalysisRef.current =
          0;

        resetLiveDetection();

        setIsRecording(false);
      },
      [resetLiveDetection]
    );


  // ==========================================================
  // RETURN API
  // ==========================================================

  return {
    startRecording,
    stopRecording,
    isRecording,
  };
}