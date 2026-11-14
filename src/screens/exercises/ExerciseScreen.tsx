import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleProp, Text, View, ViewStyle } from 'react-native';

import { ReferenceNoteSequence } from '@/components/SharedPitchComponent';
import { COLORS } from '@/constants/appConstants';
import { exerciseStyles } from '@/constants/exerciseStyles';
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

type ExercisePhaseProps = {
  icon: keyof typeof Ionicons.glyphMap;
};

type CountdownScreenProps = ExercisePhaseProps & {
  title: string;
  onBack?: () => void;
  currentRep?: number;
  repetitions?: number;
  countdown: number;
  promptTitle: string;
  prompt: string;
  contentStyle?: StyleProp<ViewStyle>;
};

type ListeningScreenProps = {
  title: string;
  prompt: string;
  referenceNotes?: readonly string[];
  referenceContent?: ReactNode;
  activeNoteIndex?: number | null;
  errorMessage?: string | null;
  isPlayingReference?: boolean;
  onPlayReference?: () => void;
  onReady?: () => void;
};

type ProcessingScreenProps = {
  icon: ExercisePhaseProps['icon'];
  title: string;
  message: string;
  children?: ReactNode;
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
  errorMessage?: string | null;
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
  errorMessage,
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
      style={exerciseStyles.screen}
      contentContainerStyle={exerciseStyles.content_Exercise}
      showsVerticalScrollIndicator={false}
    >
      <Pressable
        accessibilityLabel="Back"
        accessibilityRole="button"
        style={exerciseStyles.backButton_Exercise}
        onPress={onBack}
      >
        <Ionicons
          name="chevron-back"
          size={25}
          color={COLORS.brown}
        />
      </Pressable>

      <View style={exerciseStyles.hero}>
        <View style={exerciseStyles.iconCircle_Exercise}>
          <Ionicons
            name={icon}
            size={36}
            color={COLORS.brown}
          />
        </View>

        <Text style={exerciseStyles.title}>{title}</Text>
        <Text style={exerciseStyles.subtitle_Exercise}>{category}</Text>
      </View>

      <View style={exerciseStyles.instructionCard}>
        <Text style={exerciseStyles.sectionTitle}>
          Exercise Instructions
        </Text>

        <Text style={exerciseStyles.instructionText_Exercise}>
          {instructions}
        </Text>

        {children}

        {preparationSteps?.length ? (
          <View style={exerciseStyles.beforeCard}>
            <Text style={exerciseStyles.beforeTitle}>
              Before You Begin
            </Text>

            {preparationSteps.map((step, index) => (
              <View
                key={`${step.icon}-${index}`}
                style={exerciseStyles.instructionRow}
              >
                <Ionicons
                  name={step.icon}
                  size={18}
                  color={COLORS.brown}
                />

                <Text style={exerciseStyles.instructionRowText}>
                  {step.text}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {targetDetails.length ? (
          <View style={exerciseStyles.targetGrid}>
            {targetDetails.map((item) => (
              <View
                key={item.label}
                style={exerciseStyles.targetItem}
              >
                <Text style={exerciseStyles.difficultyLabel}>
                  {item.label}
                </Text>

                <Text style={exerciseStyles.targetValue}>
                  {item.value}
                </Text>

                {item.hint ? (
                  <Text style={exerciseStyles.targetHint}>
                    {item.hint}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}

        {tip ? (
          <View style={exerciseStyles.disclaimerCard}>
            <Ionicons
              name="bulb-outline"
              size={21}
              color={COLORS.brown}
            />

            <Text style={exerciseStyles.tipText_Exercise}>
              {tip}
            </Text>
          </View>
        ) : null}
      </View>

      {tier ? (
        <View style={exerciseStyles.difficultyRow}>
          <View>
            <Text style={exerciseStyles.difficultyLabel}>
              DIFFICULTY
            </Text>

            <Text style={exerciseStyles.difficultyValue}>
              {tier.charAt(0).toUpperCase() + tier.slice(1)}
            </Text>
          </View>

          <View style={exerciseStyles.difficultyDots}>
            {tiers.map((level) => (
              <View
                key={level}
                style={[
                  exerciseStyles.difficultyDot,
                  level === tier &&
                    exerciseStyles.difficultyDotActive,
                ]}
              />
            ))}
          </View>
        </View>
      ) : null}

      {errorMessage ? (
        <View style={exerciseStyles.errorCard_Exercise}>
          <Ionicons
            name="alert-circle-outline"
            size={21}
            color={COLORS.alertIcon}
          />

          <Text style={exerciseStyles.errorText_Exercise}>
            {errorMessage}
          </Text>
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        disabled={startDisabled}
        style={[
          exerciseStyles.startButton_Exercise,
          startDisabled && exerciseStyles.quitModalButtonDisabled,
        ]}
        onPress={onStart}
      >
        <Ionicons
          name="play"
          size={20}
          color={COLORS.white}
        />

        <Text style={exerciseStyles.startButtonText_SingingAssessment}>
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
    <View style={[exerciseStyles.centerScreen, contentStyle]}>
      <View style={exerciseStyles.centerScreen}>
        <View style={exerciseStyles.phaseContent}>
          <View style={exerciseStyles.phaseIconCircle}>
            <Ionicons
              name={icon}
              size={44}
              color={COLORS.brown}
            />
          </View>

          <Text style={exerciseStyles.phaseTitle}>
            {title}
          </Text>

          {currentRep !== undefined &&
          repetitions !== undefined ? (
            <Text style={exerciseStyles.preparingSubtitle}>
              Repetition {currentRep} of {repetitions}
            </Text>
          ) : null}

          <Text style={exerciseStyles.countdownNumber}>
            {countdown}
          </Text>

          <Text style={exerciseStyles.phasePromptTitle}>
            {promptTitle}
          </Text>

          <Text style={exerciseStyles.phasePrompt}>
            {prompt}
          </Text>
        </View>
      </View>
    </View>
  );
}

export function ExerciseListeningScreen({
  title,
  prompt,
  referenceNotes,
  referenceContent,
  activeNoteIndex,
  errorMessage,
  isPlayingReference = false,
  onPlayReference,
  onReady,
}: ListeningScreenProps) {
  return (
    <View style={exerciseStyles.listeningScreen}>
      <Text style={exerciseStyles.listeningTitle}>{title}</Text>
      <Text style={exerciseStyles.listeningPrompt}>{prompt}</Text>

      {referenceContent ? (
        <View style={exerciseStyles.listeningReferenceContent}>
          {referenceContent}
        </View>
      ) : (
        <View style={exerciseStyles.listeningReferenceCard}>
          <ReferenceNoteSequence
            notes={referenceNotes ?? []}
            activeIndex={
              activeNoteIndex === undefined &&
              referenceNotes?.length === 1
                ? 0
                : activeNoteIndex
            }
          />
        </View>
      )}

      {errorMessage ? (
        <Text accessibilityRole="alert" style={exerciseStyles.listeningError}>
          {errorMessage}
        </Text>
      ) : null}

      {onPlayReference ? (
        <Pressable
          accessibilityRole="button"
          disabled={isPlayingReference}
          style={[
            exerciseStyles.listeningReferenceButton,
            isPlayingReference && exerciseStyles.disabled,
          ]}
          onPress={onPlayReference}
        >
          {isPlayingReference ? (
            <ActivityIndicator size="small" color={COLORS.brown} />
          ) : (
            <Ionicons name="play" size={18} color={COLORS.brown} />
          )}
          <Text style={exerciseStyles.componentScore}>
            {isPlayingReference ? 'Playing Reference...' : 'Play Reference'}
          </Text>
        </Pressable>
      ) : null}

      {onReady ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="I'm Ready"
          disabled={isPlayingReference}
          style={[
            exerciseStyles.listeningContinueButton,
            isPlayingReference && exerciseStyles.disabled,
          ]}
          onPress={onReady}
        >
          <Text
            style={[
              exerciseStyles.componentScore,
              { color: COLORS.white },
            ]}
          >
            I&apos;m Ready
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function ExerciseRecordingScreen({
  title,
  currentRep,
  repetitions,
  children,
}: {
  title: string;
  currentRep: number;
  repetitions: number;
  children: ReactNode;
}) {
  return (
    <View style={exerciseStyles.agilityRecordingScreen}>
      <View style={exerciseStyles.phaseContent}>
        <View style={exerciseStyles.agilityRecordingIcon}>
          <Ionicons name="mic" size={34} color={COLORS.brown} />
        </View>
        <Text style={exerciseStyles.phaseTitleVariant1}>{title}</Text>
        <Text style={exerciseStyles.detectedPitchTextSub}>
          Repetition {currentRep} of {repetitions}
        </Text>
        <View style={exerciseStyles.agilityRecordingBadge}>
          <View style={exerciseStyles.recordingDot} />
          <Text style={exerciseStyles.lyricStripTitle}>RECORDING</Text>
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
  children,
}: ProcessingScreenProps) {
  return (
    <View style={exerciseStyles.centerScreen}>

      <View style={exerciseStyles.phaseContent}>
        <View style={exerciseStyles.phaseIconCircle}>
          <Ionicons
            name={icon}
            size={44}
            color={COLORS.brown}
          />
        </View>

        <Text style={exerciseStyles.phaseTitle}>
          {title}
        </Text>

        <Text style={exerciseStyles.phasePrompt}>
          {message}
        </Text>

        <ActivityIndicator
          size="large"
          color={COLORS.brown}
          style={exerciseStyles.phaseSpinner}
        />
      </View>

      {children}
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
    <Container style={[exerciseStyles.centerScreen, containerStyle]}>
      {headerContent}
      <View style={exerciseStyles.phaseContent}>
        <View style={exerciseStyles.phaseIconCircle}>
          <Ionicons name={icon} size={iconSize} color={COLORS.brown} />
        </View>

        <Text style={exerciseStyles.phaseTitle}>{title}</Text>
        <Text style={exerciseStyles.preparingSubtitle}>{message}</Text>

        <ActivityIndicator
          size="large"
          color={COLORS.brown}
          style={exerciseStyles.phaseSpinner}
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
      ? exerciseStyles.noteMatchingMetricCard
      : variant === 'toneConsistency'
        ? exerciseStyles.toneConsistencyMetricCard
        : exerciseStyles.breathControlMetricCard;
  const labelStyle =
    variant === 'noteMatching'
      ? exerciseStyles.noteMatchingMetricLabel
      : variant === 'toneConsistency'
        ? exerciseStyles.toneConsistencyMetricLabel
        : exerciseStyles.breathControlMetricLabel;
  const valueStyle =
    variant === 'noteMatching'
      ? exerciseStyles.noteMatchingMetricValue
      : variant === 'toneConsistency'
        ? exerciseStyles.toneConsistencyMetricValue
        : exerciseStyles.breathControlMetricValue;

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
    <View style={exerciseStyles.metric}>
      <Text style={exerciseStyles.scoreRowLabel}>{label}</Text>
      <Text style={exerciseStyles.metricValue_Exercise}>{value}</Text>
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
    <View style={exerciseStyles.resultStat}>
      <Text style={exerciseStyles.resultStatValue}>{value}</Text>
      <Text style={[exerciseStyles.resultStatLabel_Exercise, { fontSize: labelFontSize }]}>
        {label}
      </Text>
    </View>
  );
}

export type ExerciseRepetitionScore = {
  repetition: number;
  score: number;
  passed?: boolean;
  components?: {
    label: string;
    value: string;
  }[];
};

export function ExerciseRepetitionBreakdown({
  repetitions,
}: {
  repetitions: ExerciseRepetitionScore[];
}) {
  return (
    <View style={exerciseStyles.repetitionBreakdown}>
      <Text style={exerciseStyles.repetitionBreakdownTitle}>
        Repetition Breakdown
      </Text>

      {repetitions.map(item => (
        <View
          key={item.repetition}
          style={exerciseStyles.repetitionBreakdownRow}
        >
          <View style={exerciseStyles.repetitionBreakdownHeader}>
            <Text style={exerciseStyles.repResultTitle}>
              Repetition {item.repetition}
            </Text>
            <View style={exerciseStyles.repetitionBreakdownScoreGroup}>
              {item.passed != null ? (
                <Text
                  style={[
                    exerciseStyles.repetitionBreakdownStatus,
                    item.passed
                      ? exerciseStyles.repetitionBreakdownPassed
                      : exerciseStyles.repetitionBreakdownNeedsPractice,
                  ]}
                >
                  {item.passed ? 'PASS' : 'PRACTICE'}
                </Text>
              ) : null}
              <Text style={exerciseStyles.largeBrownValue}>
                {Math.round(item.score)}%
              </Text>
            </View>
          </View>
          {item.components?.length ? (
            <View style={exerciseStyles.repetitionBreakdownComponents}>
              {item.components.map(component => (
                <View
                  key={`${item.repetition}-${component.label}`}
                  style={exerciseStyles.repetitionBreakdownComponent}
                >
                  <Text style={exerciseStyles.scoreRowLabel}>
                    {component.label}
                  </Text>
                  <Text style={exerciseStyles.smallSemiBoldBrownText}>
                    {component.value}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}

type ExerciseResultsScreenProps = {
  title: string;
  subtitle: string;
  score: number;
  repetitionScores?: ExerciseRepetitionScore[];
  resultIcon: keyof typeof Ionicons.glyphMap;
  scoreSuffix?: string;
  scoreMessage?: string;
  scoreDetails?: ReactNode;
  onRetry: () => void;
  onExit: () => void;
  children?: ReactNode;
};

export function ExerciseResultsScreen({
  title,
  subtitle,
  score,
  repetitionScores,
  resultIcon,
  scoreSuffix = '%',
  scoreMessage,
  scoreDetails,
  onRetry,
  onExit,
  children,
}: ExerciseResultsScreenProps) {
  return (
    <ScrollView
      style={exerciseStyles.screen}
      contentContainerStyle={exerciseStyles.content_Exercise}
      showsVerticalScrollIndicator={false}
    >
      <View style={exerciseStyles.resultsHeader}>
        <View style={exerciseStyles.resultsIconCircle}>
          <Ionicons
            name={resultIcon}
            size={42}
            color={COLORS.brown}
          />
        </View>

        <Text style={exerciseStyles.resultTitle}>
          {title}
        </Text>

        <Text style={exerciseStyles.resultsSubtitle_Exercise}>
          {subtitle}
        </Text>
      </View>

      <View style={exerciseStyles.resultsScoreCard}>
        <Text style={exerciseStyles.resultsScoreLabel}>
          OVERALL SCORE
        </Text>

        <Text style={exerciseStyles.resultsScoreValue}>
          {score}
          {scoreSuffix ? (
            <Text style={exerciseStyles.resultsScoreSuffix}>
              {scoreSuffix}
            </Text>
          ) : null}
        </Text>

        {scoreDetails != null ? (
          typeof scoreDetails === 'string' ||
          typeof scoreDetails === 'number' ? (
            <Text style={exerciseStyles.resultsScoreMessage}>
              {scoreDetails}
            </Text>
          ) : (
            scoreDetails
          )
        ) : null}

        {scoreMessage ? (
          <Text style={exerciseStyles.resultsScoreMessage}>
            {scoreMessage}
          </Text>
        ) : null}
      </View>

      {repetitionScores?.length ? (
        <ExerciseRepetitionBreakdown repetitions={repetitionScores} />
      ) : null}

      {children}

      <Pressable
        accessibilityRole="button"
        style={exerciseStyles.resultsRetryButton}
        onPress={onRetry}
      >
        <Ionicons
          name="refresh"
          size={20}
          color={COLORS.brown}
        />

        <Text style={exerciseStyles.cardTitle}>
          Try Again
        </Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        style={exerciseStyles.resultsExitButton}
        onPress={onExit}
      >
        <Text style={exerciseStyles.resultsExitText}>
          Back to Exercises
        </Text>
      </Pressable>
    </ScrollView>
  );
}
