import Ionicons from '@expo/vector-icons/Ionicons';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { COLORS } from '@/constants/appConstants';
import { noteNameToMidi } from '@/utils/music/notes';

function getFeedbackColor(
  targetNote: string,
  liveNote: string | undefined,
): string | null {
  if (!liveNote || liveNote === '--') {
    return null;
  }

  const targetMidi = noteNameToMidi(targetNote);
  const liveMidi = noteNameToMidi(liveNote);

  if (targetMidi === null || liveMidi === null) {
    return null;
  }

  const semitoneDistance = Math.abs(targetMidi - liveMidi);

  if (semitoneDistance === 0) {
    return COLORS.guideGreen;
  }

  return semitoneDistance === 1 ? COLORS.guideYellow : COLORS.guideRed;
}

export function AgilitySequenceGuide({
  names,
  caption = 'Follow the notes from left to right',
  activeIndex = null,
  liveNote,
  showFeedback = false,
}: {
  names: string[];
  caption?: string;
  activeIndex?: number | null;
  liveNote?: string;
  showFeedback?: boolean;
}) {
  const stepValues = names.map(name => {
    const match = name.match(/^([A-G])(#|b)?(-?\d+)$/i);

    if (!match) {
      return 2;
    }

    const steps: Record<string, number> = {
      C: 0,
      D: 1,
      E: 2,
      F: 3,
      G: 4,
      A: 5,
      B: 6,
    };

    return (
      (Number(match[3]) - 4) * 7 +
      steps[match[1].toUpperCase()]
    );
  });
  const minStep = Math.min(...stepValues, 0);
  const maxStep = Math.max(...stepValues, 4);
  const range = Math.max(4, maxStep - minStep);
  const itemWidth = 38;
  const staffWidth = Math.max(210, names.length * itemWidth + 42);

  return (
    <View style={styles.card}>
      <View style={styles.heading}>
        <Ionicons
          name="musical-notes-outline"
          size={18}
          color={COLORS.brown}
        />
        <Text style={styles.title}>Your note path</Text>
      </View>

      <Text style={styles.caption}>{caption}</Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        <View style={[styles.canvas, { width: staffWidth }]}>
          {[0, 1, 2, 3, 4].map(line => (
            <View
              key={`staff-line-${line}`}
              style={[styles.line, { top: 12 + line * 10 }]}
            />
          ))}

          <View style={styles.treble}>
            <Text style={styles.trebleClef}>𝄞</Text>
          </View>

          {names.map((name, index) => {
            const normalized = (stepValues[index] - minStep) / range;
            const top = 48 - normalized * 34;
            const left = 34 + index * itemWidth;
            const active = activeIndex === index;
            const feedbackColor =
              active && showFeedback
                ? getFeedbackColor(name, liveNote)
                : null;
            const referenceActive = active && !showFeedback;
            const noteColor =
              feedbackColor ??
              (referenceActive ? COLORS.waveform : COLORS.brown);

            return (
              <View key={`${name}-${index}`}>
                <View
                  style={[
                    styles.halo,
                    active
                      ? {
                          backgroundColor: COLORS.pink,
                          borderColor: referenceActive
                            ? COLORS.waveform
                            : feedbackColor ?? COLORS.otherpink,
                        }
                      : styles.inactiveHalo,
                    { left: left - 5, top: top - 5 },
                  ]}
                />
                <View
                  style={[
                    styles.noteHead,
                    {
                      left,
                      top,
                      backgroundColor: noteColor,
                      borderColor: noteColor,
                    },
                  ]}
                />
                <View
                  style={[
                    styles.noteStem,
                    {
                      left: left + 9,
                      top: top - 15,
                      backgroundColor: noteColor,
                    },
                  ]}
                />
                <Text
                  style={[
                    styles.noteNumber,
                    {
                      left: left - 5,
                      color: active ? noteColor : COLORS.muted,
                    },
                  ]}
                >
                  {index + 1}
                </Text>
                <Text
                  style={[
                    styles.noteName,
                    {
                      left: left - 10,
                      color: active ? noteColor : COLORS.brown,
                    },
                  ]}
                >
                  {name}
                </Text>
              </View>
            );
          })}
        </View>
      </ScrollView>

      <View style={styles.legend}>
        {[
          { color: COLORS.waveform, label: 'Active note', border: true },
          { color: COLORS.guideGreen, label: 'Correct' },
          { color: COLORS.guideYellow, label: 'Close' },
          { color: COLORS.guideRed, label: 'Off pitch' },
        ].map(item => (
          <View key={item.label} style={styles.legendItem}>
            <View
              style={[
                styles.legendDot,
                {
                  backgroundColor: item.color,
                  borderColor: item.border ? COLORS.otherpink : item.color,
                  borderWidth: item.border ? 1 : 0,
                },
              ]}
            />
            <Text style={styles.legendText}>{item.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    backgroundColor: COLORS.background,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 10,
    paddingHorizontal: 11,
    marginTop: 10,
  },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  title: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: COLORS.brown,
  },
  caption: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 16,
    color: COLORS.muted,
    marginTop: 4,
  },
  scrollContent: {
    flexGrow: 1,
    minWidth: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 8,
    paddingBottom: 2,
  },
  canvas: {
    height: 86,
    marginTop: 2,
    alignSelf: 'center',
  },
  line: {
    position: 'absolute',
    left: 8,
    right: 8,
    height: 1,
    backgroundColor: COLORS.pink,
  },
  treble: {
    position: 'absolute',
    left: 0,
    top: 3,
    width: 24,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  trebleClef: {
    fontSize: 32,
    lineHeight: 38,
    color: COLORS.brown,
    fontFamily: 'serif',
    includeFontPadding: false,
  },
  halo: {
    position: 'absolute',
    width: 23,
    height: 18,
    borderRadius: 10,
    borderWidth: 2,
    zIndex: 0,
  },
  inactiveHalo: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
    borderWidth: 0,
  },
  noteHead: {
    position: 'absolute',
    width: 12,
    height: 8,
    borderRadius: 6,
    borderWidth: 1,
    transform: [{ rotate: '-20deg' }],
    zIndex: 1,
  },
  noteStem: {
    position: 'absolute',
    width: 1.5,
    height: 18,
    zIndex: 1,
  },
  noteNumber: {
    position: 'absolute',
    top: 57,
    width: 24,
    textAlign: 'center',
    fontFamily: 'FredokaRegular',
    fontSize: 9,
    color: COLORS.muted,
  },
  noteName: {
    position: 'absolute',
    top: 70,
    width: 32,
    textAlign: 'center',
    fontFamily: 'FredokaBold',
    fontSize: 10,
    color: COLORS.brown,
  },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    marginTop: 4,
    gap: 6,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: COLORS.brown,
  },
  legendText: {
    fontFamily: 'FredokaRegular',
    fontSize: 9,
    color: COLORS.muted,
  },
});
