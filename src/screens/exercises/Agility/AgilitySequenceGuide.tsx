import Ionicons from '@expo/vector-icons/Ionicons';
import { ScrollView, Text, View } from 'react-native';

import { COLORS } from '@/constants/appConstants';
import { exerciseStyles } from '@/constants/exerciseStyles';
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

  return semitoneDistance === 1
    ? COLORS.guideYellow
    : COLORS.guideRed;
}

export function AgilitySequenceGuide({
  names,
  caption = 'Follow the notes from left to right',
  activeIndex = null,
  noteDurationSec,
  gapSec,
  liveNote,
  showFeedback = false,
}: {
  names: string[];
  caption?: string;
  activeIndex?: number | null;
  noteDurationSec?: number;
  gapSec?: number;
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
    <View style={exerciseStyles.card}>
      <View style={exerciseStyles.referenceReadyRow}>
        <Ionicons
          name="musical-notes-outline"
          size={18}
          color={COLORS.brown}
        />
        <Text style={exerciseStyles.infoName}>Your note path</Text>
      </View>

      <Text style={exerciseStyles.caption}>{caption}</Text>
      {typeof noteDurationSec === 'number' &&
      Number.isFinite(noteDurationSec) &&
      noteDurationSec > 0 &&
      typeof gapSec === 'number' &&
      Number.isFinite(gapSec) &&
      gapSec >= 0 ? (
        <Text style={exerciseStyles.caption}>
          {`Note ${noteDurationSec.toFixed(2)}s · Gap ${gapSec.toFixed(2)}s · Interval ${(noteDurationSec + gapSec).toFixed(2)}s`}
        </Text>
      ) : null}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={exerciseStyles.scrollContent}
      >
        <View style={[exerciseStyles.canvas, { width: staffWidth }]}>
          {[0, 1, 2, 3, 4].map(line => (
            <View
              key={`staff-line-${line}`}
              style={[exerciseStyles.line, { top: 12 + line * 10 }]}
            />
          ))}

          <View style={exerciseStyles.treble}>
            <Text style={exerciseStyles.trebleClef}>𝄞</Text>
          </View>

          {names.map((name, index) => {
            const normalized =
              (stepValues[index] - minStep) / range;

            const top = 48 - normalized * 34;
            const left = 34 + index * itemWidth;
            const active = activeIndex === index;

            const feedbackColor =
              active && showFeedback
                ? getFeedbackColor(name, liveNote)
                : null;

            const noteColor = active
              ? feedbackColor ?? COLORS.waveform
              : COLORS.brown;

            const haloBorderColor = active
              ? feedbackColor ?? COLORS.otherpink
              : 'transparent';

            return (
              <View key={`${name}-${index}`}>
                <View
                  style={[
                    exerciseStyles.halo,
                    {
                      left: left - 5,
                      top: top - 5,
                      backgroundColor: active
                        ? COLORS.pink
                        : 'transparent',
                      borderColor: haloBorderColor,
                      borderWidth: active ? 2 : 0,
                    },
                  ]}
                />

                <View
                  style={[
                    exerciseStyles.noteHead,
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
                    exerciseStyles.noteStem,
                    {
                      left: left + 9,
                      top: top - 15,
                      backgroundColor: noteColor,
                    },
                  ]}
                />

                <Text
                  style={[
                    exerciseStyles.noteNumber,
                    {
                      left: left - 5,
                      color: active
                        ? noteColor
                        : COLORS.muted,
                    },
                  ]}
                >
                  {index + 1}
                </Text>

                <Text
                  style={[
                    exerciseStyles.noteName,
                    {
                      left: left - 10,
                      color: active
                        ? noteColor
                        : COLORS.brown,
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

      <View style={exerciseStyles.legend}>
        {[
          {
            color: COLORS.waveform,
            label: 'Active note',
            border: true,
          },
          { color: COLORS.guideGreen, label: 'Correct' },
          { color: COLORS.guideYellow, label: 'Close' },
          { color: COLORS.guideRed, label: 'Off pitch' },
        ].map(item => (
          <View key={item.label} style={exerciseStyles.legendItem}>
            <View
              style={[
                exerciseStyles.liveStatusDot,
                {
                  backgroundColor: item.color,
                  borderColor: item.border
                    ? COLORS.otherpink
                    : item.color,
                  borderWidth: item.border ? 1 : 0,
                },
              ]}
            />
            <Text style={exerciseStyles.scaleText}>
              {item.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
