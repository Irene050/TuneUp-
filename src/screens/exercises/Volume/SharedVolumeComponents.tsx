import Ionicons from '@expo/vector-icons/Ionicons';
import { ScrollView, Text, View } from 'react-native';

import { COLORS, VOLUME_RAMP_BAR_COUNT } from '@/constants/appConstants';
import { exerciseStyles } from '@/constants/exerciseStyles';
import { clamp } from '@/utils/math';

type VolumeVisualizerVariant =
  | 'crescendo'
  | 'decrescendo'
  | 'freeMode';
type ResultItemVariant = 'crescendo' | 'decrescendo';

export function VolumeVisualizer({
  liveHistory,
  barCount,
  variant,
}: {
  liveHistory: number[];
  barCount: number;
  variant: VolumeVisualizerVariant;
}) {
  const actualBars = Array.from(
    { length: barCount },
    (_, index) => liveHistory[index] ?? 0,
  );

  if (variant === 'freeMode') {
    return (
      <View style={exerciseStyles.freeModeWaveRow}>
        {actualBars.map((value, index) => (
          <View
            key={`volume-wave-${index}`}
            style={[
              exerciseStyles.freeModeWave,
              {
                height:
                  value > 0
                    ? `${Math.max(5, value * 100)}%`
                    : '5%',
                opacity: value === 0 ? 0.15 : 0.3 + value * 0.7,
              },
            ]}
          />
        ))}
      </View>
    );
  }

  return (
    <View style={exerciseStyles.visualizer_SharedVolumeComponents}>
      <View style={exerciseStyles.actualBars_SharedVolumeComponents}>
        {actualBars.map((height, index) => (
          <View
            key={`actual-${index}`}
            style={[
              exerciseStyles.actualBar_SharedVolumeComponents,
              {
                height:
                  height > 0
                    ? `${Math.max(5, height * 82)}%`
                    : '0%',
              },
            ]}
          />
        ))}
      </View>
    </View>
  );
}

export function VolumeRampRecordingContent({
  direction,
  instruction,
  liveHistory,
  seconds,
  guideElapsed,
  durationSeconds,
  currentRep,
  repetitions,
  liveSmoothness,
}: {
  direction: 'crescendo' | 'decrescendo';
  instruction: { title: string; subtitle: string };
  liveHistory: number[];
  seconds: number;
  guideElapsed: number;
  durationSeconds: number;
  currentRep: number;
  repetitions: number;
  liveSmoothness: number;
}) {
  const progress = clamp(
    durationSeconds > 0 ? seconds / durationSeconds : 0,
    0,
    1,
  );
  const guideProgress = clamp(
    durationSeconds > 0 ? guideElapsed / durationSeconds : 0,
    0,
    1,
  );
  const activeGuideBar = Math.min(
    VOLUME_RAMP_BAR_COUNT - 1,
    Math.floor(guideProgress * VOLUME_RAMP_BAR_COUNT),
  );
  const directionLabel =
    direction === 'crescendo'
      ? { start: 'SOFT', end: 'LOUD' }
      : { start: 'LOUD', end: 'SOFT' };

  return (
    <View style={exerciseStyles.screenVariant1}>
      <View style={exerciseStyles.exercisePrompt}>
        <Text style={exerciseStyles.exercisePromptTitle}>
          {instruction.title}
        </Text>
        <Text style={exerciseStyles.exercisePromptSubtitle}>
          {instruction.subtitle}
        </Text>
      </View>

      <ScrollView
        style={exerciseStyles.infoText}
        contentContainerStyle={exerciseStyles.exerciseScrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={exerciseStyles.liveContent}>
          <View style={exerciseStyles.guideCard}>
            <Text style={exerciseStyles.cardTitle}>Follow this pattern</Text>

            <View style={exerciseStyles.guideBars}>
              {Array.from(
                { length: VOLUME_RAMP_BAR_COUNT },
                (_, index) => {
                  const rampProgress =
                    index / Math.max(1, VOLUME_RAMP_BAR_COUNT - 1);
                  const height = direction === 'crescendo'
                    ? 0.08 + Math.pow(rampProgress, 0.75) * 0.92
                    : 0.83 - rampProgress * 0.65;

                  return (
                    <View
                      key={`target-guide-${direction}-${index}`}
                      style={[
                        exerciseStyles.guideBar,
                        {
                          height: `${height * 100}%`,
                          backgroundColor:
                            index === activeGuideBar
                              ? COLORS.accent
                              : index < activeGuideBar
                                ? COLORS.otherpink
                                : COLORS.border,
                        },
                      ]}
                    />
                  );
                },
              )}

              <View
                pointerEvents="none"
                style={[
                  exerciseStyles.guideIndicator,
                  { left: `${Math.min(guideProgress * 100, 98.5)}%` },
                ]}
              />
            </View>

            <View style={exerciseStyles.guideLabels}>
              <Text style={exerciseStyles.guideLabel}>
                {directionLabel.start}
              </Text>
              <Text style={exerciseStyles.guideLabel}>
                {directionLabel.end}
              </Text>
            </View>

            <View style={exerciseStyles.guideProgressTrack}>
              <View
                style={[
                  exerciseStyles.guideProgressFill,
                  { width: `${guideProgress * 100}%` },
                ]}
              />
            </View>
          </View>

          <View style={exerciseStyles.visualizerCard}>
            <View style={exerciseStyles.resultDetailRow}>
              <View>
                <Text style={exerciseStyles.resultStatValue}>
                  Your Performance
                </Text>
                <Text style={exerciseStyles.exerciseHeaderSubtitle}>
                  Match the target {direction}
                </Text>
              </View>

              <View style={exerciseStyles.micCircle}>
                <Ionicons name="mic" size={18} color={COLORS.brown} />
              </View>
            </View>

            <View style={exerciseStyles.visualizerLegend}>
              <View style={exerciseStyles.legendDot} />
              <Text style={exerciseStyles.legendText}>Your voice</Text>
            </View>

            <VolumeVisualizer
              liveHistory={liveHistory}
              barCount={VOLUME_RAMP_BAR_COUNT}
              variant={direction}
            />

            <View style={exerciseStyles.rangeRow}>
              <Text style={exerciseStyles.visualizerLabel}>
                {directionLabel.start}
              </Text>
              <Text style={exerciseStyles.visualizerLabel}>
                {directionLabel.end}
              </Text>
            </View>
          </View>

          <View style={exerciseStyles.sessionRow}>
            <View style={exerciseStyles.sessionPart}>
              <Text style={exerciseStyles.sessionLabel}>REPETITION</Text>
              <Text style={exerciseStyles.sessionValue}>
                {currentRep} / {repetitions}
              </Text>
            </View>

            <View style={exerciseStyles.sessionDivider} />

            <View style={exerciseStyles.sessionPart}>
              <Text style={exerciseStyles.sessionLabel}>TIME</Text>
              <Text style={exerciseStyles.sessionValue}>
                0:{String(seconds).padStart(2, '0')}
              </Text>
            </View>

            <View style={exerciseStyles.sessionDivider} />

            <View style={exerciseStyles.sessionPart}>
              <Text style={exerciseStyles.sessionLabel}>SMOOTHNESS</Text>
              <Text style={exerciseStyles.sessionValue}>
                {liveSmoothness}%
              </Text>
            </View>
          </View>

          <View style={exerciseStyles.exerciseProgressTrack}>
            <View
              style={[
                exerciseStyles.exerciseProgressFill,
                { width: `${progress * 100}%` },
              ]}
            />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

export function ResultItem({
  label,
  value,
  variant,
}: {
  label: string;
  value: string;
  variant: ResultItemVariant;
}) {
  return (
    <View
      style={[
        exerciseStyles.resultItem,
        variant === 'crescendo' && exerciseStyles.crescendoResultItem,
        variant === 'decrescendo' && exerciseStyles.decrescendoResultItem,
      ]}
    >
      <Text
        style={[
          exerciseStyles.resultItemLabel,
          variant === 'decrescendo' && exerciseStyles.decrescendoResultItemLabel,
        ]}
      >
        {label}
      </Text>
      <Text style={exerciseStyles.resultItemValue}>{value}</Text>
    </View>
  );
}
