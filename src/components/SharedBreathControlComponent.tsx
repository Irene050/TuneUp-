import {
  Text,
  View,
  type DimensionValue,
} from 'react-native';
import type { LiveVoiceDetection } from '@/utils/audioSignal';
import { exerciseStyles } from '@/constants/exerciseStyles';

export default function LiveVoiceDetectionVisualizer({
  detected,
  level,
}: LiveVoiceDetection) {
  const fillWidth = `${Math.max(0, Math.min(1, level)) * 100}%` as DimensionValue;

  return (
    <View style={exerciseStyles.airflowCard}>
      <View style={exerciseStyles.resultDetailRow}>
        <Text style={exerciseStyles.airflowLabel}>
          LIVE VOICE DETECTION
        </Text>

        <View style={exerciseStyles.legendItem}>
          <View
            style={[
              exerciseStyles.statusDot,
              detected && exerciseStyles.statusDotActive,
            ]}
          />
          <Text style={exerciseStyles.scoreLabel}>
            {detected ? 'Detected' : 'Listening'}
          </Text>
        </View>
      </View>

      <View style={exerciseStyles.airflowIndicator}>
        <View
          style={[
            exerciseStyles.airflowFill,
            { width: fillWidth },
          ]}
        />
      </View>
    </View>
  );
}
