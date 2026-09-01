import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';

import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  LiveAudioFrame,
  useAudioRecorder,
} from '@/hooks/useAudioRecorder';

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const WHITE = '#FFFFFF';
const MUTED = '#8E7770';
const LIGHT_GRAY = '#F2F2F2';

export default function AudioTestScreen() {
  const [liveData, setLiveData] =
    useState<LiveAudioFrame | null>(null);

  const [recordedSamples, setRecordedSamples] =
    useState(0);

  const {
    startRecording,
    stopRecording,
    isRecording,
  } = useAudioRecorder({
    onFrame: (frame: LiveAudioFrame) => {
      /*
       * This receives ONE live audio frame.
       *
       * The recorder is still keeping the complete
       * recording internally for onStop().
       */
      setLiveData(frame);
    },

    onStop: (
      samples: Float32Array,
      sampleRate: number
    ) => {
      console.log(
        'FINAL RECORDING:',
        samples.length,
        'samples'
      );

      console.log(
        'SAMPLE RATE:',
        sampleRate
      );

      setRecordedSamples(
        samples.length
      );
    },
  });

  const handleStart = async () => {
    try {
      setLiveData(null);
      setRecordedSamples(0);

      await startRecording();
    } catch (error) {
      console.error(
        'Failed to start recording:',
        error
      );
    }
  };

  const handleStop = async () => {
    try {
      await stopRecording();
    } catch (error) {
      console.error(
        'Failed to stop recording:',
        error
      );
    }
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
    >
<Pressable
          style={
            styles.backButton
          }
          onPress={() =>
            router.back()
          }
        >
          <Ionicons
            name="arrow-back"
            size={22}
            color={BROWN}
          />
        </Pressable>

      <Text style={styles.title}>
        Audio Test
      </Text>

      <Text style={styles.subtitle}>
        Speak or sing into the microphone and
        watch the audio data update in real time.
      </Text>

      {/* LIVE DATA */}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>
          Live Audio
        </Text>

        <View style={styles.dataRow}>
          <Text style={styles.label}>
            Pitch
          </Text>

          <Text style={styles.value}>
            {liveData
              ? `${liveData.pitch.toFixed(1)} Hz`
              : '--'}
          </Text>
        </View>

        <View style={styles.dataRow}>
          <Text style={styles.label}>
            Note
          </Text>

          <Text style={styles.value}>
            {liveData?.note ?? '--'}
          </Text>
        </View>

        <View style={styles.dataRow}>
          <Text style={styles.label}>
            Clarity
          </Text>

          <Text style={styles.value}>
            {liveData
              ? `${(
                  liveData.clarity * 100
                ).toFixed(1)}%`
              : '--'}
          </Text>
        </View>

        <View style={styles.dataRow}>
          <Text style={styles.label}>
            Volume
          </Text>

          <Text style={styles.value}>
            {liveData
              ? `${liveData.volume.toFixed(1)} dB`
              : '--'}
          </Text>
        </View>

        <View style={styles.dataRow}>
          <Text style={styles.label}>
            Stability
          </Text>

          <Text style={styles.value}>
            {liveData
              ? `${liveData.stability.toFixed(1)}%`
              : '--'}
          </Text>
        </View>
      </View>

      {/* RAW AUDIO INFORMATION */}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>
          Recording
        </Text>

        <View style={styles.dataRow}>
          <Text style={styles.label}>
            Status
          </Text>

          <Text style={styles.value}>
            {isRecording
              ? 'Recording'
              : 'Stopped'}
          </Text>
        </View>

        <View style={styles.dataRow}>
          <Text style={styles.label}>
            Samples captured
          </Text>

          <Text style={styles.value}>
            {recordedSamples.toLocaleString()}
          </Text>
        </View>
      </View>

      {/* BUTTON */}

      <Pressable
        style={[
          styles.button,
          isRecording &&
            styles.stopButton,
        ]}
        onPress={
          isRecording
            ? handleStop
            : handleStart
        }
      >
        <Text style={styles.buttonText}>
          {isRecording
            ? 'Stop Recording'
            : 'Start Recording'}
        </Text>
      </Pressable>

      <Text style={styles.helper}>
        The live values are calculated from
        incoming microphone frames while the
        complete audio recording is preserved
        for final assessment processing.
      </Text>
    </ScrollView>
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
    padding: 24,
    paddingTop: 50,
    paddingBottom: 80,
  },

  title: {
    fontFamily: 'FredokaBold',
    fontSize: 30,
    color: BROWN,
    textAlign: 'center',
    marginBottom: 8,
  },

  subtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 14,
    lineHeight: 21,
    color: MUTED,
    textAlign: 'center',
    marginBottom: 25,
  },

  card: {
    backgroundColor: LIGHT_PINK,
    borderRadius: 20,
    padding: 20,
    marginBottom: 18,
  },

  cardTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 19,
    color: BROWN,
    marginBottom: 15,
  },

  dataRow: {
    minHeight: 45,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: LIGHT_GRAY,
  },

  label: {
    fontFamily: 'FredokaRegular',
    fontSize: 14,
    color: MUTED,
  },

  value: {
    fontFamily: 'FredokaBold',
    fontSize: 16,
    color: BROWN,
  },

  button: {
    height: 56,
    borderRadius: 28,
    backgroundColor: BROWN,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },

  stopButton: {
    opacity: 0.75,
  },

  buttonText: {
    fontFamily: 'FredokaBold',
    fontSize: 17,
    color: WHITE,
  },

  helper: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 17,
    color: MUTED,
    textAlign: 'center',
    marginTop: 18,
  },
});