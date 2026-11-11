import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

import { COLORS } from '@/constants/appConstants';
import { exerciseStyles } from '@/constants/exerciseStyles';

type LiveToneMonitorCardProps = {
  children: ReactNode;
};

export function LiveToneMonitorCard({
  children,
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

      {children}
    </View>
  );
}
