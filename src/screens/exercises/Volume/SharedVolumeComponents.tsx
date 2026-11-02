import { StyleSheet, Text, View } from 'react-native';

import { COLORS } from '@/constants/appConstants';

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
      <View style={styles.freeModeWaveRow}>
        {actualBars.map((value, index) => (
          <View
            key={`volume-wave-${index}`}
            style={[
              styles.freeModeWave,
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
    <View
      style={[
        styles.visualizer,
        variant === 'crescendo' && styles.crescendoBars,
        variant === 'decrescendo' && styles.decrescendoBars,
      ]}
    >
      <View style={styles.actualBars}>
        {actualBars.map((height, index) => (
          <View
            key={`actual-${index}`}
            style={[
              styles.actualBar,
              variant === 'decrescendo' && styles.decrescendoBar,
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
        styles.resultItem,
        variant === 'crescendo' && styles.crescendoResultItem,
        variant === 'decrescendo' && styles.decrescendoResultItem,
      ]}
    >
      <Text
        style={[
          styles.resultItemLabel,
          variant === 'decrescendo' && styles.decrescendoResultItemLabel,
        ]}
      >
        {label}
      </Text>
      <Text style={styles.resultItemValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  visualizer: {
    height: 76,
    marginTop: 8,
    borderRadius: 12,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  actualBars: {
    position: 'absolute',
    left: 8,
    right: 8,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  actualBar: {
    flex: 1,
    maxWidth: 8,
    backgroundColor: COLORS.brown,
    borderRadius: 5,
  },
  crescendoBars: {
    gap: 3,
  },
  decrescendoBars: {
    gap: 0,
  },
  decrescendoBar: {
    marginHorizontal: 1,
  },
  resultItem: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  crescendoResultItem: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.background,
    gap: 12,
  },
  decrescendoResultItem: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingVertical: 7,
  },
  decrescendoResultItemLabel: {
    marginRight: 12,
  },
  freeModeWaveRow: {
    height: 86,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: 14,
    paddingHorizontal: 2,
  },
  freeModeWave: {
    width: 5,
    borderRadius: 999,
    backgroundColor: COLORS.accent,
    minHeight: 5,
  },
  resultItemLabel: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: COLORS.muted,
  },
  resultItemValue: {
    flexShrink: 1,
    fontFamily: 'FredokaSemiBold',
    fontSize: 10,
    color: COLORS.brown,
    textAlign: 'right',
  },
});
