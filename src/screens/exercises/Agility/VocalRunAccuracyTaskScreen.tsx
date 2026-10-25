import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { AudioContext, AudioManager, AudioRecorder } from 'react-native-audio-api';

import { type Tier } from '@/constants/agility';
import { generateVocalRunAccuracyParams } from '@/services/adaptiveDifficultyScaling/parameterGenerator';
import { getLatestAssessment } from '@/services/assessment/assessmentRepository';
import { auth } from '@/services/firebase/config';
import { measureVocalRunAccuracy } from '@/services/measurement/agility/vocalRunAccuracyTask';
import { saveCompletedExercise } from '@/services/progress/exerciseProgressService';
import { fetchComponentProgress, fetchExerciseRecords } from '@/services/progress/progressRepo';
import { scoreVocalRunAccuracy } from '@/services/scoring/agility/vocalRunAccuracyTask';
import { detectPitchAutocorrelation } from '@/utils/dsp/agility';
import { frequencyToNoteName } from '@/utils/music/notes';

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const WHITE = '#FFFFFF';
const MUTED = '#8E7770';
const LIGHT_GRAY = '#F2F2F2';
const BORDER = '#F2DDE5';
const GREEN = '#39734A';
const RED = '#A04444';
const SAMPLE_RATE = 44100;
const BUFFER_SIZE = 4410;
const COUNTDOWN_SECONDS = 3;

type Phase = 'instructions' | 'reference' | 'loading' | 'countdown' | 'recording' | 'processing' | 'results';
type VocalRange = { lowHz: number; highHz: number };
type Config = ReturnType<typeof generateVocalRunAccuracyParams>;
type LivePitch = { note: string; frequency: number };
type ExerciseResult = {
  overall: number; pitchScore: number; sequenceScore: number; transitionScore: number;
  passed: boolean; feedback: string; noteCount: number; correctNoteCount: number;
  transitionCount: number; correctTransitionCount: number; notesPerSecond: number;
  durationMs: number; repetitionsCompleted: number;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
function isValidTier(value: unknown): value is Tier {
  return value === 'beginner' || value === 'intermediate' || value === 'advanced';
}
function isValidVocalRange(range: VocalRange | null | undefined): range is VocalRange {
  return !!range && Number.isFinite(range.lowHz) && Number.isFinite(range.highHz) && range.lowHz > 0 && range.highHz > range.lowHz;
}
function getRecentVocalRunScores(records: Awaited<ReturnType<typeof fetchExerciseRecords>>, tier: Tier): number[] {
  return records
    .filter((exercise) => exercise.templateId === 'vocalRunAccuracy' && exercise.tier === tier)
    .slice(-5)
    .map((exercise) => exercise.scorePct)
    .filter((score) => Number.isFinite(score) && score >= 0 && score <= 100);
}
function getTimedTargetNoteIndex(elapsedSeconds: number, targetNoteCount: number, noteDurationSec: number, gapSec: number): number | null {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0 || targetNoteCount <= 0 || !Number.isFinite(noteDurationSec) || noteDurationSec <= 0) return null;
  const cycle = noteDurationSec + Math.max(0, Number.isFinite(gapSec) ? gapSec : 0);
  const index = Math.floor(elapsedSeconds / cycle);
  if (index >= targetNoteCount) return null;
  return elapsedSeconds - index * cycle < noteDurationSec ? index : null;
}
function getSequenceDurationSeconds(noteCount: number, noteDurationSec: number, gapSec: number): number {
  if (noteCount <= 0 || !Number.isFinite(noteDurationSec) || noteDurationSec <= 0) return 0.1;
  return noteCount * noteDurationSec + Math.max(0, noteCount - 1) * Math.max(0, Number.isFinite(gapSec) ? gapSec : 0);
}

export default function VocalRunAccuracyTaskScreen() {
  const [tier, setTier] = useState<Tier>('beginner');
  const [tierLoading, setTierLoading] = useState(true);
  const [adaptiveConfig, setAdaptiveConfig] = useState<Config | null>(null);
  const [isLoadingAdaptiveParams, setIsLoadingAdaptiveParams] = useState(true);
  const [phase, setPhase] = useState<Phase>('instructions');
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [recordingTime, setRecordingTime] = useState(0);
  const [currentRepetition, setCurrentRepetition] = useState(1);
  const [result, setResult] = useState<ExerciseResult | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [livePitch, setLivePitch] = useState<LivePitch | null>(null);
  const [isPlayingReference, setIsPlayingReference] = useState(false);
  const [activeReferenceNoteIndex, setActiveReferenceNoteIndex] = useState<number | null>(null);
  const [confirmationType, setConfirmationType] = useState<'quit' | 'retry' | null>(null);

  const mountedRef = useRef(true);
  const recentScoresRef = useRef<number[]>([]);
  const vocalRangeRef = useRef<VocalRange | null>(null);
  const phaseRef = useRef<Phase>('instructions');
  const audioContextRef = useRef<AudioContext | null>(null);
  const recorderRef = useRef<AudioRecorder | null>(null);
  const samplesRef = useRef<number[]>([]);
  const measurementsRef = useRef<ReturnType<typeof measureVocalRunAccuracy>[]>([]);
  const recordingStartRef = useRef<number | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const processingRef = useRef(false);
  const exerciseRunIdRef = useRef(0);
  const countdownRunIdRef = useRef(0);
  const referencePlaybackIdRef = useRef(0);
  const referencePlayingRef = useRef(false);

  const setExercisePhase = useCallback((next: Phase) => { phaseRef.current = next; setPhase(next); }, []);
  const clearRecordingTimer = useCallback(() => {
    if (recordingTimerRef.current !== null) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
  }, []);
  const stopRecording = useCallback(() => {
    clearRecordingTimer();
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder) {
      try { recorder.clearOnAudioReady(); } catch {}
      try { void recorder.stop(); } catch {}
    }
    recordingStartRef.current = null;
    try { void AudioManager.setAudioSessionActivity(false); } catch {}
  }, [clearRecordingTimer]);
  const cancelReferencePlayback = useCallback(() => {
    referencePlaybackIdRef.current += 1;
    referencePlayingRef.current = false;
    if (mountedRef.current) { setIsPlayingReference(false); setActiveReferenceNoteIndex(null); }
  }, []);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (confirmationType !== null) return true;
      countdownRunIdRef.current += 1;
      cancelReferencePlayback();
      if (phaseRef.current === 'countdown' || phaseRef.current === 'recording') stopRecording();
      setConfirmationType('quit');
      return true;
    });
    return () => subscription.remove();
  }, [cancelReferencePlayback, confirmationType, stopRecording]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      exerciseRunIdRef.current += 1;
      countdownRunIdRef.current += 1;
      referencePlaybackIdRef.current += 1;
      referencePlayingRef.current = false;
      stopRecording();
      const context = audioContextRef.current;
      audioContextRef.current = null;
      if (context) { try { void context.close(); } catch {} }
    };
  }, [stopRecording]);

  useEffect(() => {
    let cancelled = false;
    const loadTier = async () => {
      const user = auth.currentUser;
      if (!user) { if (!cancelled) { setTier('beginner'); setTierLoading(false); } return; }
      try {
        const progress = await fetchComponentProgress(user.uid, 'agility');
        if (!cancelled) setTier(isValidTier(progress?.currentTier) ? progress.currentTier : 'beginner');
      } catch (error) {
        console.warn('Failed to load agility component tier:', error);
        if (!cancelled) setTier('beginner');
      } finally { if (!cancelled) setTierLoading(false); }
    };
    void loadTier();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (tierLoading) return;
    let cancelled = false;
    const loadAdaptiveParameters = async () => {
      setIsLoadingAdaptiveParams(true);
      let recentScores: number[] = [];
      let vocalRange: VocalRange | null = null;
      const user = auth.currentUser;
      if (user) {
        try {
          const records = await fetchExerciseRecords(user.uid, 'agility');
          recentScores = getRecentVocalRunScores(records, tier);
        } catch (error) { console.warn('Failed to load Vocal Run Accuracy score history:', error); }
        if (cancelled) return;
        try {
          const assessment = await getLatestAssessment();
          const lowHz = assessment?.vocalRange?.lowHz ?? assessment?.vocalRangeLowHz;
          const highHz = assessment?.vocalRange?.highHz ?? assessment?.vocalRangeHighHz;
          if (typeof lowHz === 'number' && typeof highHz === 'number' && isValidVocalRange({ lowHz, highHz })) {
            vocalRange = { lowHz, highHz };
          }
        } catch (error) { console.warn('Failed to load assessment vocal range:', error); }
      }
      if (cancelled) return;
      recentScoresRef.current = recentScores;
      vocalRangeRef.current = vocalRange;
      const generated = generateVocalRunAccuracyParams({ tier, recentScores, vocalRange });
      if (!cancelled) { setAdaptiveConfig(generated); setIsLoadingAdaptiveParams(false); }
    };
    void loadAdaptiveParameters().catch((error) => {
      console.warn('Failed to generate Vocal Run Accuracy parameters:', error);
      if (!cancelled) {
        const fallback = generateVocalRunAccuracyParams({ tier, recentScores: recentScoresRef.current, vocalRange: vocalRangeRef.current });
        setAdaptiveConfig(fallback);
        setIsLoadingAdaptiveParams(false);
      }
    });
    return () => { cancelled = true; };
  }, [tier, tierLoading]);

  const config = adaptiveConfig;
  const hasValidGeneratedSequence = !!config && isValidVocalRange(vocalRangeRef.current) && config.frequencies.length >= 3 && config.frequencies.every((frequency) => Number.isFinite(frequency) && frequency > 0 && frequency >= vocalRangeRef.current!.lowHz && frequency <= vocalRangeRef.current!.highHz);
  const recordingDurationSec = config ? getSequenceDurationSeconds(config.frequencies.length, config.noteDurationSec, config.gapSec) : 0.1;
  const activeTargetNoteIndex = phase === 'recording' && config ? getTimedTargetNoteIndex(recordingTime, config.frequencies.length, config.noteDurationSec, config.gapSec) : null;

  const requestMicrophonePermission = useCallback(async (): Promise<boolean> => {
    try {
      const permission = await AudioManager.requestRecordingPermissions();
      if (permission !== 'Granted') {
        if (mountedRef.current) setErrorMessage('Microphone permission is required to perform this exercise.');
        return false;
      }
      return true;
    } catch (error) {
      console.warn('Microphone permission request failed:', error);
      if (mountedRef.current) setErrorMessage('We could not access the microphone. Please check your microphone permissions.');
      return false;
    }
  }, []);

  const playReference = useCallback(async () => {
    if (!mountedRef.current || phaseRef.current !== 'reference' || referencePlayingRef.current || !config || !hasValidGeneratedSequence) return;
    const playbackId = ++referencePlaybackIdRef.current;
    referencePlayingRef.current = true;
    setIsPlayingReference(true);
    setErrorMessage('');
    try {
      const context = audioContextRef.current ?? new AudioContext({ sampleRate: SAMPLE_RATE });
      audioContextRef.current = context;
      await context.resume();
      for (const [index, frequency] of config.frequencies.entries()) {
        if (!mountedRef.current || playbackId !== referencePlaybackIdRef.current || phaseRef.current !== 'reference') return;
        setActiveReferenceNoteIndex(index);
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.frequency.value = frequency;
        gain.gain.value = 0.12;
        oscillator.connect(gain);
        gain.connect(context.destination);
        const startTime = context.currentTime;
        oscillator.start(startTime);
        oscillator.stop(startTime + config.noteDurationSec);
        await sleep(config.noteDurationSec * 1000);
        if (mountedRef.current && playbackId === referencePlaybackIdRef.current) setActiveReferenceNoteIndex(null);
        if (index < config.frequencies.length - 1 && config.gapSec > 0) await sleep(config.gapSec * 1000);
      }
    } catch (error) {
      console.warn('Reference playback failed:', error);
      if (mountedRef.current && playbackId === referencePlaybackIdRef.current) setErrorMessage('The reference sequence could not be played. Please try again.');
    } finally {
      if (playbackId === referencePlaybackIdRef.current) {
        referencePlayingRef.current = false;
        if (mountedRef.current) { setIsPlayingReference(false); setActiveReferenceNoteIndex(null); }
      }
    }
  }, [config, hasValidGeneratedSequence]);

  const beginExercise = useCallback(async () => {
    if (tierLoading || isLoadingAdaptiveParams || phaseRef.current !== 'instructions') return;
    if (!hasValidGeneratedSequence) {
      setErrorMessage('A valid vocal range could not be found. Please complete your vocal range assessment before starting this exercise.');
      return;
    }
    setErrorMessage('');
    const runId = ++exerciseRunIdRef.current;
    countdownRunIdRef.current += 1;
    cancelReferencePlayback();
    measurementsRef.current = [];
    samplesRef.current = [];
    processingRef.current = false;
    setCurrentRepetition(1);
    setCountdown(COUNTDOWN_SECONDS);
    setRecordingTime(0);
    setLivePitch(null);
    setResult(null);
    const permission = await requestMicrophonePermission();
    if (!permission || !mountedRef.current || runId !== exerciseRunIdRef.current) return;
    setExercisePhase('reference');
  }, [cancelReferencePlayback, hasValidGeneratedSequence, isLoadingAdaptiveParams, requestMicrophonePermission, setExercisePhase, tierLoading]);

  const processRecording = useCallback(async () => {
    if (processingRef.current || phaseRef.current !== 'recording' || !config) return;
    processingRef.current = true;
    const runId = exerciseRunIdRef.current;
    stopRecording();
    setExercisePhase('processing');
    try {
      await sleep(200);
      if (!mountedRef.current || runId !== exerciseRunIdRef.current) return;
      const samples = new Float32Array(samplesRef.current);
      if (!samples.length) throw new Error('No audio samples were captured.');
      const measurement = measureVocalRunAccuracy(samples, SAMPLE_RATE, config.frequencies);
      console.log('Vocal Run Accuracy measurement:', {
        targetNotes: measurement.targetNotes, detectedNotes: measurement.detectedNotes,
        pitchAccuracy: measurement.pitchAccuracy, sequenceAccuracy: measurement.sequenceAccuracy,
        noteCount: measurement.noteCount, correctNoteCount: measurement.correctNoteCount,
        transitionCount: measurement.transitionCount, correctTransitionCount: measurement.correctTransitionCount,
      });
      measurementsRef.current.push(measurement);
      const completedRepetitions = measurementsRef.current.length;
      if (completedRepetitions < config.repetitions) {
        if (!mountedRef.current || runId !== exerciseRunIdRef.current) return;
        samplesRef.current = [];
        setCurrentRepetition(completedRepetitions + 1);
        setCountdown(COUNTDOWN_SECONDS);
        setRecordingTime(0);
        setLivePitch(null);
        setExercisePhase('reference');
        return;
      }
      const measurements = measurementsRef.current;
      const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
      const totalNoteCount = measurements.reduce((sum, item) => sum + item.noteCount, 0);
      const totalCorrectNoteCount = measurements.reduce((sum, item) => sum + item.correctNoteCount, 0);
      const totalTransitionCount = measurements.reduce((sum, item) => sum + item.transitionCount, 0);
      const totalCorrectTransitionCount = measurements.reduce((sum, item) => sum + item.correctTransitionCount, 0);
      const totalDurationMs = measurements.reduce((sum, item) => sum + item.durationMs, 0);
      const pitchScore = average(measurements.map((item) => item.pitchAccuracy));
      const sequenceScore = average(measurements.map((item) => item.sequenceAccuracy));
      const transitionScore = totalTransitionCount > 0 ? totalCorrectTransitionCount / totalTransitionCount * 100 : sequenceScore;
      const notesPerSecond = totalDurationMs > 0 ? totalNoteCount / (totalDurationMs / 1000) : 0;
      const aggregatedMeasurement = {
        detectedPitches: measurements.flatMap((item) => item.detectedPitches),
        detectedNotes: measurements.flatMap((item) => item.detectedNotes),
        targetNotes: measurements.flatMap((item) => item.targetNotes),
        pitchAccuracy: pitchScore, sequenceAccuracy: sequenceScore,
        noteCount: totalNoteCount, correctNoteCount: totalCorrectNoteCount,
        transitionCount: totalTransitionCount, correctTransitionCount: totalCorrectTransitionCount,
        durationMs: totalDurationMs, notesPerSecond,
      };
      const score = scoreVocalRunAccuracy(aggregatedMeasurement, config.accuracyThreshold);
      if (!mountedRef.current || runId !== exerciseRunIdRef.current) return;
      const feedback = score.passed ? score.feedback : sequenceScore < config.accuracyThreshold
        ? `Sequence accuracy must reach at least ${config.accuracyThreshold}% for the ${config.label.toLowerCase()} level.` : score.feedback;
      await saveCompletedExercise('agility', 'vocalRunAccuracy', tier, score.overall);
      if (!mountedRef.current || runId !== exerciseRunIdRef.current) return;
      setResult({
        overall: score.overall, pitchScore: score.pitchScore, sequenceScore: score.sequenceScore,
        transitionScore: score.transitionScore, passed: score.passed, feedback,
        noteCount: totalNoteCount, correctNoteCount: totalCorrectNoteCount,
        transitionCount: totalTransitionCount, correctTransitionCount: totalCorrectTransitionCount,
        notesPerSecond, durationMs: totalDurationMs, repetitionsCompleted: measurements.length,
      });
      setLivePitch(null);
      setExercisePhase('results');
    } catch (error) {
      console.warn('Vocal Run Accuracy processing failed:', error);
      if (mountedRef.current && runId === exerciseRunIdRef.current) {
        setErrorMessage('We could not analyze this recording. Please try again.');
        setExercisePhase('instructions');
      }
    } finally { if (runId === exerciseRunIdRef.current) processingRef.current = false; }
  }, [config, setExercisePhase, stopRecording, tier]);

  const startRecording = useCallback(async () => {
    if (recorderRef.current || phaseRef.current !== 'countdown' || !config) return;
    const runId = exerciseRunIdRef.current;
    const maxSamples = Math.ceil(recordingDurationSec * SAMPLE_RATE);
    try {
      samplesRef.current = [];
      setRecordingTime(0);
      setLivePitch(null);
      const recorder = new AudioRecorder();
      recorderRef.current = recorder;
      const callbackResult = recorder.onAudioReady({ sampleRate: SAMPLE_RATE, bufferLength: BUFFER_SIZE, channelCount: 1 }, ({ buffer, numFrames }) => {
        if (!mountedRef.current || runId !== exerciseRunIdRef.current || phaseRef.current !== 'recording') return;
        try {
          const channelData = buffer.getChannelData(0);
          const frameCount = Math.min(numFrames, channelData.length);
          const remaining = maxSamples - samplesRef.current.length;
          const copyCount = Math.min(frameCount, Math.max(remaining, 0));
          for (let i = 0; i < copyCount; i++) if (Number.isFinite(channelData[i])) samplesRef.current.push(channelData[i]);
          const liveFrame = new Float32Array(channelData.slice(0, frameCount));
          const detected = detectPitchAutocorrelation(liveFrame, SAMPLE_RATE, { minFrequency: 70, maxFrequency: 1000, minRms: 0.008, minCorrelation: 0.70 });
          if (mountedRef.current && typeof detected === 'number' && Number.isFinite(detected) && detected >= 70 && detected <= 1000) setLivePitch({ note: frequencyToNoteName(detected), frequency: detected });
          else if (mountedRef.current) setLivePitch(null);
        } catch (error) { console.warn('Could not process live audio frame:', error); }
      });
      if (callbackResult.status === 'error') throw new Error(callbackResult.message);
      await AudioManager.setAudioSessionActivity(true);
      if (!mountedRef.current || runId !== exerciseRunIdRef.current) { stopRecording(); return; }
      const startResult = await recorder.start();
      if (startResult.status === 'error') throw new Error(startResult.message);
      if (!mountedRef.current || runId !== exerciseRunIdRef.current) { stopRecording(); return; }
      recordingStartRef.current = Date.now();
      setRecordingTime(0);
      setExercisePhase('recording');
      recordingTimerRef.current = setInterval(() => {
        const started = recordingStartRef.current;
        if (started === null || !mountedRef.current || runId !== exerciseRunIdRef.current) return;
        const elapsed = (Date.now() - started) / 1000;
        setRecordingTime(Math.min(elapsed, recordingDurationSec));
        if (elapsed >= recordingDurationSec) { setRecordingTime(recordingDurationSec); void processRecording(); }
      }, 100);
    } catch (error) {
      console.warn('Recording failed:', error);
      stopRecording();
      if (mountedRef.current && runId === exerciseRunIdRef.current) {
        setLivePitch(null); setErrorMessage('We could not start the recording. Please try again.'); setExercisePhase('instructions');
      }
    }
  }, [config, processRecording, recordingDurationSec, setExercisePhase, stopRecording]);

  const startCountdown = useCallback(async () => {
    if (phaseRef.current !== 'reference' || referencePlayingRef.current) return;
    const runId = ++countdownRunIdRef.current;
    setErrorMessage(''); setExercisePhase('countdown');
    for (let value = COUNTDOWN_SECONDS; value >= 1; value--) {
      if (!mountedRef.current || countdownRunIdRef.current !== runId) return;
      setCountdown(value); await sleep(1000);
    }
    if (!mountedRef.current || countdownRunIdRef.current !== runId) return;
    setCountdown(0); await sleep(1000);
    if (!mountedRef.current || countdownRunIdRef.current !== runId) return;
    await startRecording();
  }, [setExercisePhase, startRecording]);

  const finishRecording = useCallback(() => {
    if (phaseRef.current !== 'recording' || !recorderRef.current || processingRef.current) return;
    void processRecording();
  }, [processRecording]);

  const returnToInstructions = useCallback(() => {
    exerciseRunIdRef.current += 1; countdownRunIdRef.current += 1; cancelReferencePlayback(); stopRecording();
    processingRef.current = false; samplesRef.current = []; measurementsRef.current = [];
    setResult(null); setCurrentRepetition(1); setRecordingTime(0); setCountdown(COUNTDOWN_SECONDS); setLivePitch(null); setErrorMessage(''); setExercisePhase('instructions');
  }, [cancelReferencePlayback, setExercisePhase, stopRecording]);

  const resetExercise = useCallback(() => {
    exerciseRunIdRef.current += 1; countdownRunIdRef.current += 1; cancelReferencePlayback(); stopRecording();
    processingRef.current = false; samplesRef.current = []; measurementsRef.current = [];
    let nextScores = recentScoresRef.current;
    if (result && Number.isFinite(result.overall) && result.overall >= 0 && result.overall <= 100) {
      nextScores = [...nextScores, result.overall].slice(-5); recentScoresRef.current = nextScores;
    }
    const nextConfig = generateVocalRunAccuracyParams({ tier, recentScores: nextScores, vocalRange: vocalRangeRef.current, previousFrequencies: config?.frequencies });
    setAdaptiveConfig(nextConfig);
    setResult(null); setCurrentRepetition(1); setRecordingTime(0); setCountdown(COUNTDOWN_SECONDS); setLivePitch(null); setErrorMessage(''); setExercisePhase('instructions');
  }, [cancelReferencePlayback, config, result, setExercisePhase, stopRecording, tier]);

  if (tierLoading || isLoadingAdaptiveParams || !config) {
    return <View style={styles.preparingScreen}><View style={styles.iconCircle}><Ionicons name="options-outline" size={38} color={BROWN} /></View><Text style={styles.title}>Preparing Your Exercise</Text><Text style={styles.subtitle}>Loading your difficulty level and assessed vocal range.</Text><ActivityIndicator size="large" color={BROWN} style={{ marginTop: 24 }} /></View>;
  }

  const renderSequence = (activeIndex: number | null, live = false) => (
    <View style={styles.sequence}>{config.frequencies.map((frequency, index) => {
      const active = activeIndex === index;
      return <View key={`${frequency}-${index}`} style={[styles.notePill, active && styles.activeNote, live && styles.liveNote]}><Text style={[styles.noteNumber, active && styles.activeText]}>{index + 1}</Text><Text style={[styles.noteText, active && styles.activeText]}>{frequencyToNoteName(frequency)}</Text></View>;
    })}</View>
  );

  const renderInstructions = () => <View style={styles.content}>
    <Pressable style={styles.backButton} onPress={() => setConfirmationType('quit')}><Ionicons name="arrow-back" size={24} color={BROWN} /></Pressable>
    <View style={styles.iconCircle}><Ionicons name="flash-outline" size={34} color={BROWN} /></View>
    <Text style={styles.title}>Vocal Run Accuracy</Text><Text style={styles.subtitle}>VOCAL AGILITY</Text>
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Exercise Instructions</Text>
      {['Listen carefully to the reference vocal run.','Sing every note in the same order.','Keep your pitch accurate and move smoothly between notes.',`Complete all ${config.repetitions} repetitions.`].map((line) => <Text key={line} style={styles.bodyText}>• {line}</Text>)}
      <Text style={styles.cardTitle}>Exercise Details</Text>
      {[['Difficulty', config.label], ['Speed', config.speedLabel], ['Notes', String(config.frequencies.length)], ['Repetitions', String(config.repetitions)], ['Accuracy Target', `${config.accuracyThreshold}%`], ['Note Duration', `${config.noteDurationSec.toFixed(2)} sec`]].map(([label, value]) => <View key={label} style={styles.detailRow}><Text style={styles.detailLabel}>{label}</Text><Text style={styles.detailValue}>{value}</Text></View>)}
    </View>
    <View style={styles.card}><Text style={styles.cardTitle}>Personalized Reference Sequence</Text>{hasValidGeneratedSequence ? renderSequence(null) : <Text style={styles.errorText}>A valid assessed vocal range is required. Please complete your vocal range assessment before starting this exercise.</Text>}<Text style={styles.hint}>The pitches shown here are generated within your assessed vocal range.</Text></View>
    {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}
    <Pressable style={[styles.button, !hasValidGeneratedSequence && styles.disabled]} disabled={!hasValidGeneratedSequence} onPress={beginExercise}><Ionicons name="play" size={18} color={WHITE} /><Text style={styles.buttonText}>Start Exercise</Text></Pressable>
  </View>;

  const renderReference = () => <View style={styles.content}><Pressable style={styles.backButton} onPress={() => setConfirmationType('quit')}><Ionicons name="arrow-back" size={24} color={BROWN} /></Pressable><View style={styles.iconCircle}><Ionicons name="musical-notes-outline" size={34} color={BROWN} /></View><Text style={styles.title}>Repetition {currentRepetition}</Text><Text style={styles.subtitle}>OF {config.repetitions} REPETITIONS</Text><View style={styles.card}><Text style={styles.cardTitle}>Listen to the Sequence</Text>{renderSequence(activeReferenceNoteIndex)}<Text style={styles.hint}>Listen to the full sequence before singing.</Text></View><Pressable style={[styles.button, isPlayingReference && styles.disabled]} disabled={isPlayingReference} onPress={() => void playReference()}>{isPlayingReference ? <ActivityIndicator color={WHITE} /> : <Ionicons name="play" size={18} color={WHITE} />}<Text style={styles.buttonText}>{isPlayingReference ? 'Playing Reference...' : 'Play Reference'}</Text></Pressable><Pressable style={[styles.secondaryButton, isPlayingReference && styles.disabled]} disabled={isPlayingReference} onPress={() => void startCountdown()}><Text style={styles.secondaryButtonText}>Continue</Text></Pressable>{errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}</View>;

  const renderCountdown = () => <View style={styles.centerScreen}><View style={styles.iconCircle}><Ionicons name="flash-outline" size={34} color={BROWN} /></View><Text style={styles.title}>Get Ready</Text><Text style={styles.subtitle}>REPETITION {currentRepetition} OF {config.repetitions}</Text><Text style={styles.countdown}>{countdown === 0 ? 'READY' : countdown}</Text><Text style={styles.hint}>Prepare to sing the vocal run.</Text><Pressable style={styles.secondaryButton} onPress={returnToInstructions}><Text style={styles.secondaryButtonText}>Cancel</Text></Pressable></View>;

  const renderRecording = () => <View style={styles.content}><View style={styles.iconCircle}><Ionicons name="mic" size={34} color={BROWN} /></View><Text style={styles.title}>Sing the Vocal Run</Text><Text style={styles.subtitle}>REPETITION {currentRepetition} OF {config.repetitions}</Text><View style={styles.card}><Text style={styles.cardTitle}>Target Sequence</Text>{renderSequence(activeTargetNoteIndex, true)}<View style={styles.divider} /><Text style={styles.cardTitle}>Live Detected Pitch</Text><Text style={styles.livePitch}>{livePitch?.note ?? '--'}</Text><Text style={styles.hint}>{livePitch ? `${livePitch.frequency.toFixed(1)} Hz` : 'Listening for a clear vocal pitch'}</Text></View><Text style={styles.hint}>Recording: {Math.min(recordingTime, recordingDurationSec).toFixed(1)} / {recordingDurationSec.toFixed(1)} sec</Text><View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.min(100, recordingTime / recordingDurationSec * 100)}%` }]} /></View><Pressable style={styles.secondaryButton} onPress={finishRecording}><Ionicons name="stop" size={18} color={BROWN} /><Text style={styles.secondaryButtonText}>Finish Recording</Text></Pressable><Pressable onPress={returnToInstructions} style={styles.textButton}><Text style={styles.hint}>Cancel Exercise</Text></Pressable></View>;

  const renderProcessing = () => <View style={styles.centerScreen}><ActivityIndicator size="large" color={BROWN} /><Text style={styles.title}>Analyzing Your Singing</Text><Text style={styles.hint}>Measuring pitch, sequence, and transition accuracy.</Text></View>;

  const renderResults = () => {
    if (!result) return null;
    const accuracyItems: [string, number][] = [['Pitch Accuracy', result.pitchScore], ['Sequence Accuracy', result.sequenceScore], ['Transition Accuracy', result.transitionScore]];
    const metrics: [string, string][] = [['Correct Notes', `${result.correctNoteCount}/${result.noteCount}`], ['Correct Transitions', `${result.correctTransitionCount}/${result.transitionCount}`], ['Notes/sec', result.notesPerSecond.toFixed(2)], ['Total Duration', `${(result.durationMs / 1000).toFixed(1)}s`]];
    return <View style={styles.content}><View style={styles.iconCircle}><Ionicons name={result.passed ? 'checkmark-circle-outline' : 'refresh-outline'} size={38} color={BROWN} /></View><Text style={styles.title}>{result.passed ? 'Great Job!' : 'Keep Practicing!'}</Text><Text style={styles.subtitle}>VOCAL RUN ACCURACY RESULT</Text><View style={styles.scoreCard}><Text style={styles.cardTitle}>OVERALL SCORE</Text><Text style={styles.score}>{Math.round(result.overall)}<Text style={styles.scoreOutOf}> / 100</Text></Text><Text style={[styles.status, { color: result.passed ? GREEN : RED }]}>{result.passed ? 'PASSED' : 'KEEP PRACTICING'}</Text><Text style={styles.hint}>{result.repetitionsCompleted} of {config.repetitions} repetitions completed</Text></View><View style={styles.card}><Text style={styles.cardTitle}>Accuracy Breakdown</Text>{accuracyItems.map(([label, value]) => <View key={label} style={styles.metricBlock}><View style={styles.detailRow}><Text style={styles.detailLabel}>{label}</Text><Text style={styles.detailValue}>{Math.round(value)}%</Text></View><View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.max(0, Math.min(100, value))}%` }]} /></View></View>)}<Text style={styles.hint}>Sequence target: {config.accuracyThreshold}%</Text></View><View style={styles.card}><Text style={styles.cardTitle}>Performance Metrics</Text>{metrics.map(([label, value]) => <View key={label} style={styles.detailRow}><Text style={styles.detailLabel}>{label}</Text><Text style={styles.detailValue}>{value}</Text></View>)}</View><View style={styles.card}><Text style={styles.bodyText}>{result.feedback}</Text></View><Pressable style={styles.button} onPress={() => setConfirmationType('retry')}><Ionicons name="refresh" size={18} color={WHITE} /><Text style={styles.buttonText}>Try Again</Text></Pressable><Pressable style={styles.secondaryButton} onPress={() => setConfirmationType('quit')}><Text style={styles.secondaryButtonText}>Back to Exercises</Text></Pressable></View>;
  };

  return <View style={styles.root}><ScrollView style={styles.screen} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
    {phase === 'instructions' && renderInstructions()}{phase === 'loading' && <View style={styles.centerScreen}><ActivityIndicator color={BROWN} /><Text style={styles.title}>Getting You Ready</Text></View>}{phase === 'reference' && renderReference()}{phase === 'countdown' && renderCountdown()}{phase === 'recording' && renderRecording()}{phase === 'processing' && renderProcessing()}{phase === 'results' && renderResults()}
  </ScrollView>
  {confirmationType !== null && <View style={styles.overlay}><Pressable style={styles.backdrop} onPress={() => setConfirmationType(null)} /><View style={styles.modal}><View style={styles.iconCircle}><Ionicons name="exit-outline" size={26} color={BROWN} /></View><Text style={styles.modalTitle}>{confirmationType === 'retry' ? 'Try again?' : 'Quit exercise?'}</Text><Text style={styles.hint}>{confirmationType === 'retry' ? 'Restart this exercise?' : 'Are you sure you want to leave this exercise?'}</Text><Pressable style={styles.button} onPress={() => setConfirmationType(null)}><Text style={styles.buttonText}>{confirmationType === 'retry' ? 'Keep Results' : 'Continue Exercise'}</Text></Pressable><Pressable style={styles.secondaryButton} onPress={() => { const action = confirmationType; setConfirmationType(null); if (action === 'retry') resetExercise(); else { countdownRunIdRef.current += 1; cancelReferencePlayback(); stopRecording(); router.replace('/exercises/breath-control'); } }}><Text style={styles.secondaryButtonText}>{confirmationType === 'retry' ? 'Restart Exercise' : 'Quit Exercise'}</Text></Pressable></View></View>}
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: WHITE }, screen: { flex: 1, backgroundColor: WHITE }, scrollContent: { flexGrow: 1 },
  preparingScreen: { flex: 1, backgroundColor: WHITE, alignItems: 'center', justifyContent: 'center', padding: 28 },
  content: { flexGrow: 1, alignItems: 'center', paddingHorizontal: 24, paddingTop: 86, paddingBottom: 48 },
  centerScreen: { flexGrow: 1, minHeight: 520, alignItems: 'center', justifyContent: 'center', padding: 24 },
  backButton: { position: 'absolute', top: 44, left: 24, width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 21, backgroundColor: LIGHT_PINK },
  iconCircle: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: PINK, marginBottom: 16 },
  title: { fontFamily: 'FredokaBold', fontSize: 27, color: BROWN, textAlign: 'center' }, subtitle: { fontFamily: 'FredokaRegular', fontSize: 11, color: MUTED, marginTop: 5, marginBottom: 20, textAlign: 'center', letterSpacing: 0.6 },
  card: { width: '100%', borderRadius: 20, backgroundColor: LIGHT_PINK, borderColor: BORDER, borderWidth: 1, padding: 18, marginBottom: 14 }, cardTitle: { fontFamily: 'FredokaBold', fontSize: 17, color: BROWN, marginBottom: 12 }, bodyText: { fontFamily: 'FredokaRegular', fontSize: 12, lineHeight: 19, color: BROWN, marginBottom: 6 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 7 }, detailLabel: { fontFamily: 'FredokaRegular', fontSize: 12, color: MUTED, flex: 1 }, detailValue: { fontFamily: 'FredokaBold', fontSize: 12, color: BROWN, textAlign: 'right', marginLeft: 12 },
  sequence: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginVertical: 10 }, notePill: { minWidth: 52, paddingHorizontal: 11, paddingVertical: 9, borderRadius: 12, backgroundColor: PINK, alignItems: 'center' }, noteNumber: { fontFamily: 'FredokaRegular', fontSize: 9, color: MUTED }, noteText: { fontFamily: 'FredokaBold', fontSize: 14, color: BROWN, marginTop: 2 }, activeNote: { backgroundColor: '#E85D83', borderWidth: 1, borderColor: '#C93E68' }, activeText: { color: WHITE }, liveNote: { minWidth: 48 },
  hint: { fontFamily: 'FredokaRegular', fontSize: 11, lineHeight: 17, color: MUTED, textAlign: 'center', marginTop: 10 }, errorText: { fontFamily: 'FredokaRegular', fontSize: 12, lineHeight: 18, color: RED, textAlign: 'center', marginVertical: 10 },
  button: { width: '100%', minHeight: 52, borderRadius: 26, backgroundColor: BROWN, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 16, marginTop: 8 }, buttonText: { fontFamily: 'FredokaBold', fontSize: 14, color: WHITE }, secondaryButton: { width: '100%', minHeight: 50, borderRadius: 25, backgroundColor: LIGHT_GRAY, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 16, marginTop: 10 }, secondaryButtonText: { fontFamily: 'FredokaBold', fontSize: 14, color: BROWN }, disabled: { opacity: 0.5 },
  countdown: { fontFamily: 'FredokaBold', fontSize: 72, color: BROWN, marginVertical: 16 }, livePitch: { fontFamily: 'FredokaBold', fontSize: 42, color: BROWN, textAlign: 'center', marginTop: 8 }, divider: { height: 1, backgroundColor: BORDER, marginVertical: 14 }, progressTrack: { width: '100%', height: 8, borderRadius: 4, backgroundColor: LIGHT_GRAY, overflow: 'hidden', marginTop: 8 }, progressFill: { height: '100%', backgroundColor: '#E85D83', borderRadius: 4 }, textButton: { padding: 12 }, scoreCard: { width: '100%', alignItems: 'center', backgroundColor: PINK, padding: 22, borderRadius: 22, marginBottom: 14 }, score: { fontFamily: 'FredokaBold', fontSize: 54, color: BROWN }, scoreOutOf: { fontSize: 18 }, status: { fontFamily: 'FredokaBold', fontSize: 12, marginTop: 4 }, metricBlock: { marginBottom: 12 },
  overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 1000, alignItems: 'center', justifyContent: 'center', padding: 26 }, backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(0,0,0,0.45)' }, modal: { width: '100%', maxWidth: 380, alignItems: 'center', padding: 24, borderRadius: 24, backgroundColor: WHITE }, modalTitle: { fontFamily: 'FredokaBold', fontSize: 23, color: BROWN, marginBottom: 8 },
});
