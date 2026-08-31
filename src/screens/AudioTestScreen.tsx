import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import {
    Pressable,
    StyleSheet,
    Text,
    View,
} from 'react-native';

import {
    useAudioRecorder,
} from '@/hooks/useAudioRecorder';

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const WHITE = '#FFFFFF';
const MUTED = '#8E7770';

export default function AudioTestScreen() {
  const [lastSampleCount, setLastSampleCount] =
    useState(0);

  const [lastFFTCount, setLastFFTCount] =
    useState(0);

  const {
    startRecording,
    stopRecording,
    isRecording,
  } = useAudioRecorder({
    onFrame: (
      samples,
      sampleRate
    ) => {
      console.log(
        '🎤 AUDIO FRAME:',
        samples.length,
        'samples |',
        sampleRate,
        'Hz'
      );
    },

    onStop: (
      samples,
      sampleRate,
      fftFrames
    ) => {
      console.log(
        '🛑 RECORDING STOPPED'
      );

      console.log(
        'Total samples:',
        samples.length
      );

      console.log(
        'Sample rate:',
        sampleRate
      );

      console.log(
        'FFT frames:',
        fftFrames.length
      );

      setLastSampleCount(
        samples.length
      );

      setLastFFTCount(
        fftFrames.length
      );
    },
  });

  return (
    <View style={styles.screen}>

      {/* BACK BUTTON */}
      <Pressable
        style={styles.backButton}
        onPress={() => router.back()}
      >
        <Ionicons
          name="arrow-back"
          size={22}
          color={BROWN}
        />
      </Pressable>


      {/* CONTENT */}
      <View style={styles.content}>

        <View style={styles.iconCircle}>
          <Ionicons
            name="mic"
            size={36}
            color={BROWN}
          />
        </View>

        <Text style={styles.title}>
          Audio Test
        </Text>

        <Text style={styles.description}>
          Test your microphone and make sure
          TuneUp! can receive audio correctly.
        </Text>


        {/* STATUS */}
        <View style={styles.statusCard}>

          <Text style={styles.statusTitle}>
            Microphone Status
          </Text>

          <Text
            style={[
              styles.statusText,
              isRecording &&
                styles.recordingText,
            ]}
          >
            {isRecording
              ? '🎤 Recording...'
              : 'Ready to record'}
          </Text>

        </View>


        {/* RECORD BUTTON */}
        <Pressable
          style={[
            styles.recordButton,
            isRecording &&
              styles.stopButton,
          ]}
          onPress={
            isRecording
              ? stopRecording
              : startRecording
          }
        >
          <Ionicons
            name={
              isRecording
                ? 'stop'
                : 'mic'
            }
            size={28}
            color={WHITE}
          />

          <Text style={styles.recordButtonText}>
            {isRecording
              ? 'Stop Recording'
              : 'Start Recording'}
          </Text>
        </Pressable>


        {/* RESULTS */}
        {lastSampleCount > 0 && (
          <View style={styles.resultCard}>

            <Text style={styles.resultTitle}>
              Audio Received ✓
            </Text>

            <Text style={styles.resultText}>
              Samples: {lastSampleCount}
            </Text>

            <Text style={styles.resultText}>
              Sample Rate: 44,100 Hz
            </Text>

            <Text style={styles.resultText}>
              FFT Frames: {lastFFTCount}
            </Text>

          </View>
        )}

      </View>

    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: WHITE,
  },

  backButton: {
    position: 'absolute',

    top: 55,
    left: 24,

    zIndex: 10,

    flexDirection: 'row',
    alignItems: 'center',

    gap: 6,

    paddingVertical: 8,
    paddingHorizontal: 4,
  },

  content: {
    flex: 1,

    alignItems: 'center',
    justifyContent: 'center',

    paddingHorizontal: 24,
  },

  iconCircle: {
    width: 80,
    height: 80,

    borderRadius: 40,

    backgroundColor: PINK,

    alignItems: 'center',
    justifyContent: 'center',

    marginBottom: 20,
  },

  title: {
    fontFamily: 'FredokaBold',
    fontSize: 30,

    color: BROWN,

    marginBottom: 10,
  },

  description: {
    fontFamily: 'FredokaRegular',
    fontSize: 14,

    lineHeight: 21,

    color: MUTED,

    textAlign: 'center',

    marginBottom: 25,
  },

  statusCard: {
    width: '100%',

    backgroundColor: LIGHT_PINK,

    borderRadius: 18,

    padding: 20,

    alignItems: 'center',

    marginBottom: 20,
  },

  statusTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 17,

    color: BROWN,

    marginBottom: 6,
  },

  statusText: {
    fontFamily: 'FredokaRegular',
    fontSize: 14,

    color: MUTED,
  },

  recordingText: {
    color: BROWN,
    fontFamily: 'FredokaBold',
  },

  recordButton: {
    width: '100%',
    height: 58,

    borderRadius: 29,

    backgroundColor: BROWN,

    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',

    gap: 10,
  },

  stopButton: {
    opacity: 0.75,
  },

  recordButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 16,

    color: WHITE,
  },

  resultCard: {
    width: '100%',

    backgroundColor: PINK,

    borderRadius: 18,

    padding: 20,

    marginTop: 20,
  },

  resultTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 18,

    color: BROWN,

    marginBottom: 10,

    textAlign: 'center',
  },

  resultText: {
    fontFamily: 'FredokaRegular',
    fontSize: 13,

    color: BROWN,

    marginBottom: 4,

    textAlign: 'center',
  },
});