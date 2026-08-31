import { useCallback, useRef, useState } from 'react';

import {
    AudioContext,
    AudioManager,
    AudioRecorder,
} from 'react-native-audio-api';

import { computeFFTMagnitudes } from '@/utils/dsp/fft';

const DEFAULT_SAMPLE_RATE = 44100;
const BUFFER_LENGTH = 2048;
const CHANNEL_COUNT = 1;
const FFT_FRAME_SIZE = 1024;

export type RecorderPhase =
  | 'inhale'
  | 'exhale'
  | 'default';

interface UseAudioRecorderOptions {
  onFrame?: (
    samples: Float32Array,
    sampleRate: number
  ) => void;

  onStop?: (
    samples: Float32Array,
    sampleRate: number,
    fftFrames: Float32Array[]
  ) => void;
}

export function useAudioRecorder(
  options: UseAudioRecorderOptions = {}
) {
  const [isRecording, setIsRecording] =
    useState(false);

  const contextRef =
    useRef<AudioContext | null>(null);

  const recorderRef =
    useRef<AudioRecorder | null>(null);

  const bufferChunksRef =
    useRef<Float32Array[]>([]);

  const phaseBuffersRef =
    useRef<Record<RecorderPhase, Float32Array[]>>({
      inhale: [],
      exhale: [],
      default: [],
    });

  const currentPhaseRef =
    useRef<RecorderPhase>('default');

  // ----------------------------------------------------------
  // PHASE
  // ----------------------------------------------------------

  const setPhase = useCallback(
    (phase: RecorderPhase) => {
      currentPhaseRef.current = phase;
    },
    []
  );

  // ----------------------------------------------------------
  // START RECORDING
  // ----------------------------------------------------------

  const startRecording = useCallback(
    async () => {
      try {
        console.log('🎤 REQUESTING MICROPHONE...');

        const permission =
          await AudioManager.requestRecordingPermissions();

        console.log(
          '🎤 MICROPHONE PERMISSION:',
          permission
        );

        if (!permission) {
          throw new Error(
            'Microphone permission was denied.'
          );
        }

        // Reset buffers
        bufferChunksRef.current = [];

        phaseBuffersRef.current = {
          inhale: [],
          exhale: [],
          default: [],
        };

        currentPhaseRef.current = 'default';

        // ----------------------------------------------------
        // AUDIO SESSION
        // ----------------------------------------------------

        AudioManager.setAudioSessionOptions({
          iosCategory: 'record',
          iosMode: 'default',
          iosOptions: [],
        });

        // ----------------------------------------------------
        // AUDIO CONTEXT
        // ----------------------------------------------------

        const context =
          new AudioContext({
            sampleRate:
              DEFAULT_SAMPLE_RATE,
          });

        // ----------------------------------------------------
        // RECORDER
        // ----------------------------------------------------

        const recorder =
          new AudioRecorder();

        // ----------------------------------------------------
        // IMPORTANT:
        // CONNECT RECORDER TO AUDIO GRAPH
        // ----------------------------------------------------

        const adapter =
          context.createRecorderAdapter();

        recorder.connect(adapter);

        adapter.connect(
          context.destination
        );

        // ----------------------------------------------------
        // AUDIO CALLBACK
        // ----------------------------------------------------

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
            const samples =
              buffer.getChannelData(0);

            const chunk =
              new Float32Array(samples);

            console.log(
              '🎤 AUDIO FRAME:',
              chunk.length,
              'samples |',
              buffer.sampleRate,
              'Hz'
            );

            bufferChunksRef.current.push(
              chunk
            );

            phaseBuffersRef.current[
              currentPhaseRef.current
            ].push(chunk);

            options.onFrame?.(
              chunk,
              buffer.sampleRate
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

        setIsRecording(true);
      } catch (error) {
        console.error(
          '❌ FAILED TO START RECORDING:',
          error
        );

        setIsRecording(false);

        throw error;
      }
    },
    [options]
  );

  // ----------------------------------------------------------
  // STOP RECORDING
  // ----------------------------------------------------------

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

          await recorder.stop();

          /*
           * Give the native recorder a moment
           * to flush its final audio callback.
           */
          await new Promise(
            resolve =>
              setTimeout(
                resolve,
                100
              )
          );

          // --------------------------------------------------
          // COMBINE AUDIO CHUNKS
          // --------------------------------------------------

          const chunks =
            bufferChunksRef.current;

          const totalLength =
            chunks.reduce(
              (sum, chunk) =>
                sum + chunk.length,
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
            Float32Array[] = [];

          for (
            let i = 0;
            i + FFT_FRAME_SIZE <=
              fullBuffer.length;
            i += FFT_FRAME_SIZE
          ) {
            const frame =
              fullBuffer.subarray(
                i,
                i + FFT_FRAME_SIZE
              );

            fftFrames.push(
              computeFFTMagnitudes(
                frame
              )
            );
          }

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
          // SEND RESULT
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

          contextRef.current?.close();

          contextRef.current =
            null;

          recorderRef.current =
            null;

          setIsRecording(false);
        } catch (error) {
          console.error(
            '❌ FAILED TO STOP RECORDING:',
            error
          );

          setIsRecording(false);
        }
      },
      [options]
    );

  // ----------------------------------------------------------
  // PHASE SAMPLES
  // ----------------------------------------------------------

  const getPhaseSamples =
    useCallback(() => {
      const concat = (
        chunks: Float32Array[]
      ) => {
        const length =
          chunks.reduce(
            (sum, chunk) =>
              sum + chunk.length,
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
        inhale: concat(
          phaseBuffersRef.current.inhale
        ),

        exhale: concat(
          phaseBuffersRef.current.exhale
        ),
      };
    }, []);

  // ----------------------------------------------------------
  // RETURN
  // ----------------------------------------------------------

  return {
    startRecording,
    stopRecording,
    isRecording,
    setPhase,
    getPhaseSamples,
  };
}