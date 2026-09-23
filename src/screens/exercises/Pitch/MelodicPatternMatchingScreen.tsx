import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  MELODIC_PATTERN_MATCHING_PARAMS,
  Tier,
} from '@/constants/exercises/pitch';

import {
  LiveAudioFrame,
  useAudioRecorder,
} from '@/hooks/useAudioRecorder';

import {
  measureMelodicPatternMatching,
} from '@/services/measurement/pitch/melodicPatternMatching';

import {
  MelodicPatternScoreResult,
  scoreMelodicPatternMatching,
} from '@/services/scoring/pitch/melodicPatternMatching';

import {
  playSingleNote,
} from '@/services/assessment/notePlayer';

import {
  createMusicalNote,
  getRandomPitchNote,
} from '@/utils/music/notes';

import {
  frequencyToNote,
  segmentIntoNotes,
} from '@/utils/dsp/pitch';

import {
  saveCompletedExercise,
} from '@/services/progress/exerciseProgressService';

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const WHITE = '#FFFFFF';
const MUTED = '#8E7770';
const LIGHT_GRAY = '#F2F2F2';

const NOTE_DURATION_SEC = 0.7;
const NOTE_GAP_SEC = 0.12;

interface Props {
  tier?: Tier;
}

type Phase =
  | 'instructions'
  | 'countdown'
  | 'playing'
  | 'recording'
  | 'processing'
  | 'results';

export default function MelodicPatternMatchingScreen({
  tier = 'beginner',
}: Props) {
  const params =
    MELODIC_PATTERN_MATCHING_PARAMS[tier];

  const [phase, setPhase] =
    useState<Phase>('instructions');

  const [countdown, setCountdown] =
    useState(3);

  const [pattern, setPattern] =
    useState<
      ReturnType<typeof createMusicalNote>[]
    >([]);

  const [liveFrame, setLiveFrame] =
    useState<LiveAudioFrame | null>(null);

  const [elapsedMs, setElapsedMs] =
    useState(0);

  const [result, setResult] =
    useState<MelodicPatternScoreResult | null>(
      null
    );

  const [detectedNote, setDetectedNote] =
    useState('--');

  const [detectedPitchHz, setDetectedPitchHz] =
    useState(0);

  const [errorMessage, setErrorMessage] =
    useState<string | null>(null);

  const mountedRef =
    useRef(true);

  const countdownTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(
      null
    );

  const recordingTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(
      null
    );

  const recordingRef =
    useRef(false);

  const stopRequestedRef =
    useRef(false);

  const processingRef =
    useRef(false);

  const elapsedRef =
    useRef(0);

  const stopRecordingRef =
    useRef<
      (() => Promise<void>) | null
    >(null);

  const patternRef =
    useRef<
      ReturnType<typeof createMusicalNote>[]
    >([]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;

      if (countdownTimerRef.current) {
        clearInterval(
          countdownTimerRef.current
        );

        countdownTimerRef.current = null;
      }

      if (recordingTimerRef.current) {
        clearInterval(
          recordingTimerRef.current
        );

        recordingTimerRef.current = null;
      }

      if (recordingRef.current) {
        stopRecordingRef.current?.();
      }
    };
  }, []);

  const handleLiveFrame =
    useCallback(
      (frame: LiveAudioFrame) => {
        if (!mountedRef.current) {
          return;
        }

        setLiveFrame(frame);
      },
      []
    );

  const handleRecordingStop =
    useCallback(
      async (
        samples: Float32Array,
        sampleRate: number
      ) => {
        if (!mountedRef.current) {
          return;
        }

        if (processingRef.current) {
          return;
        }

        processingRef.current = true;
        recordingRef.current = false;

        if (recordingTimerRef.current) {
          clearInterval(
            recordingTimerRef.current
          );

          recordingTimerRef.current = null;
        }

        setPhase('processing');

        try {
          const currentPattern =
            patternRef.current;

          if (
            currentPattern.length === 0
          ) {
            throw new Error(
              'No melodic pattern is available.'
            );
          }

          const targetFreqs =
            currentPattern.map(
              (note) => note.frequency
            );

          const segmentDurationSec =
            NOTE_DURATION_SEC +
            NOTE_GAP_SEC;

          const targetTimestamps =
            currentPattern.map(
              (_, index) =>
                index *
                segmentDurationSec
            );

          const segments =
            segmentIntoNotes(
              samples,
              currentPattern.length,
              0.01,
              sampleRate
            );

          const measurement =
            measureMelodicPatternMatching(
              segments,
              sampleRate,
              targetTimestamps,
              params.minClarity
            );

          const score =
            scoreMelodicPatternMatching(
              measurement,
              targetFreqs,
              targetTimestamps,
              tier
            );

            await saveCompletedExercise(
  'pitch',
  'melodicPatternMatching',
  tier,
  score.score,
);

          setResult(score);

          const firstValidFrequency =
            measurement.detectedFreqs.find(
              (frequency) =>
                Number.isFinite(
                  frequency
                ) &&
                frequency > 0
            ) ?? 0;

          setDetectedPitchHz(
            firstValidFrequency
          );

          setDetectedNote(
            firstValidFrequency > 0
              ? frequencyToNote(
                  firstValidFrequency
                )
              : '--'
          );

          if (mountedRef.current) {
            setPhase('results');
          }
        } catch (error) {
          console.error(
            '❌ MELODIC PATTERN PROCESSING ERROR:',
            error
          );

          if (mountedRef.current) {
            setErrorMessage(
              'We could not analyze your recording. Please try again.'
            );

            setPhase(
              'instructions'
            );
          }
        } finally {
          processingRef.current = false;
          stopRequestedRef.current = false;
        }
      },
      [
        params.minClarity,
        tier,
      ]
    );

  const {
    startRecording,
    stopRecording,
    isRecording,
  } =
    useAudioRecorder({
      onFrame: handleLiveFrame,
      onStop: handleRecordingStop,
    });

  useEffect(() => {
    stopRecordingRef.current =
      stopRecording;

    return () => {
      stopRecordingRef.current = null;
    };
  }, [stopRecording]);

  const generatePattern =
    useCallback(() => {
      const generated: ReturnType<
        typeof createMusicalNote
      >[] = [];

      for (
        let i = 0;
        i < params.noteCount;
        i++
      ) {
        let note =
          getRandomPitchNote(tier);

        /*
         * Avoid immediately repeating
         * the exact same note.
         */
        if (
          generated.length > 0 &&
          note.name ===
            generated[
              generated.length - 1
            ].name
        ) {
          note =
            getRandomPitchNote(tier);
        }

        generated.push(note);
      }

      patternRef.current =
        generated;

      setPattern(generated);

      return generated;
    }, [
      params.noteCount,
      tier,
    ]);

  const wait =
    useCallback(
      (milliseconds: number) =>
        new Promise<void>(
          (resolve) =>
            setTimeout(
              resolve,
              milliseconds
            )
        ),
      []
    );

  const playGeneratedPattern =
    useCallback(
      async (
        generatedPattern: ReturnType<
          typeof createMusicalNote
        >[]
      ) => {
        for (
          let i = 0;
          i < generatedPattern.length;
          i++
        ) {
          if (!mountedRef.current) {
            return;
          }

          await playSingleNote(
            generatedPattern[i].frequency,
            NOTE_DURATION_SEC
          );

          if (
            i <
            generatedPattern.length - 1
          ) {
            await wait(
              NOTE_GAP_SEC * 1000
            );
          }
        }
      },
      [wait]
    );

  const beginRecording =
    useCallback(async () => {
      if (
        !mountedRef.current ||
        recordingRef.current ||
        processingRef.current
      ) {
        return;
      }

      try {
        setLiveFrame(null);

        elapsedRef.current = 0;
        setElapsedMs(0);

        stopRequestedRef.current = false;
        processingRef.current = false;

        setPhase('recording');

        await startRecording();

        if (!mountedRef.current) {
          return;
        }

        recordingRef.current = true;

        const patternDurationSec =
          params.noteCount *
            NOTE_DURATION_SEC +
          Math.max(
            0,
            params.noteCount - 1
          ) *
            NOTE_GAP_SEC;

        /*
         * Small allowance at the end gives the
         * singer enough time to finish the last
         * note before the recorder closes.
         */
        const recordingDurationMs =
          (patternDurationSec + 0.8) *
          1000;

        recordingTimerRef.current =
          setInterval(() => {
            if (
              !mountedRef.current ||
              !recordingRef.current ||
              stopRequestedRef.current
            ) {
              return;
            }

            elapsedRef.current += 100;

            setElapsedMs(
              elapsedRef.current
            );

            if (
              elapsedRef.current >=
              recordingDurationMs
            ) {
              if (
                recordingTimerRef.current
              ) {
                clearInterval(
                  recordingTimerRef.current
                );

                recordingTimerRef.current =
                  null;
              }

              if (
                stopRequestedRef.current
              ) {
                return;
              }

              stopRequestedRef.current =
                true;

              stopRecording().catch(
                (error) => {
                  console.error(
                    '❌ FAILED TO STOP MELODIC RECORDING:',
                    error
                  );

                  recordingRef.current =
                    false;

                  stopRequestedRef.current =
                    false;

                  if (
                    mountedRef.current
                  ) {
                    setErrorMessage(
                      'We could not finish the recording. Please try again.'
                    );

                    setPhase(
                      'instructions'
                    );
                  }
                }
              );
            }
          }, 100);
      } catch (error) {
        console.error(
          '❌ FAILED TO START MELODIC RECORDING:',
          error
        );

        recordingRef.current = false;
        stopRequestedRef.current = false;

        if (mountedRef.current) {
          setPhase('instructions');

          Alert.alert(
            'Microphone Error',
            'Unable to start the microphone. Please check your microphone permission and try again.'
          );
        }
      }
    }, [
      params.noteCount,
      startRecording,
      stopRecording,
    ]);

  const playPatternAndRecord =
    useCallback(
      async (
        generatedPattern: ReturnType<
          typeof createMusicalNote
        >[]
      ) => {
        if (!mountedRef.current) {
          return;
        }

        try {
          setPhase('playing');

          await playGeneratedPattern(
            generatedPattern
          );

          if (!mountedRef.current) {
            return;
          }

          await beginRecording();
        } catch (error) {
          console.error(
            '❌ FAILED TO PLAY MELODIC PATTERN:',
            error
          );

          if (mountedRef.current) {
            setErrorMessage(
              'Unable to play the melodic pattern. Please try again.'
            );

            setPhase(
              'instructions'
            );
          }
        }
      },
      [
        beginRecording,
        playGeneratedPattern,
      ]
    );

  const startCountdown =
    useCallback(() => {
      const generated =
        generatePattern();

      setResult(null);

      setErrorMessage(null);

      setLiveFrame(null);

      setDetectedNote('--');
      setDetectedPitchHz(0);

      elapsedRef.current = 0;
      setElapsedMs(0);

      processingRef.current = false;
      stopRequestedRef.current = false;
      recordingRef.current = false;

      if (
        countdownTimerRef.current
      ) {
        clearInterval(
          countdownTimerRef.current
        );

        countdownTimerRef.current =
          null;
      }

      setCountdown(3);
      setPhase('countdown');

      let value = 3;

      countdownTimerRef.current =
        setInterval(() => {
          value -= 1;

          if (value <= 0) {
            if (
              countdownTimerRef.current
            ) {
              clearInterval(
                countdownTimerRef.current
              );

              countdownTimerRef.current =
                null;
            }

            playPatternAndRecord(
              generated
            );

            return;
          }

          setCountdown(value);
        }, 1000);
    }, [
      generatePattern,
      playPatternAndRecord,
    ]);

  const retry =
    useCallback(() => {
      if (
        countdownTimerRef.current
      ) {
        clearInterval(
          countdownTimerRef.current
        );

        countdownTimerRef.current =
          null;
      }

      if (
        recordingTimerRef.current
      ) {
        clearInterval(
          recordingTimerRef.current
        );

        recordingTimerRef.current =
          null;
      }

      setResult(null);
      setPattern([]);

      patternRef.current = [];

      setDetectedNote('--');
      setDetectedPitchHz(0);

      setLiveFrame(null);

      elapsedRef.current = 0;
      setElapsedMs(0);

      processingRef.current = false;
      stopRequestedRef.current = false;
      recordingRef.current = false;

      setErrorMessage(null);

      setPhase('instructions');
    }, []);

  const patternDurationSec =
    params.noteCount *
      NOTE_DURATION_SEC +
    Math.max(
      0,
      params.noteCount - 1
    ) *
      NOTE_GAP_SEC;

  const progress =
    patternDurationSec > 0
      ? Math.min(
          1,
          elapsedMs /
            (patternDurationSec *
              1000)
        )
      : 0;

  // ============================================================
  // INSTRUCTIONS
  // ============================================================

  if (phase === 'instructions') {
    return (
      <View style={styles.screen}>
        <Pressable
          style={styles.backButton}
          onPress={() =>
            router.replace(
              '/dashboard/exercises'
            )
          }
        >
          <Ionicons
            name="arrow-back"
            size={22}
            color={BROWN}
          />
        </Pressable>

        <ScrollView
          showsVerticalScrollIndicator={
            false
          }
          contentContainerStyle={
            styles.content
          }
        >
          <View style={styles.iconCircle}>
            <Ionicons
              name="musical-notes-outline"
              size={34}
              color={BROWN}
            />
          </View>

          <Text style={styles.title}>
            Melodic Pattern Matching
          </Text>

          <Text style={styles.subtitle}>
            Pitch
          </Text>

          <View
            style={styles.instructionCard}
          >
            <View
              style={styles.prepareCard}
            >
              <View
                style={styles.prepareHeader}
              >
                <Ionicons
                  name="mic-outline"
                  size={21}
                  color={BROWN}
                />

                <Text
                  style={styles.prepareTitle}
                >
                  Before You Begin
                </Text>
              </View>

              <View
                style={styles.prepareItem}
              >
                <Ionicons
                  name="volume-mute-outline"
                  size={17}
                  color={BROWN}
                />

                <Text
                  style={styles.prepareText}
                >
                  Find a quiet room or area
                  with minimal background
                  noise.
                </Text>
              </View>

              <View
                style={styles.prepareItem}
              >
                <Ionicons
                  name="body-outline"
                  size={17}
                  color={BROWN}
                />

                <Text
                  style={styles.prepareText}
                >
                  Sit upright or stand with
                  your back straight and
                  your shoulders relaxed.
                </Text>
              </View>

              <View
                style={styles.prepareItem}
              >
                <Ionicons
                  name="mic-outline"
                  size={17}
                  color={BROWN}
                />

                <Text
                  style={styles.prepareText}
                >
                  Speak or sing toward the
                  microphone for clearer
                  audio capture.
                </Text>
              </View>
            </View>

            <Text
              style={styles.cardTitle}
            >
              Instructions
            </Text>

            <Text
              style={styles.instruction}
            >
              Listen carefully to the melodic
              pattern played by TuneUp!
            </Text>

            <Text
              style={styles.instruction}
            >
              Sing the same sequence of notes
              back in the same order.
            </Text>

            <Text
              style={styles.instruction}
            >
              Try to match each pitch while
              following the rhythm of the
              pattern.
            </Text>

            <View
              style={styles.targetBox}
            >
              <Ionicons
                name="musical-notes"
                size={25}
                color={BROWN}
              />

              <Text
                style={styles.targetText}
              >
                Match the melody
              </Text>
            </View>

            <Text
              style={styles.helperText}
            >
              TuneUp! evaluates the accuracy
              of each note and how closely
              your timing follows the pattern.
            </Text>
          </View>

          <View style={styles.tipCard}>
            <Ionicons
              name="bulb-outline"
              size={21}
              color={BROWN}
            />

            <Text style={styles.tipText}>
              Listen to the whole pattern
              before trying to reproduce it.
            </Text>
          </View>

          <View
            style={styles.difficultyRow}
          >
            <Text
              style={styles.difficultyLabel}
            >
              Difficulty
            </Text>

            <Text
              style={styles.difficultyValue}
            >
              {tier}
            </Text>
          </View>

          <View
            style={styles.difficultyRow}
          >
            <Text
              style={styles.difficultyLabel}
            >
              Pattern Length
            </Text>

            <Text
              style={styles.difficultyValue}
            >
              {params.noteCount} notes
            </Text>
          </View>

          <View
            style={styles.difficultyRow}
          >
            <Text
              style={styles.difficultyLabel}
            >
              Pitch Tolerance
            </Text>

            <Text
              style={styles.difficultyValue}
            >
              ±{params.tolerancePct}%
            </Text>
          </View>

          <Pressable
            style={styles.startButton}
            onPress={startCountdown}
          >
            <Text
              style={styles.startButtonText}
            >
              Start Exercise
            </Text>

            <Ionicons
              name="arrow-forward"
              size={18}
              color={WHITE}
            />
          </Pressable>

          {errorMessage && (
            <Text
              style={styles.errorText}
            >
              {errorMessage}
            </Text>
          )}
        </ScrollView>
      </View>
    );
  }

  // ============================================================
  // COUNTDOWN
  // ============================================================

  if (phase === 'countdown') {
    return (
      <View
        style={styles.centerScreen}
      >
        <View style={styles.iconCircle}>
          <Ionicons
            name="musical-notes-outline"
            size={34}
            color={BROWN}
          />
        </View>

        <Text
          style={styles.phaseTitle}
        >
          Get Ready
        </Text>

        <Text
          style={styles.countdownText}
        >
          {countdown}
        </Text>

        <Text
          style={styles.phaseSubtitle}
        >
          Listen carefully to the pattern
          that will play next.
        </Text>
      </View>
    );
  }

  // ============================================================
  // PLAYING
  // ============================================================

  if (phase === 'playing') {
    return (
      <View
        style={styles.centerScreen}
      >
        <View style={styles.iconCircle}>
          <Ionicons
            name="volume-high-outline"
            size={34}
            color={BROWN}
          />
        </View>

        <Text
          style={styles.phaseTitle}
        >
          Listen Carefully
        </Text>

        <Text
          style={styles.phaseSubtitle}
        >
          Remember the order and direction
          of the notes.
        </Text>

        <View
          style={styles.patternCard}
        >
          <Text
            style={styles.patternLabel}
          >
            MELODIC PATTERN
          </Text>

          <View
            style={styles.patternRow}
          >
            {pattern.map(
              (note, index) => (
                <View
                  key={`${note.name}-${index}`}
                  style={
                    styles.patternNote
                  }
                >
                  <Text
                    style={
                      styles.patternNoteText
                    }
                  >
                    {note.name}
                  </Text>
                </View>
              )
            )}
          </View>

          <Text
            style={styles.patternHelper}
          >
            {pattern.length} notes
          </Text>
        </View>

        <ActivityIndicator
          size="small"
          color={BROWN}
          style={
            styles.playingIndicator
          }
        />
      </View>
    );
  }

  // ============================================================
  // RECORDING
  // ============================================================

  if (phase === 'recording') {
    return (
      <View
        style={styles.centerScreen}
      >
        <View
          style={styles.recordingIcon}
        >
          <Ionicons
            name="mic"
            size={34}
            color={BROWN}
          />
        </View>

        <Text
          style={styles.phaseTitle}
        >
          Sing the Pattern
        </Text>

        <Text
          style={styles.phaseSubtitle}
        >
          Match the notes in the same order.
        </Text>

        <View
          style={styles.liveCard}
        >
          <Text
            style={styles.liveLabel}
          >
            LIVE PITCH
          </Text>

          <Text
            style={styles.liveNote}
          >
            {liveFrame?.note ?? '--'}
          </Text>

          <Text
            style={styles.liveFrequency}
          >
            {liveFrame &&
            liveFrame.pitch > 0
              ? `${Math.round(
                  liveFrame.pitch
                )} Hz`
              : '--'}
          </Text>

          <View
            style={styles.liveStats}
          >
            <View
              style={styles.liveStat}
            >
              <Text
                style={styles.liveStatLabel}
              >
                Notes
              </Text>

              <Text
                style={styles.liveStatValue}
              >
                {params.noteCount}
              </Text>
            </View>

            <View
              style={styles.liveStat}
            >
              <Text
                style={styles.liveStatLabel}
              >
                Tolerance
              </Text>

              <Text
                style={styles.liveStatValue}
              >
                ±{params.tolerancePct}%
              </Text>
            </View>
          </View>
        </View>

        <View
          style={styles.patternPreview}
        >
          {pattern.map(
            (note, index) => (
              <View
                key={`${note.name}-preview-${index}`}
                style={
                  styles.previewNote
                }
              >
                <Text
                  style={
                    styles.previewNoteText
                  }
                >
                  {note.name}
                </Text>
              </View>
            )
          )}
        </View>

        <View
          style={styles.progressContainer}
        >
          <View
            style={styles.progressTrack}
          >
            <View
              style={[
                styles.progressFill,
                {
                  width: `${progress * 100}%`,
                },
              ]}
            />
          </View>

          <Text
            style={styles.progressText}
          >
            {(elapsedMs / 1000).toFixed(1)}s
          </Text>
        </View>

        <View
          style={styles.recordingIndicator}
        >
          <View
            style={styles.recordingDot}
          />

          <Text
            style={styles.recordingText}
          >
            {isRecording
              ? 'Recording...'
              : 'Preparing microphone...'}
          </Text>
        </View>
      </View>
    );
  }

  // ============================================================
  // PROCESSING
  // ============================================================

  if (phase === 'processing') {
    return (
      <View
        style={styles.centerScreen}
      >
        <View style={styles.iconCircle}>
          <Ionicons
            name="analytics-outline"
            size={34}
            color={BROWN}
          />
        </View>

        <Text
          style={styles.phaseTitle}
        >
          Analyzing Your Singing
        </Text>

        <Text
          style={styles.phaseSubtitle}
        >
          Checking your note accuracy and
          melodic timing.
        </Text>

        <ActivityIndicator
          size="large"
          color={BROWN}
          style={
            styles.processingIndicator
          }
        />
      </View>
    );
  }

  // ============================================================
  // RESULTS
  // ============================================================

  if (
    phase === 'results' &&
    result
  ) {
    return (
      <View style={styles.screen}>
        <ScrollView
          showsVerticalScrollIndicator={
            false
          }
          contentContainerStyle={
            styles.resultsContent
          }
        >
          <View
            style={[
              styles.resultIcon,
              result.passed
                ? styles.resultIconPassed
                : styles.resultIconFailed,
            ]}
          >
            <Ionicons
              name={
                result.passed
                  ? 'checkmark'
                  : 'refresh'
              }
              size={40}
              color={BROWN}
            />
          </View>

          <Text
            style={styles.resultTitle}
          >
            {result.passed
              ? 'Great Job!'
              : 'Keep Practicing!'}
          </Text>

          <Text
            style={styles.resultSubtitle}
          >
            Melodic Pattern Matching Result
          </Text>

          <View
            style={styles.scoreCard}
          >
            <Text
              style={styles.scoreLabel}
            >
              Overall Score
            </Text>

            <Text
              style={styles.scoreValue}
            >
              {result.score}%
            </Text>

            <Text
              style={styles.scoreDescription}
            >
              {result.passed
                ? 'You matched most of the melodic pattern accurately.'
                : 'Focus on matching each note more accurately and following the pattern closely.'}
            </Text>
          </View>

          <View
            style={styles.resultCard}
          >
            <Text
              style={styles.resultCardTitle}
            >
              Target Pattern
            </Text>

            <View
              style={styles.resultPatternRow}
            >
              {pattern.map(
                (note, index) => (
                  <View
                    key={`${note.name}-result-${index}`}
                    style={
                      styles.resultPatternNote
                    }
                  >
                    <Text
                      style={
                        styles.resultPatternNoteText
                      }
                    >
                      {note.name}
                    </Text>
                  </View>
                )
              )}
            </View>
          </View>

          <View
            style={styles.resultCard}
          >
            <Text
              style={styles.resultCardTitle}
            >
              Your Performance
            </Text>

            <View style={styles.resultRow}>
              <Text
                style={styles.resultRowLabel}
              >
                First detected note
              </Text>

              <Text
                style={styles.resultRowValue}
              >
                {detectedNote}
              </Text>
            </View>

            <View style={styles.resultRow}>
              <Text
                style={styles.resultRowLabel}
              >
                First detected frequency
              </Text>

              <Text
                style={styles.resultRowValue}
              >
                {detectedPitchHz > 0
                  ? `${Math.round(
                      detectedPitchHz
                    )} Hz`
                  : '--'}
              </Text>
            </View>

            <View style={styles.resultRow}>
              <Text
                style={styles.resultRowLabel}
              >
                Pattern accuracy
              </Text>

              <Text
                style={styles.resultRowValue}
              >
                {Math.round(
                  result.patternAccuracy
                )}
                %
              </Text>
            </View>

            <View style={styles.resultRow}>
              <Text
                style={styles.resultRowLabel}
              >
                Timing accuracy
              </Text>

              <Text
                style={styles.resultRowValue}
              >
                {Math.round(
                  result.rhythmAccuracy
                )}
                %
              </Text>
            </View>

            <View style={styles.resultRow}>
              <Text
                style={styles.resultRowLabel}
              >
                Notes matched
              </Text>

              <Text
                style={styles.resultRowValue}
              >
                {
                  result.notesHit.filter(
                    Boolean
                  ).length
                } / {params.noteCount}
              </Text>
            </View>
          </View>

          <View
            style={styles.noteResultsCard}
          >
            <Text
              style={styles.resultCardTitle}
            >
              Note Results
            </Text>

            <View
              style={styles.noteResultsRow}
            >
              {result.notesHit.map(
                (hit, index) => (
                  <View
                    key={`note-result-${index}`}
                    style={
                      styles.noteResultItem
                    }
                  >
                    <View
                      style={[
                        styles.noteResultCircle,
                        hit
                          ? styles.noteResultCorrect
                          : styles.noteResultIncorrect,
                      ]}
                    >
                      <Ionicons
                        name={
                          hit
                            ? 'checkmark'
                            : 'close'
                        }
                        size={16}
                        color={BROWN}
                      />
                    </View>

                    <Text
                      style={
                        styles.noteResultLabel
                      }
                    >
                      {index + 1}
                    </Text>
                  </View>
                )
              )}
            </View>
          </View>

          <View style={styles.tipCard}>
            <Ionicons
              name="bulb-outline"
              size={21}
              color={BROWN}
            />

            <Text style={styles.tipText}>
              {result.passed
                ? 'Nice work! Continue practicing short melodic patterns to improve pitch memory and accuracy.'
                : 'Listen carefully to each note and practice the pattern more slowly before increasing speed.'}
            </Text>
          </View>

          <Pressable
            style={styles.startButton}
            onPress={retry}
          >
            <Text
              style={styles.startButtonText}
            >
              Try Again
            </Text>

            <Ionicons
              name="refresh"
              size={18}
              color={WHITE}
            />
          </Pressable>

          <Pressable
            style={styles.doneButton}
            onPress={() =>
              router.replace(
                '/dashboard/exercises'
              )
            }
          >
            <Text
              style={styles.doneButtonText}
            >
              Done
            </Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: WHITE,
  },

  centerScreen: {
    flex: 1,
    backgroundColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },

  content: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 100,
    paddingBottom: 60,
    alignItems: 'center',
  },

  resultsContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 80,
    paddingBottom: 50,
    alignItems: 'center',
  },

  backButton: {
    position: 'absolute',
    top: 55,
    left: 24,
    zIndex: 10,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },

  iconCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },

  title: {
    fontFamily: 'FredokaBold',
    fontSize: 28,
    color: BROWN,
    textAlign: 'center',
  },

  subtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: MUTED,
    marginTop: 3,
    marginBottom: 24,
  },

  instructionCard: {
    width: '100%',
    backgroundColor: LIGHT_PINK,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#F2DDE5',
  },

  prepareCard: {
    width: '100%',
    backgroundColor: PINK,
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#F2DDE5',
  },

  prepareHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },

  prepareTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 16,
    color: BROWN,
    marginLeft: 9,
  },

  prepareItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 8,
  },

  prepareText: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 17,
    color: BROWN,
    marginLeft: 9,
  },

  cardTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 19,
    color: BROWN,
    marginBottom: 14,
  },

  instruction: {
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    lineHeight: 20,
    color: BROWN,
    marginBottom: 10,
  },

  targetBox: {
    backgroundColor: PINK,
    borderRadius: 14,
    paddingVertical: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginVertical: 8,
  },

  targetText: {
    fontFamily: 'FredokaBold',
    fontSize: 18,
    color: BROWN,
  },

  helperText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 17,
    color: MUTED,
    textAlign: 'center',
    marginTop: 6,
  },

  tipCard: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: PINK,
    borderRadius: 15,
    padding: 14,
    marginTop: 14,
  },

  tipText: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 16,
    color: BROWN,
    marginLeft: 10,
  },

  difficultyRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
  },

  difficultyLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
  },

  difficultyValue: {
    fontFamily: 'FredokaBold',
    fontSize: 13,
    color: BROWN,
    textTransform: 'capitalize',
  },

  startButton: {
    width: '100%',
    height: 54,
    borderRadius: 27,
    backgroundColor: BROWN,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 20,
  },

  startButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: WHITE,
  },

  errorText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    textAlign: 'center',
    marginTop: 12,
  },

  phaseTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 25,
    color: BROWN,
    textAlign: 'center',
  },

  phaseSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    lineHeight: 20,
    color: MUTED,
    textAlign: 'center',
    marginTop: 8,
  },

  countdownText: {
    fontFamily: 'FredokaBold',
    fontSize: 72,
    color: BROWN,
    marginTop: 20,
  },

  patternCard: {
    width: '100%',
    backgroundColor: LIGHT_PINK,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#F2DDE5',
    padding: 20,
    marginTop: 26,
    alignItems: 'center',
  },

  patternLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
    letterSpacing: 0.5,
  },

  patternRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 9,
    marginTop: 15,
  },

  patternNote: {
    minWidth: 58,
    paddingHorizontal: 10,
    paddingVertical: 12,
    borderRadius: 15,
    backgroundColor: PINK,
    alignItems: 'center',
  },

  patternNoteText: {
    fontFamily: 'FredokaBold',
    fontSize: 18,
    color: BROWN,
  },

  patternHelper: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    marginTop: 12,
  },

  playingIndicator: {
    marginTop: 24,
  },

  recordingIcon: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },

  liveCard: {
    width: '100%',
    backgroundColor: LIGHT_PINK,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#F2DDE5',
    padding: 20,
    marginTop: 25,
    alignItems: 'center',
  },

  liveLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
    letterSpacing: 0.5,
  },

  liveNote: {
    fontFamily: 'FredokaBold',
    fontSize: 34,
    color: BROWN,
    marginTop: 4,
  },

  liveFrequency: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    marginTop: 2,
  },

  liveStats: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 18,
  },

  liveStat: {
    alignItems: 'center',
  },

  liveStatLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
  },

  liveStatValue: {
    fontFamily: 'FredokaBold',
    fontSize: 17,
    color: BROWN,
    marginTop: 2,
  },

  patternPreview: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 7,
    marginTop: 16,
  },

  previewNote: {
    minWidth: 42,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: PINK,
    alignItems: 'center',
  },

  previewNoteText: {
    fontFamily: 'FredokaBold',
    fontSize: 13,
    color: BROWN,
  },

  progressContainer: {
    width: '100%',
    marginTop: 20,
    alignItems: 'center',
  },

  progressTrack: {
    width: '100%',
    height: 9,
    borderRadius: 5,
    backgroundColor: LIGHT_GRAY,
    overflow: 'hidden',
  },

  progressFill: {
    height: '100%',
    backgroundColor: PINK,
    borderRadius: 5,
  },

  progressText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    marginTop: 7,
  },

  recordingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
  },

  recordingDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: BROWN,
    marginRight: 7,
  },

  recordingText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
  },

  processingIndicator: {
    marginTop: 28,
  },

  resultIcon: {
    width: 82,
    height: 82,
    borderRadius: 41,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },

  resultIconPassed: {
    backgroundColor: PINK,
  },

  resultIconFailed: {
    backgroundColor: LIGHT_GRAY,
  },

  resultTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 27,
    color: BROWN,
    textAlign: 'center',
  },

  resultSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: MUTED,
    marginTop: 3,
    marginBottom: 22,
    textAlign: 'center',
  },

  scoreCard: {
    width: '100%',
    backgroundColor: PINK,
    borderRadius: 22,
    padding: 22,
    alignItems: 'center',
  },

  scoreLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: BROWN,
  },

  scoreValue: {
    fontFamily: 'FredokaBold',
    fontSize: 52,
    color: BROWN,
    marginVertical: 3,
  },

  scoreDescription: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    textAlign: 'center',
  },

  resultCard: {
    width: '100%',
    backgroundColor: LIGHT_PINK,
    borderRadius: 20,
    padding: 18,
    marginTop: 14,
    borderWidth: 1,
    borderColor: '#F2DDE5',
  },

  resultCardTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 17,
    color: BROWN,
    marginBottom: 10,
  },

  resultPatternRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },

  resultPatternNote: {
    minWidth: 48,
    paddingHorizontal: 9,
    paddingVertical: 9,
    borderRadius: 13,
    backgroundColor: PINK,
    alignItems: 'center',
  },

  resultPatternNoteText: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: BROWN,
  },

  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },

  resultRowLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    flex: 1,
  },

  resultRowValue: {
    fontFamily: 'FredokaBold',
    fontSize: 13,
    color: BROWN,
    marginLeft: 12,
  },

  noteResultsCard: {
    width: '100%',
    backgroundColor: LIGHT_PINK,
    borderRadius: 20,
    padding: 18,
    marginTop: 14,
    borderWidth: 1,
    borderColor: '#F2DDE5',
  },

  noteResultsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 16,
  },

  noteResultItem: {
    alignItems: 'center',
  },

  noteResultCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },

  noteResultCorrect: {
    backgroundColor: PINK,
  },

  noteResultIncorrect: {
    backgroundColor: LIGHT_GRAY,
  },

  noteResultLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
    marginTop: 4,
  },

  doneButton: {
    width: '100%',
    height: 50,
    borderRadius: 25,
    backgroundColor: LIGHT_GRAY,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },

  doneButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 14,
    color: BROWN,
  },
});