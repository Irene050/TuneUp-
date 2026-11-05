import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle
} from 'react-native';

import { COLORS } from '@/constants/appConstants';
import type { Tier } from '@/constants/params';

export type ExercisePreparationStep = {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
};

export type ExerciseSummaryItem = {
  label: string;
  value: string;
  hint?: string;
};

type ExerciseQuitModalProps = {
  visible: boolean;
  message: ReactNode;
  onContinue: () => void;
  onQuit: () => void;
  isQuitting: boolean;
  title?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  hint?: ReactNode;
  continueLabel?: string;
  quitLabel?: string;
  quittingLabel?: string;
  statusBarTranslucent?: boolean;
  variant?: 'exercise' | 'assessment';
};

export function ExerciseQuitModal({
  visible,
  message,
  onContinue,
  onQuit,
  isQuitting,
  title = 'Quit Exercise?',
  icon = 'exit-outline',
  hint,
  continueLabel = 'Continue Exercise',
  quitLabel = 'Quit Exercise',
  quittingLabel = 'Stopping...',
  statusBarTranslucent = true,
  variant = 'exercise',
}: ExerciseQuitModalProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent={statusBarTranslucent}
      onRequestClose={onContinue}
    >
      <View style={styles.quitModalOverlay}>
        <View
          accessibilityRole="alert"
          accessibilityLabel="Quit exercise confirmation"
          style={styles.quitModalCard}
        >
          <View style={styles.quitModalIconCircle}>
            <Ionicons
              name={icon}
              size={30}
              color={COLORS.brown}
            />
          </View>

          <Text style={styles.quitModalTitle}>{title}</Text>
          <Text style={styles.quitModalMessage}>{message}</Text>
          {hint ? (
            <Text style={styles.quitModalHint}>{hint}</Text>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={continueLabel}
            disabled={isQuitting}
            onPress={onContinue}
            style={({ pressed }) => [
              variant === 'assessment'
                ? styles.quitModalAssessmentContinueButton
                : styles.quitModalContinueButton,
              pressed && styles.quitModalButtonPressed,
              isQuitting && styles.quitModalButtonDisabled,
            ]}
          >
            <Text
              style={
                variant === 'assessment'
                  ? styles.quitModalAssessmentContinueText
                  : styles.quitModalContinueText
              }
            >
              {continueLabel}
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={quitLabel}
            disabled={isQuitting}
            onPress={onQuit}
            style={({ pressed }) => [
              variant === 'assessment'
                ? styles.quitModalAssessmentQuitButton
                : styles.quitModalQuitButton,
              pressed && styles.quitModalButtonPressed,
              isQuitting && styles.quitModalButtonDisabled,
            ]}
          >
            <Text
              style={
                variant === 'assessment'
                  ? styles.quitModalAssessmentQuitText
                  : styles.quitModalQuitText
              }
            >
              {isQuitting ? quittingLabel : quitLabel}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

type ExerciseNoAudioModalProps = {
  visible: boolean;
  onRedo: () => void;
  onQuit: () => void;
  isQuitting: boolean;
};

export function ExerciseNoAudioModal({
  visible,
  onRedo,
  onQuit,
  isQuitting,
}: ExerciseNoAudioModalProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onRedo}
    >
      <View style={styles.quitModalOverlay}>
        <View
          accessibilityRole="alert"
          accessibilityLabel="No audio captured"
          style={styles.quitModalCard}
        >
          <View style={styles.quitModalIconCircle}>
            <Ionicons
              name="mic-off-outline"
              size={30}
              color={COLORS.brown}
            />
          </View>

          <Text style={styles.quitModalTitle}>No audio captured</Text>
          <Text style={styles.quitModalMessage}>
            There was no audio captured for this repetition. Check your
            microphone and try again.
          </Text>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Redo repetition"
            disabled={isQuitting}
            onPress={onRedo}
            style={({ pressed }) => [
              styles.noAudioRedoButton,
              pressed && styles.quitModalButtonPressed,
              isQuitting && styles.quitModalButtonDisabled,
            ]}
          >
            <Text style={styles.noAudioRedoText}>Redo Repetition</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Quit exercise"
            disabled={isQuitting}
            onPress={onQuit}
            style={({ pressed }) => [
              styles.quitModalAssessmentQuitButton,
              pressed && styles.quitModalButtonPressed,
              isQuitting && styles.quitModalButtonDisabled,
            ]}
          >
            <Text style={styles.quitModalAssessmentQuitText}>
              {isQuitting ? 'Leaving...' : 'Quit Exercise'}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

type ExercisePhaseProps = {
  icon: keyof typeof Ionicons.glyphMap;
  onBack?: () => void;
};

type CountdownScreenProps = ExercisePhaseProps & {
  title: string;
  currentRep?: number;
  repetitions?: number;
  countdown: number;
  promptTitle: string;
  prompt: string;
  contentStyle?: StyleProp<ViewStyle>;
};

type ListeningScreenProps = ExercisePhaseProps & {
  title: string;
  currentRep?: number;
  repetitions?: number;
  elapsed?: number;
  targetDuration?: number;
  promptTitle: string;
  prompt: string;
  liveContent?: ReactNode;
  error?: string | null;
  progress?: number;
  isPlayingReference?: boolean;
  onPlayReference?: () => void;
  onContinue?: () => void;
};

type ProcessingScreenProps = {
  icon: ExercisePhaseProps['icon'];
  title: string;
  message: string;
};

type ExercisePreparingScreenProps = {
  title?: ReactNode;
  message: ReactNode;
  icon?: ExercisePhaseProps['icon'];
  iconSize?: number;
  containerStyle?: StyleProp<ViewStyle>;
  headerContent?: ReactNode;
  useSafeArea?: boolean;
};

type Props = {
  title: string;
  category: string;
  icon: keyof typeof Ionicons.glyphMap;
  instructions: string;
  preparationSteps?: ExercisePreparationStep[];
  summary?: ExerciseSummaryItem[];
  targetValue?: string;
  targetHint?: string;
  repetitions?: number;
  tip?: string;
  tier?: Tier | null;
  onBack: () => void;
  onStart: () => void;
  error?: string | null;
  startDisabled?: boolean;
  startLabel?: string;
  children?: ReactNode;
};

const tiers: Tier[] = [
  'beginner',
  'intermediate',
  'advanced',
];

export default function ExerciseScreen({
  title,
  category = 'Breath Control',
  icon,
  instructions,
  preparationSteps,
  summary,
  targetValue,
  targetHint,
  repetitions,
  tip,
  tier,
  onBack,
  onStart,
  error,
  startDisabled = false,
  startLabel = 'Start Exercise',
  children,
}: Props) {
  const targetDetails = summary ?? [
    ...(targetValue
      ? [
          {
            label: 'TARGET',
            value: targetValue,
            hint: targetHint,
          },
        ]
      : []),
    ...(repetitions !== undefined
      ? [
          {
            label: 'REPETITIONS',
            value: String(repetitions),
            hint: 'attempts',
          },
        ]
      : []),
  ];

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Pressable
        accessibilityLabel="Back"
        accessibilityRole="button"
        style={styles.backButton}
        onPress={onBack}
      >
        <Ionicons
          name="chevron-back"
          size={25}
          color={COLORS.brown}
        />
      </Pressable>

      <View style={styles.hero}>
        <View style={styles.iconCircle}>
          <Ionicons
            name={icon}
            size={36}
            color={COLORS.brown}
          />
        </View>

        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{category}</Text>
      </View>

      <View style={styles.instructionCard}>
        <Text style={styles.cardTitle}>
          Exercise Instructions
        </Text>

        <Text style={styles.instructionText}>
          {instructions}
        </Text>

        {children}

        {preparationSteps?.length ? (
          <View style={styles.beforeCard}>
            <Text style={styles.beforeTitle}>
              Before You Begin
            </Text>

            {preparationSteps.map((step, index) => (
              <View
                key={`${step.icon}-${index}`}
                style={styles.instructionRow}
              >
                <Ionicons
                  name={step.icon}
                  size={18}
                  color={COLORS.brown}
                />

                <Text style={styles.instructionRowText}>
                  {step.text}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {targetDetails.length ? (
          <View style={styles.targetGrid}>
            {targetDetails.map((item) => (
              <View
                key={item.label}
                style={styles.targetItem}
              >
                <Text style={styles.targetLabel}>
                  {item.label}
                </Text>

                <Text style={styles.targetValue}>
                  {item.value}
                </Text>

                {item.hint ? (
                  <Text style={styles.targetHint}>
                    {item.hint}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}

        {tip ? (
          <View style={styles.tipCard}>
            <Ionicons
              name="bulb-outline"
              size={21}
              color={COLORS.brown}
            />

            <Text style={styles.tipText}>
              {tip}
            </Text>
          </View>
        ) : null}
      </View>

      {tier ? (
        <View style={styles.difficultyRow}>
          <View>
            <Text style={styles.difficultyLabel}>
              DIFFICULTY
            </Text>

            <Text style={styles.difficultyValue}>
              {tier.charAt(0).toUpperCase() + tier.slice(1)}
            </Text>
          </View>

          <View style={styles.difficultyDots}>
            {tiers.map((level) => (
              <View
                key={level}
                style={[
                  styles.difficultyDot,
                  level === tier &&
                    styles.difficultyDotActive,
                ]}
              />
            ))}
          </View>
        </View>
      ) : null}

      {error ? (
        <View style={styles.errorCard}>
          <Ionicons
            name="alert-circle-outline"
            size={21}
            color="#A33A3A"
          />

          <Text style={styles.errorText}>
            {error}
          </Text>
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        disabled={startDisabled}
        style={[
          styles.startButton,
          startDisabled && styles.startButtonDisabled,
        ]}
        onPress={onStart}
      >
        <Ionicons
          name="play"
          size={20}
          color={COLORS.white}
        />

        <Text style={styles.startButtonText}>
          {startLabel}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

export function ExerciseCountdownScreen({
  icon,
  title,
  currentRep,
  repetitions,
  countdown,
  promptTitle,
  prompt,
  contentStyle,
}: CountdownScreenProps) {
  return (
    <View style={[styles.phaseScreen, contentStyle]}>
      <View style={styles.phaseScreen}>
        <View style={styles.phaseContent}>
          <View style={styles.phaseIconCircle}>
            <Ionicons
              name={icon}
              size={44}
              color={COLORS.brown}
            />
          </View>

          <Text style={styles.phaseTitle}>
            {title}
          </Text>

          {currentRep !== undefined &&
          repetitions !== undefined ? (
            <Text style={styles.phaseSubtitle}>
              Repetition {currentRep} of {repetitions}
            </Text>
          ) : null}

          <Text style={styles.countdownNumber}>
            {countdown}
          </Text>

          <Text style={styles.phasePromptTitle}>
            {promptTitle}
          </Text>

          <Text style={styles.phasePrompt}>
            {prompt}
          </Text>
        </View>
      </View>
    </View>
  );
}

export function ExerciseListeningScreen({
  icon,
  title,
  currentRep,
  repetitions,
  elapsed,
  targetDuration,
  promptTitle,
  prompt,
  liveContent,
  error,
  progress,
  isPlayingReference = false,
  onPlayReference,
  onContinue,
  onBack,
}: ListeningScreenProps) {
  const formatTime = (seconds: number) => {
    const safeSeconds = Math.max(0, seconds);
    const minutes = Math.floor(safeSeconds / 60);
    const remainingSeconds = Math.floor(
      safeSeconds % 60,
    );

    return `${minutes}:${remainingSeconds
      .toString()
      .padStart(2, '0')}`;
  };

  const clampedProgress =
    progress !== undefined
      ? Math.max(0, Math.min(100, progress)) / 100
      : targetDuration &&
          elapsed !== undefined
        ? Math.max(
            0,
            Math.min(1, elapsed / targetDuration),
          )
        : 0;

  return (
    <View style={styles.listeningScreen}>
      {onBack ? (
        <Pressable
          accessibilityLabel="Back"
          accessibilityRole="button"
          style={styles.listeningBackButton}
          onPress={onBack}
        >
          <Ionicons
            name="chevron-back"
            size={25}
            color={COLORS.brown}
          />
        </Pressable>
      ) : null}

      <View style={styles.listeningHeader}>
        <Text style={styles.listeningExerciseTitle}>
          {title}
        </Text>

        {currentRep !== undefined &&
        repetitions !== undefined ? (
          <Text style={styles.listeningRep}>
            Repetition {currentRep} of {repetitions}
          </Text>
        ) : null}
      </View>

      <View style={styles.listeningMain}>
        <View style={styles.listeningCard}>
          <View style={styles.listeningIconCircle}>
            <Ionicons
              name={icon}
              size={38}
              color={COLORS.brown}
            />
          </View>

          <Text style={styles.listeningCardTitle}>
            {promptTitle}
          </Text>

          <Text style={styles.listeningCardText}>
            {prompt}
          </Text>

          {liveContent ? (
            <View style={styles.listeningLiveContent}>
              {liveContent}
            </View>
          ) : null}
          {error ? (
            <Text accessibilityRole="alert" style={styles.listeningError}>
              {error}
            </Text>
          ) : null}
        </View>

        {elapsed !== undefined ? (
          <View style={styles.listeningTimeRow}>
            <Text style={styles.listeningTime}>
              {formatTime(elapsed)}
            </Text>

            {targetDuration !== undefined ? (
              <Text style={styles.listeningTimeTarget}>
                / {formatTime(targetDuration)}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>

      {progress !== undefined ||
      targetDuration !== undefined ? (
        <View style={styles.listeningFooter}>
          <View style={styles.listeningProgressTrack}>
            <View
              style={[
                styles.listeningProgressFill,
                {
                  width: `${clampedProgress * 100}%`,
                },
              ]}
            />
          </View>

          <Text style={styles.listeningProgressLabel}>
            Get ready to sing
          </Text>
        </View>
      ) : null}

      {onPlayReference ? (
        <Pressable
          accessibilityRole="button"
          disabled={isPlayingReference}
          style={[
            styles.listeningReferenceButton,
            isPlayingReference && styles.listeningButtonDisabled,
          ]}
          onPress={onPlayReference}
        >
          {isPlayingReference ? (
            <ActivityIndicator size="small" color={COLORS.brown} />
          ) : (
            <Ionicons name="play" size={18} color={COLORS.brown} />
          )}
          <Text style={styles.listeningReferenceButtonText}>
            {isPlayingReference ? 'Playing Reference...' : 'Play Reference'}
          </Text>
        </Pressable>
      ) : null}

      {onContinue ? (
        <Pressable
          accessibilityRole="button"
          disabled={isPlayingReference}
          style={[
            styles.listeningContinueButton,
            isPlayingReference && styles.listeningButtonDisabled,
          ]}
          onPress={onContinue}
        >
          <Text style={styles.listeningContinueButtonText}>I'm Ready</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function ExerciseRecordingScreen({
  title,
  currentRep,
  repetitions,
  onBack,
  children,
}: {
  title: string;
  currentRep: number;
  repetitions: number;
  onBack?: () => void;
  children: ReactNode;
}) {
  return (
    <View style={styles.agilityRecordingScreen}>
      {onBack ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={styles.agilityRecordingBackButton}
          onPress={onBack}
        >
          <Ionicons name="chevron-back" size={25} color={COLORS.brown} />
        </Pressable>
      ) : null}

      <View style={styles.agilityRecordingHeader}>
        <View style={styles.agilityRecordingIcon}>
          <Ionicons name="mic" size={34} color={COLORS.brown} />
        </View>
        <Text style={styles.agilityRecordingTitle}>{title}</Text>
        <Text style={styles.agilityRecordingSubtitle}>
          Repetition {currentRep} of {repetitions}
        </Text>
        <View style={styles.agilityRecordingBadge}>
          <View style={styles.agilityRecordingDot} />
          <Text style={styles.agilityRecordingBadgeText}>RECORDING</Text>
        </View>
      </View>

      {children}
    </View>
  );
}

export function ExerciseProcessingScreen({
  icon,
  title,
  message,
}: ProcessingScreenProps) {
  return (
    <View style={styles.phaseScreen}>

      <View style={styles.phaseContent}>
        <View style={styles.phaseIconCircle}>
          <Ionicons
            name={icon}
            size={44}
            color={COLORS.brown}
          />
        </View>

        <Text style={styles.phaseTitle}>
          {title}
        </Text>

        <Text style={styles.phasePrompt}>
          {message}
        </Text>

        <ActivityIndicator
          size="large"
          color={COLORS.brown}
          style={styles.phaseSpinner}
        />
      </View>
    </View>
  );
}

export function ExercisePreparingScreen({
  title = 'Preparing Your Exercise',
  message,
  icon = 'options-outline',
  iconSize = 44,
  containerStyle,
  headerContent,
  useSafeArea = false,
}: ExercisePreparingScreenProps) {
  const Container = useSafeArea ? SafeAreaView : View;

  return (
    <Container style={[styles.preparingScreen, containerStyle]}>
      {headerContent}
      <View style={styles.preparingContent}>
        <View style={styles.preparingIconCircle}>
          <Ionicons name={icon} size={iconSize} color={COLORS.brown} />
        </View>

        <Text style={styles.preparingTitle}>{title}</Text>
        <Text style={styles.preparingSubtitle}>{message}</Text>

        <ActivityIndicator
          size="large"
          color={COLORS.brown}
          style={styles.phaseSpinner}
        />
      </View>
    </Container>
  );
}

type MetricCardProps =
  | {
      label: string;
      value: string;
      variant: 'noteMatching' | 'toneConsistency';
    }
  | {
      icon: keyof typeof Ionicons.glyphMap;
      label: string;
      value: string;
      variant: 'breathControl';
    };

export function MetricCard(props: MetricCardProps) {
  const { label, value, variant } = props;
  const cardStyle =
    variant === 'noteMatching'
      ? styles.noteMatchingMetricCard
      : variant === 'toneConsistency'
        ? styles.toneConsistencyMetricCard
        : styles.breathControlMetricCard;
  const labelStyle =
    variant === 'noteMatching'
      ? styles.noteMatchingMetricLabel
      : variant === 'toneConsistency'
        ? styles.toneConsistencyMetricLabel
        : styles.breathControlMetricLabel;
  const valueStyle =
    variant === 'noteMatching'
      ? styles.noteMatchingMetricValue
      : variant === 'toneConsistency'
        ? styles.toneConsistencyMetricValue
        : styles.breathControlMetricValue;

  return (
    <View style={cardStyle}>
      {variant === 'breathControl' && (
        <Ionicons name={props.icon} size={21} color={COLORS.brown} />
      )}
      <Text style={labelStyle}>{label}</Text>
      <Text style={valueStyle}>{value}</Text>
    </View>
  );
}

export function Metric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

export function ResultStat({
  label,
  value,
  labelFontSize = 12,
}: {
  label: string;
  value: string;
  labelFontSize?: number;
}) {
  return (
    <View style={styles.resultStatContainer}>
      <Text style={styles.resultStatValue}>{value}</Text>
      <Text style={[styles.resultStatLabel, { fontSize: labelFontSize }]}>
        {label}
      </Text>
    </View>
  );
}

type ExerciseResultsScreenProps = {
  title: string;
  subtitle: string;
  score: number;
  resultIcon: keyof typeof Ionicons.glyphMap;
  scoreSuffix?: string;
  scoreMessage?: string;
  scoreDetails?: ReactNode;
  onBack?: () => void;
  onRetry: () => void;
  onExit: () => void;
  children: ReactNode;
};

export function ExerciseResultsScreen({
  title,
  subtitle,
  score,
  resultIcon,
  scoreSuffix = '%',
  scoreMessage,
  scoreDetails,
  onBack,
  onRetry,
  onExit,
  children,
}: ExerciseResultsScreenProps) {
  return (
    <ScrollView
      style={styles.resultsPhase}
      contentContainerStyle={styles.resultsContent}
      showsVerticalScrollIndicator={false}
    >
      {onBack ? (
        <Pressable
          accessibilityLabel="Back"
          accessibilityRole="button"
          style={styles.backButton}
          onPress={onBack}
        >
          <Ionicons
            name="chevron-back"
            size={25}
            color={COLORS.brown}
          />
        </Pressable>
      ) : null}

      <View style={styles.resultsHeader}>
        <View style={styles.resultsIconCircle}>
          <Ionicons
            name={resultIcon}
            size={42}
            color={COLORS.brown}
          />
        </View>

        <Text style={styles.resultsTitle}>
          {title}
        </Text>

        <Text style={styles.resultsSubtitle}>
          {subtitle}
        </Text>
      </View>

      <View style={styles.resultsScoreCard}>
        <Text style={styles.resultsScoreLabel}>
          OVERALL SCORE
        </Text>

        <Text style={styles.resultsScoreValue}>
          {score}
          {scoreSuffix ? (
            <Text style={styles.resultsScoreSuffix}>
              {scoreSuffix}
            </Text>
          ) : null}
        </Text>

        {scoreDetails != null ? (
          typeof scoreDetails === 'string' ||
          typeof scoreDetails === 'number' ? (
            <Text style={styles.resultsScoreMessage}>
              {scoreDetails}
            </Text>
          ) : (
            scoreDetails
          )
        ) : null}

        {scoreMessage ? (
          <Text style={styles.resultsScoreMessage}>
            {scoreMessage}
          </Text>
        ) : null}
      </View>

      {children}

      <Pressable
        accessibilityRole="button"
        style={styles.resultsRetryButton}
        onPress={onRetry}
      >
        <Ionicons
          name="refresh"
          size={20}
          color={COLORS.brown}
        />

        <Text style={styles.resultsRetryText}>
          Try Again
        </Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        style={styles.resultsExitButton}
        onPress={onExit}
      >
        <Text style={styles.resultsExitText}>
          Back to Exercises
        </Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  quitModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  quitModalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: COLORS.white,
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
  },
  quitModalIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: COLORS.pink,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  quitModalTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 22,
    color: COLORS.brown,
    textAlign: 'center',
  },
  quitModalMessage: {
    fontFamily: 'FredokaRegular',
    fontSize: 15,
    lineHeight: 22,
    color: COLORS.muted,
    textAlign: 'center',
    marginTop: 10,
  },
  quitModalHint: {
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    lineHeight: 19,
    color: COLORS.muted,
    textAlign: 'center',
    marginTop: 8,
  },
  quitModalContinueButton: {
    width: '100%',
    minHeight: 50,
    borderRadius: 25,
    borderWidth: 1.5,
    borderColor: COLORS.brown,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 22,
  },
  quitModalContinueText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 15,
    color: COLORS.brown,
  },
  quitModalAssessmentContinueButton: {
    width: '100%',
    minHeight: 50,
    borderRadius: 16,
    backgroundColor: COLORS.pink,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 22,
  },
  quitModalAssessmentContinueText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 15,
    color: COLORS.brown,
  },
  quitModalQuitButton: {
    width: '100%',
    minHeight: 50,
    borderRadius: 25,
    backgroundColor: COLORS.brown,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  quitModalQuitText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 15,
    color: COLORS.white,
  },
  quitModalAssessmentQuitButton: {
    width: '100%',
    minHeight: 50,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  quitModalAssessmentQuitText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 15,
    color: COLORS.muted,
  },
  noAudioRedoButton: {
    width: '100%',
    minHeight: 50,
    borderRadius: 16,
    backgroundColor: COLORS.pink,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 22,
  },
  noAudioRedoText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 15,
    color: COLORS.brown,
  },
  quitModalButtonPressed: {
    opacity: 0.75,
  },
  quitModalButtonDisabled: {
    opacity: 0.55,
  },
  container: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 64,
    paddingBottom: 40,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  hero: {
    alignItems: 'center',
    marginBottom: 24,
  },
  iconCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: COLORS.pink,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontFamily: 'FredokaBold',
    fontSize: 28,
    color: COLORS.brown,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 16,
    color: COLORS.muted,
    marginTop: 4,
  },
  instructionCard: {
    backgroundColor: COLORS.background,
    borderRadius: 22,
    padding: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cardTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 19,
    color: COLORS.brown,
    marginBottom: 12,
  },
  instructionText: {
    fontFamily: 'FredokaRegular',
    fontSize: 15,
    lineHeight: 23,
    color: COLORS.muted,
  },
  beforeCard: {
    backgroundColor: COLORS.pink,
    borderRadius: 18,
    padding: 16,
    marginTop: 18,
  },
  beforeTitle: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 16,
    color: COLORS.brown,
    marginBottom: 12,
  },
  instructionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 11,
  },
  instructionRowText: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.brown,
    marginLeft: 10,
  },
  targetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 16,
  },
  targetItem: {
    flex: 1,
    minWidth: '45%',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  targetLabel: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 11,
    color: COLORS.muted,
    letterSpacing: 0.5,
  },
  targetValue: {
    fontFamily: 'FredokaBold',
    fontSize: 20,
    color: COLORS.brown,
    marginTop: 3,
    textAlign: 'center',
  },
  targetHint: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: COLORS.muted,
    marginTop: 2,
    textAlign: 'center',
  },
  tipCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 14,
    marginTop: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  tipText: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    lineHeight: 19,
    color: COLORS.muted,
    marginLeft: 10,
  },
  difficultyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 22,
    paddingHorizontal: 4,
  },
  difficultyLabel: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 11,
    color: COLORS.muted,
    letterSpacing: 0.5,
  },
  difficultyValue: {
    fontFamily: 'FredokaBold',
    fontSize: 16,
    color: COLORS.brown,
    marginTop: 2,
  },
  difficultyDots: {
    flexDirection: 'row',
    gap: 7,
  },
  difficultyDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: COLORS.lightGray,
  },
  difficultyDotActive: {
    backgroundColor: COLORS.pink,
    borderWidth: 2,
    borderColor: COLORS.brown,
  },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    borderRadius: 14,
    padding: 13,
    marginTop: 18,
  },
  errorText: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    lineHeight: 19,
    color: COLORS.error,
    marginLeft: 9,
  },
  startButton: {
    marginTop: 24,
    height: 54,
    borderRadius: 27,
    backgroundColor: COLORS.brown,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  startButtonDisabled: {
    opacity: 0.55,
  },
  startButtonText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 16,
    color: COLORS.white,
  },
  phaseScreen: {
    flex: 1,
    backgroundColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
  },
  preparingScreen: {
    flex: 1,
    backgroundColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
  },
  preparingContent: {
    width: '100%',
    alignItems: 'center',
  },
  preparingIconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: COLORS.pink,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  preparingTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 26,
    color: COLORS.brown,
    textAlign: 'center',
  },
  preparingSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 16,
    color: COLORS.muted,
    textAlign: 'center',
    marginTop: 5,
  },
  phaseContent: {
    width: '100%',
    alignItems: 'center',
  },
  phaseIconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: COLORS.pink,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  phaseTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 26,
    color: COLORS.brown,
    textAlign: 'center',
  },
  phaseSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 16,
    color: COLORS.muted,
    textAlign: 'center',
    marginTop: 5,
  },
  countdownNumber: {
    fontFamily: 'FredokaBold',
    fontSize: 86,
    color: COLORS.brown,
    lineHeight: 100,
    marginTop: 20,
  },
  phasePromptTitle: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 19,
    color: COLORS.brown,
    textAlign: 'center',
    marginTop: 8,
  },
  phasePrompt: {
    maxWidth: 320,
    fontFamily: 'FredokaRegular',
    fontSize: 14,
    lineHeight: 21,
    color: COLORS.muted,
    textAlign: 'center',
    marginTop: 7,
  },
  phaseSpinner: {
    marginTop: 26,
  },
  noteMatchingMetricCard: {
    flex: 1,
    minWidth: 0,
    backgroundColor: COLORS.white,
    borderRadius: 14,
    paddingVertical: 11,
    paddingHorizontal: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  noteMatchingMetricLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 8,
    letterSpacing: 0.3,
    color: COLORS.muted,
    textAlign: 'center',
  },
  noteMatchingMetricValue: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: COLORS.brown,
    marginTop: 4,
    textAlign: 'center',
  },
  toneConsistencyMetricCard: {
    flex: 1,
    minWidth: '47%',
    backgroundColor: COLORS.background,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  toneConsistencyMetricLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 9,
    letterSpacing: 0.6,
    color: COLORS.muted,
  },
  toneConsistencyMetricValue: {
    fontFamily: 'FredokaBold',
    fontSize: 17,
    color: COLORS.brown,
    marginTop: 3,
  },
  breathControlMetricCard: {
    width: '48%',
    minHeight: 100,
    backgroundColor: COLORS.background,
    borderRadius: 17,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  breathControlMetricLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: COLORS.muted,
    marginTop: 8,
  },
  breathControlMetricValue: {
    fontFamily: 'FredokaBold',
    fontSize: 19,
    color: COLORS.brown,
    marginTop: 2,
  },
  metric: {
    width: '47%',
  },
  metricLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: COLORS.muted,
  },
  metricValue: {
    marginTop: 2,
    fontFamily: 'FredokaSemiBold',
    fontSize: 14,
    color: COLORS.brown,
  },
  resultStatContainer: {
    width: '48%',
    flexGrow: 1,
    backgroundColor: COLORS.lightGray,
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: 'center',
  },
  resultStatValue: {
    fontFamily: 'FredokaBold',
    fontSize: 18,
    color: COLORS.brown,
  },
  resultStatLabel: {
    marginTop: 3,
    fontFamily: 'FredokaRegular',
    color: COLORS.muted,
    textAlign: 'center',
  },
  listeningScreen: {
    flex: 1,
    backgroundColor: COLORS.white,
    paddingHorizontal: 24,
    paddingTop: 58,
    paddingBottom: 30,
  },
  listeningBackButton: {
    position: 'absolute',
    top: 14,
    left: 16,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  listeningHeader: {
    alignItems: 'center',
    marginTop: 10,
  },
  listeningExerciseTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 24,
    color: COLORS.brown,
    textAlign: 'center',
  },
  listeningRep: {
    fontFamily: 'FredokaRegular',
    fontSize: 14,
    color: COLORS.muted,
    marginTop: 5,
  },
  listeningMain: {
    flex: 1,
    justifyContent: 'center',
    width: '100%',
  },
  listeningCard: {
    width: '100%',
    backgroundColor: COLORS.background,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 22,
    alignItems: 'center',
  },
  listeningIconCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: COLORS.pink,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  listeningCardTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 21,
    color: COLORS.brown,
    textAlign: 'center',
  },
  listeningCardText: {
    fontFamily: 'FredokaRegular',
    fontSize: 14,
    lineHeight: 21,
    color: COLORS.muted,
    textAlign: 'center',
    marginTop: 7,
    maxWidth: 300,
  },
  listeningError: {
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    lineHeight: 19,
    color: COLORS.error,
    textAlign: 'center',
    marginTop: 10,
  },
  listeningLiveContent: {
    width: '100%',
    marginTop: 20,
  },
  listeningTimeRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    marginTop: 18,
  },
  listeningTime: {
    fontFamily: 'FredokaBold',
    fontSize: 24,
    color: COLORS.brown,
  },
  listeningTimeTarget: {
    fontFamily: 'FredokaRegular',
    fontSize: 15,
    color: COLORS.muted,
    marginLeft: 4,
  },
  listeningFooter: {
    width: '100%',
    marginTop: 10,
  },
  listeningProgressTrack: {
    width: '100%',
    height: 7,
    borderRadius: 4,
    backgroundColor: COLORS.lightGray,
    overflow: 'hidden',
  },
  listeningProgressFill: {
    height: '100%',
    backgroundColor: COLORS.pink,
    borderRadius: 4,
  },
  listeningProgressLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: COLORS.muted,
    textAlign: 'center',
    marginTop: 8,
  },
  listeningReferenceButton: {
    width: '100%',
    minHeight: 52,
    borderRadius: 26,
    backgroundColor: COLORS.pink,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 16,
  },
  listeningReferenceButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 14,
    color: COLORS.brown,
  },
  listeningContinueButton: {
    width: '100%',
    minHeight: 54,
    borderRadius: 27,
    backgroundColor: COLORS.brown,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  listeningContinueButtonText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 16,
    color: COLORS.white,
  },
  listeningButtonDisabled: {
    opacity: 0.6,
  },
  agilityRecordingScreen: {
    flexGrow: 1,
    width: '100%',
    paddingHorizontal: 20,
    paddingTop: 120,
    paddingBottom: 24,
    alignItems: 'center',
  },
  agilityRecordingBackButton: {
    position: 'absolute',
    top: 24,
    left: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  agilityRecordingHeader: {
    width: '100%',
    alignItems: 'center',
  },
  agilityRecordingIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: COLORS.pink,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  agilityRecordingTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 25,
    color: COLORS.brown,
    textAlign: 'center',
  },
  agilityRecordingSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 14,
    color: COLORS.muted,
    textAlign: 'center',
    marginTop: 4,
  },
  agilityRecordingBadge: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    borderRadius: 22,
    paddingHorizontal: 15,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  agilityRecordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.brown,
    marginRight: 7,
  },
  agilityRecordingBadgeText: {
    fontFamily: 'FredokaBold',
    fontSize: 10,
    letterSpacing: 0.6,
    color: COLORS.brown,
  },
  resultsPhase: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  resultsContent: {
    paddingHorizontal: 24,
    paddingTop: 64,
    paddingBottom: 40,
  },
  resultsHeader: {
    alignItems: 'center',
    marginBottom: 22,
  },
  resultsIconCircle: {
    width: 82,
    height: 82,
    borderRadius: 41,
    backgroundColor: COLORS.pink,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  resultsTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 27,
    color: COLORS.brown,
    textAlign: 'center',
  },
  resultsSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 15,
    color: COLORS.muted,
    textAlign: 'center',
    marginTop: 4,
  },
  resultsScoreCard: {
    backgroundColor: COLORS.background,
    borderRadius: 22,
    padding: 22,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 18,
  },
  resultsScoreLabel: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 11,
    color: COLORS.muted,
    letterSpacing: 0.8,
  },
  resultsScoreValue: {
    fontFamily: 'FredokaBold',
    fontSize: 52,
    color: COLORS.brown,
    marginTop: 3,
  },
  resultsScoreSuffix: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 20,
  },
  resultsScoreMessage: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 14,
    color: COLORS.brown,
    textAlign: 'center',
    marginTop: 10,
  },
  resultsRetryButton: {
    minHeight: 52,
    borderRadius: 26,
    borderWidth: 1.5,
    borderColor: COLORS.brown,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 18,
  },
  resultsRetryText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 15,
    color: COLORS.brown,
  },
  resultsExitButton: {
    minHeight: 52,
    borderRadius: 26,
    backgroundColor: COLORS.brown,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  resultsExitText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 15,
    color: COLORS.white,
  },
});