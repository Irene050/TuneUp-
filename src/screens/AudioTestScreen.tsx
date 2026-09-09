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

  const [isReceivingAudio, setIsReceivingAudio] =
    useState(false);

  const {
    startRecording,
    stopRecording,
    isRecording,
  } = useAudioRecorder({
    onFrame: (frame: LiveAudioFrame) => {
  console.log('🎤 AUDIO TEST FRAME:', frame);

  setLiveData(frame);

      /*
       * A volume value above -95 dB means
       * the recorder is currently receiving
       * a meaningful audio signal.
       */
      if (
        Number.isFinite(frame.volume) &&
        frame.volume > -95
      ) {
        setIsReceivingAudio(true);
      } else {
        setIsReceivingAudio(false);
      }
    },

    onStop: () => {
      setIsReceivingAudio(false);
    },
  });

  const handleStart = async () => {
    try {
      setLiveData(null);
      setIsReceivingAudio(false);

      await startRecording();
    } catch (error) {
      console.error(
        '❌ FAILED TO START AUDIO TEST:',
        error
      );
    }
  };

  const handleStop = async () => {
    try {
      await stopRecording();
    } catch (error) {
      console.error(
        '❌ FAILED TO STOP AUDIO TEST:',
        error
      );
    }
  };

  const detectedNote =
    liveData?.note &&
    liveData.note !== '--'
      ? liveData.note
      : '--';

  const clarity =
    liveData &&
    Number.isFinite(liveData.clarity)
      ? `${(
          liveData.clarity * 100
        ).toFixed(1)}%`
      : '--';

  const volume =
    liveData &&
    Number.isFinite(liveData.volume)
      ? `${liveData.volume.toFixed(1)} dB`
      : '--';

  const stability =
    liveData &&
    Number.isFinite(liveData.stability)
      ? `${liveData.stability.toFixed(1)}%`
      : '--';

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
    >
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

      {/* TITLE */}

      <Text style={styles.title}>
        Audio Test
      </Text>

      <Text style={styles.subtitle}>
        Sing or speak into the microphone to see
        your detected vocal information.
      </Text>

      {/* DETECTED NOTE */}

      <View style={styles.noteCard}>
        <Text style={styles.noteLabel}>
          Detected Note
        </Text>

        <Text style={styles.noteValue}>
          {detectedNote}
        </Text>

        {isRecording && (
          <View style={styles.listeningContainer}>
            <View
              style={[
                styles.listeningDot,
                isReceivingAudio &&
                  styles.listeningDotActive,
              ]}
            />

            <Text style={styles.listeningText}>
              {isReceivingAudio
                ? 'Listening'
                : 'Waiting for your voice'}
            </Text>
          </View>
        )}
      </View>

      {/* VOCAL INFORMATION */}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>
          Vocal Information
        </Text>

        {/* PITCH / FREQUENCY */}

<View style={styles.dataRow}>
  <View style={styles.rowLabelContainer}>
    <Ionicons
      name="musical-note-outline"
      size={20}
      color={BROWN}
    />

    <Text style={styles.label}>
      Pitch
    </Text>
  </View>

  <Text style={styles.value}>
    {liveData &&
    Number.isFinite(liveData.pitch) &&
    liveData.pitch > 0
      ? `${liveData.pitch.toFixed(1)} Hz`
      : '--'}
  </Text>
</View>

        {/* CLARITY */}

        <View style={styles.dataRow}>
          <View style={styles.rowLabelContainer}>
            <Ionicons
              name="scan-outline"
              size={20}
              color={BROWN}
            />

            <Text style={styles.label}>
              Clarity
            </Text>
          </View>

          <Text style={styles.value}>
            {clarity}
          </Text>
        </View>

        {/* VOLUME */}

        <View style={styles.dataRow}>
          <View style={styles.rowLabelContainer}>
            <Ionicons
              name="volume-medium-outline"
              size={20}
              color={BROWN}
            />

            <Text style={styles.label}>
              Volume
            </Text>
          </View>

          <Text style={styles.value}>
            {volume}
          </Text>
        </View>

        {/* STABILITY */}

        <View style={styles.dataRow}>
          <View style={styles.rowLabelContainer}>
            <Ionicons
              name="pulse-outline"
              size={20}
              color={BROWN}
            />

            <Text style={styles.label}>
              Stability
            </Text>
          </View>

          <Text style={styles.value}>
            {stability}
          </Text>
        </View>
      </View>

      {/* RECORDING STATE */}

      <View style={styles.recordingState}>
        <View
          style={[
            styles.recordingDot,
            isRecording &&
              styles.recordingDotActive,
          ]}
        />

        <Text style={styles.recordingText}>
          {isRecording
            ? 'Recording'
            : 'Ready to record'}
        </Text>
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
        <Ionicons
          name={
            isRecording
              ? 'stop'
              : 'mic'
          }
          size={22}
          color={WHITE}
        />

        <Text style={styles.buttonText}>
          {isRecording
            ? 'Stop Recording'
            : 'Start Recording'}
        </Text>
      </Pressable>

      <Text style={styles.helper}>
        Sing a comfortable note and hold it steadily
        for the most accurate detection.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: WHITE,
  },

  content: {
    padding: 24,
    paddingTop: 50,
    paddingBottom: 80,
  },

  /* BACK BUTTON */

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

  /* TITLE */

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

  /* NOTE CARD */

  noteCard: {
    backgroundColor: LIGHT_PINK,
    borderRadius: 24,
    paddingVertical: 30,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },

  noteLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 16,
    color: MUTED,
    marginBottom: 4,
  },

  noteValue: {
    fontFamily: 'FredokaBold',
    fontSize: 64,
    lineHeight: 76,
    color: BROWN,
  },

  /* LISTENING */

  listeningContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
  },

  listeningDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: LIGHT_GRAY,
    marginRight: 7,
  },

  listeningDotActive: {
    backgroundColor: PINK,
  },

  listeningText: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: MUTED,
  },

  /* VOCAL INFORMATION */

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
    marginBottom: 10,
  },

  dataRow: {
    minHeight: 55,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: LIGHT_GRAY,
  },

  rowLabelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
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

  /* RECORDING STATE */

  recordingState: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
    marginBottom: 12,
  },

  recordingDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: LIGHT_GRAY,
    marginRight: 8,
  },

  recordingDotActive: {
    backgroundColor: PINK,
  },

  recordingText: {
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    color: MUTED,
  },

  /* BUTTON */

  button: {
    height: 56,
    borderRadius: 28,
    backgroundColor: BROWN,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    marginTop: 5,
  },

  stopButton: {
    opacity: 0.75,
  },

  buttonText: {
    fontFamily: 'FredokaBold',
    fontSize: 17,
    color: WHITE,
  },

  /* HELPER */

  helper: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 17,
    color: MUTED,
    textAlign: 'center',
    marginTop: 18,
  },
});