import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import {
  Text,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import { COLORS, TONE_WAVEFORM_BAR_COUNT } from '@/constants/appConstants';
import { exerciseStyles } from '@/constants/exerciseStyles';

export function createToneWaveformBars(
  pitch: number,
  hasPitch: boolean,
  voicedVariation = 0.65,
): number[] {
  return Array.from({ length: TONE_WAVEFORM_BAR_COUNT }, (_, index) => {
    const center = (TONE_WAVEFORM_BAR_COUNT - 1) / 2;
    const distance = Math.abs(index - center) / center;
    const envelope = 1 - distance * 0.65;
    const phaseOffset = index * 0.72;
    const variation = hasPitch
      ? 0.35 +
        Math.abs(Math.sin(phaseOffset + pitch * 0.001)) *
          voicedVariation
      : 0.12 + Math.abs(Math.sin(phaseOffset)) * 0.12;

    return Math.max(5, Math.round(38 * envelope * variation));
  });
}

export type ToneWaveformProps = {
  bars: readonly number[];
  color: string;
  hasPitch: boolean;
  accessibilityLabel: string;
  statusText: string;
  statusTextStyle: StyleProp<TextStyle>;
  barKeyPrefix?: string;
};

type LiveToneMonitorCardProps = {
  children?: ReactNode;
  waveform?: ToneWaveformProps;
};

export function LiveToneMonitorCard({
  children,
  waveform,
}: LiveToneMonitorCardProps) {
  return (
    <View style={exerciseStyles.liveCardVariant10}>
      <View style={exerciseStyles.liveCardHeader}>
        <View style={exerciseStyles.liveMicCircle}>
          <Ionicons name="mic" size={21} color={COLORS.waveform} />
        </View>

        <View style={exerciseStyles.feedbackContent}>
          <Text style={exerciseStyles.infoName}>
            Live Voice Monitor
          </Text>
          <Text style={exerciseStyles.repResultDetails}>
            Your microphone feedback
          </Text>
        </View>

        <View style={exerciseStyles.liveIndicatorPill}>
          <View style={exerciseStyles.recordingDotVariant1} />
          <Text style={exerciseStyles.liveIndicatorText}>LIVE</Text>
        </View>
      </View>

      {waveform ? (
        <View style={exerciseStyles.waveformContainer}>
          <View
            style={exerciseStyles.waveformBars}
            accessibilityLabel={waveform.accessibilityLabel}
          >
            {waveform.bars.map((height, index) => (
              <View
                key={`${waveform.barKeyPrefix ?? 'tone-wave'}-${index}`}
                style={[
                  exerciseStyles.waveformBar,
                  {
                    height,
                    backgroundColor: waveform.color,
                    opacity: waveform.hasPitch ? 0.9 : 0.45,
                  },
                ]}
              />
            ))}
          </View>

          <View style={exerciseStyles.waveformStatusRow}>
            <View
              style={[
                exerciseStyles.statusDot,
                { backgroundColor: waveform.color },
              ]}
            />
            <Text
              style={[
                waveform.statusTextStyle,
                { color: waveform.color },
              ]}
            >
              {waveform.statusText}
            </Text>
          </View>
        </View>
      ) : null}

      {children}
    </View>
  );
}
