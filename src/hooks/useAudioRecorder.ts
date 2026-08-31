import {
    useCallback,
    useRef,
    useState,
} from 'react';

import {
    AudioContext,
    AudioManager,
    AudioRecorder,
} from 'react-native-audio-api';

import {
    analyzePitchFrame,
    calcLiveStability,
} from '@/utils/dsp/pitch';

import {
    computeFFTMagnitudes,
} from '@/utils/dsp/fft';

const DEFAULT_SAMPLE_RATE = 44100;

const BUFFER_LENGTH = 2048;

const CHANNEL_COUNT = 1;

const FFT_FRAME_SIZE = 1024;


// ============================================================
// TYPES
// ============================================================

export type RecorderPhase =
  | 'inhale'
  | 'exhale'
  | 'default';


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
    sampleRate: number,
    fftFrames: Float32Array[]
  ) => void;
}


// ============================================================
// RMS
// ============================================================

/**
 * Calculates RMS amplitude from one microphone frame.
 *
 * This is used ONLY for live volume display.
 *
 * Final volume assessment continues to use
 * volumeAnalysis.ts.
 */
function calculateRMS(
  samples: Float32Array
): number {
  if (
    samples.length === 0
  ) {
    return 0;
  }

  let sum = 0;

  for (
    let i = 0;
    i < samples.length;
    i++
  ) {
    const sample =
      samples[i];

    sum +=
      sample *
      sample;
  }

  return Math.sqrt(
    sum /
      samples.length
  );
}


// ============================================================
// RMS → DECIBELS
// ============================================================

function rmsToDb(
  rms: number
): number {
  if (
    !Number.isFinite(rms) ||
    rms <= 0
  ) {
    return -100;
  }

  return Math.max(
    -100,
    20 *
      Math.log10(rms)
  );
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
  ] =
    useState(false);


  // ----------------------------------------------------------
  // AUDIO OBJECTS
  // ----------------------------------------------------------

  const contextRef =
    useRef<AudioContext | null>(
      null
    );

  const recorderRef =
    useRef<AudioRecorder | null>(
      null
    );


  // ----------------------------------------------------------
  // COMPLETE AUDIO
  // ----------------------------------------------------------

  /*
   * Every microphone frame is stored here.
   *
   * This is NEVER replaced by the live processing.
   */
  const bufferChunksRef =
    useRef<Float32Array[]>([]);


  // ----------------------------------------------------------
  // PHASE AUDIO
  // ----------------------------------------------------------

  const phaseBuffersRef =
    useRef<
      Record<
        RecorderPhase,
        Float32Array[]
      >
    >({
      inhale: [],
      exhale: [],
      default: [],
    });


  const currentPhaseRef =
    useRef<RecorderPhase>(
      'default'
    );


  // ----------------------------------------------------------
  // LIVE PITCH HISTORY
  // ----------------------------------------------------------

  /*
   * Stores recent detected pitches.
   *
   * This is ONLY for the live stability display.
   *
   * It does NOT affect the final assessment.
   */
  const livePitchHistoryRef =
    useRef<number[]>([]);


  // ==========================================================
  // PHASE
  // ==========================================================

  const setPhase =
    useCallback(
      (
        phase: RecorderPhase
      ) => {
        currentPhaseRef.current =
          phase;
      },
      []
    );


  // ==========================================================
  // START RECORDING
  // ==========================================================

  const startRecording =
    useCallback(
      async () => {
        try {
          console.log(
            '🎤 REQUESTING MICROPHONE...'
          );

          const permission =
            await AudioManager
              .requestRecordingPermissions();

          console.log(
            '🎤 MICROPHONE PERMISSION:',
            permission
          );

          /*
           * react-native-audio-api can return
           * a truthy permission value/string.
           *
           * Do not compare it to boolean true.
           */
          if (!permission) {
            throw new Error(
              'Microphone permission was denied.'
            );
          }


          // --------------------------------------------------
          // RESET
          // --------------------------------------------------

          bufferChunksRef.current =
            [];

          phaseBuffersRef.current =
            {
              inhale: [],
              exhale: [],
              default: [],
            };

          currentPhaseRef.current =
            'default';

          livePitchHistoryRef.current =
            [];


          // --------------------------------------------------
          // AUDIO SESSION
          // --------------------------------------------------

          AudioManager.setAudioSessionOptions(
            {
              iosCategory:
                'record',

              iosMode:
                'default',

              iosOptions: [],
            }
          );


          // --------------------------------------------------
          // AUDIO CONTEXT
          // --------------------------------------------------

          const context =
            new AudioContext({
              sampleRate:
                DEFAULT_SAMPLE_RATE,
            });


          // --------------------------------------------------
          // RECORDER
          // --------------------------------------------------

          const recorder =
            new AudioRecorder();


          // --------------------------------------------------
          // AUDIO GRAPH
          // --------------------------------------------------

          const adapter =
            context.createRecorderAdapter();

          recorder.connect(
            adapter
          );

          adapter.connect(
            context.destination
          );


          // --------------------------------------------------
          // AUDIO CALLBACK
          // --------------------------------------------------

          recorder.onAudioReady(
            {
              sampleRate:
                DEFAULT_SAMPLE_RATE,

              bufferLength:
                BUFFER_LENGTH,

              channelCount:
                CHANNEL_COUNT,
            },

            ({ buffer }) => {
              /*
               * Copy the native audio data immediately.
               */
              const channelData =
                buffer.getChannelData(
                  0
                );

              const samples =
                new Float32Array(
                  channelData
                );


              // =================================================
              // PATH 1 — SAVE COMPLETE AUDIO
              // =================================================

              /*
               * IMPORTANT:
               *
               * Every frame is preserved.
               *
               * The final assessment receives the
               * entire recording.
               */
              bufferChunksRef.current.push(
                samples
              );


              phaseBuffersRef.current[
                currentPhaseRef.current
              ].push(
                samples
              );


              // =================================================
              // PATH 2 — LIVE ANALYSIS
              // =================================================

              /*
               * Pitch
               */
              const pitchData =
                analyzePitchFrame(
                  samples,
                  buffer.sampleRate
                );


              /*
               * Store valid pitch for stability.
               */
              if (
                pitchData.frequency >
                  0 &&
                Number.isFinite(
                  pitchData.frequency
                )
              ) {
                livePitchHistoryRef.current.push(
                  pitchData.frequency
                );

                /*
                 * Keep only the most recent
                 * 20 pitch frames.
                 */
                if (
                  livePitchHistoryRef
                    .current.length >
                  20
                ) {
                  livePitchHistoryRef.current.shift();
                }
              }


              /*
               * Stability
               */
              const stability =
                calcLiveStability(
                  livePitchHistoryRef
                    .current
                );


              /*
               * Volume
               */
              const rms =
                calculateRMS(
                  samples
                );

              const volume =
                rmsToDb(
                  rms
                );


              // =================================================
              // SEND LIVE DATA TO SCREEN
              // =================================================

              options.onFrame?.(
                {
                  pitch:
                    pitchData.frequency,

                  note:
                    pitchData.note,

                  clarity:
                    pitchData.clarity,

                  volume,

                  stability,
                }
              );
            }
          );


          contextRef.current =
            context;

          recorderRef.current =
            recorder;


          // ----------------------------------------------------
          // START
          // ----------------------------------------------------

          await context.resume();

          await recorder.start();

          console.log(
            '🎤 MICROPHONE STARTED'
          );

          setIsRecording(
            true
          );
        } catch (error) {
          console.error(
            '❌ FAILED TO START RECORDING:',
            error
          );

          setIsRecording(
            false
          );

        recorderRef.current = null;
        contextRef.current = null;
        }
      },
      [options]
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
          console.log(
            '⚠️ No recorder is active.'
          );

          return;
        }


        try {
          console.log(
            '🛑 STOPPING RECORDER...'
          );


          // --------------------------------------------------
          // STOP NATIVE RECORDER
          // --------------------------------------------------

            await Promise.race([
                recorder.stop(),
                new Promise((_, reject) =>
                setTimeout(
                    () => reject(new Error('recorder.stop() timed out')),
                    3000
                )
                ),
            ]);


          /*
           * Give native audio time to flush
           * the final callback.
           */
          await new Promise(
            resolve =>
              setTimeout(
                resolve,
                100
              )
          );


          // --------------------------------------------------
          // COMBINE COMPLETE AUDIO
          // --------------------------------------------------

          const chunks =
            bufferChunksRef.current;


          const totalLength =
            chunks.reduce(
              (
                sum,
                chunk
              ) =>
                sum +
                chunk.length,
              0
            );


          const fullBuffer =
            new Float32Array(
              totalLength
            );


          let offset = 0;


          for (
            const chunk of chunks
          ) {
            fullBuffer.set(
              chunk,
              offset
            );

            offset +=
              chunk.length;
          }


          // --------------------------------------------------
          // FFT
          // --------------------------------------------------

          const fftFrames:
            Float32Array[] =
            [];


          for (
            let i = 0;
            i +
                FFT_FRAME_SIZE <=
              fullBuffer.length;
            i +=
              FFT_FRAME_SIZE
          ) {
            const frame =
              fullBuffer.subarray(
                i,
                i +
                  FFT_FRAME_SIZE
              );


            fftFrames.push(
              computeFFTMagnitudes(
                frame
              )
            );
          }


          // --------------------------------------------------
          // LOG
          // --------------------------------------------------

          console.log(
            '🛑 RECORDING STOPPED'
          );

          console.log(
            'Total samples:',
            fullBuffer.length
          );

          console.log(
            'Sample rate:',
            DEFAULT_SAMPLE_RATE
          );

          console.log(
            'FFT frames:',
            fftFrames.length
          );


          // --------------------------------------------------
          // SEND COMPLETE RECORDING
          // --------------------------------------------------

          options.onStop?.(
            fullBuffer,
            DEFAULT_SAMPLE_RATE,
            fftFrames
          );


          // --------------------------------------------------
          // CLEANUP
          // --------------------------------------------------

          recorder.clearOnAudioReady();

          await contextRef.current?.close();


          contextRef.current =
            null;

          recorderRef.current =
            null;

          livePitchHistoryRef.current =
            [];

          setIsRecording(
            false
          );
        } catch (error) {
          console.error(
            '❌ FAILED TO STOP RECORDING:',
            error
          );

          setIsRecording(
            false
          );
        }
      },
      [options]
    );


  // ==========================================================
  // PHASE SAMPLES
  // ==========================================================

  const getPhaseSamples =
    useCallback(
      () => {
        const concat =
          (
            chunks:
              Float32Array[]
          ) => {
            const length =
              chunks.reduce(
                (
                  sum,
                  chunk
                ) =>
                  sum +
                  chunk.length,
                0
              );


            const output =
              new Float32Array(
                length
              );


            let offset = 0;


            for (
              const chunk of chunks
            ) {
              output.set(
                chunk,
                offset
              );

              offset +=
                chunk.length;
            }


            return output;
          };


        return {
          inhale:
            concat(
              phaseBuffersRef
                .current
                .inhale
            ),

          exhale:
            concat(
              phaseBuffersRef
                .current
                .exhale
            ),
        };
      },
      []
    );


  // ==========================================================
  // RETURN
  // ==========================================================

  return {
    startRecording,
    stopRecording,
    isRecording,
    setPhase,
    getPhaseSamples,
  };
}