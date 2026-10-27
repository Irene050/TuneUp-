import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { COLORS } from '@/constants/appConstants';
import type { Tier } from '@/services/adaptiveDifficultyScaling/adaptiveDifficultyScaling';

export type ExercisePreparationStep = {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
};

export type ExerciseSummaryItem = {
  label: string;
  value: string;
  hint?: string;
};

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
  progress?: number;
};

type ProcessingScreenProps = ExercisePhaseProps & {
  title: string;
  message: string;
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
}: CountdownScreenProps) {
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
  progress,
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
    </View>
  );
}

export function ExerciseProcessingScreen({
  icon,
  title,
  message,
  onBack,
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

        {scoreDetails}

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