import Ionicons from '@expo/vector-icons/Ionicons';
import { Fragment, type ReactNode } from 'react';
import { Text, View } from 'react-native';

import { COLORS } from '@/constants/appConstants';
import { exerciseStyles } from '@/constants/exerciseStyles';
import { clamp } from '@/utils/math';
import { getPitchDifferenceCents } from '@/utils/music/notes';
import { formatFrequency } from '@/utils/numberFormatting';

type RecordingNoteSequenceProps =
  | {
      variant: 'melody';
      notes: readonly string[];
      activeIndex: number;
      noteSize: number;
      gap: number;
    }
  | {
      variant: 'interval';
      notes: readonly [string, string];
      activeIndex: number;
    }
  | {
      variant: 'scale';
      notes: readonly string[];
      activeIndex: number;
    };

type NoteChipProps = {
  note: string;
  active?: boolean;
  size?: number;
};

export function NoteChip({
  note,
  active = false,
  size = 60,
}: NoteChipProps) {
  const fontSize = size >= 60 ? 18 : size >= 54 ? 16 : 14;

  return (
    <View
      style={[
        exerciseStyles.noteChip,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
        },
        active && exerciseStyles.resultIconPassed,
      ]}
    >
      <Text
        style={[
          exerciseStyles.noteChipText,
          { fontSize },
          active && exerciseStyles.periodTextActive,
        ]}
      >
        {note}
      </Text>
    </View>
  );
}

export function ReferenceNoteSequence({
  notes,
  activeIndex = null,
}: {
  notes: readonly string[];
  activeIndex?: number | null;
}) {
  return (
    <View style={exerciseStyles.listeningReferenceNotes}>
      {notes.map((note, index) => (
        <View
          key={`${note}-${index}`}
          style={[
            exerciseStyles.listeningReferenceNote,
            activeIndex === index &&
              exerciseStyles.listeningReferenceNoteActive,
          ]}
        >
          <Text style={exerciseStyles.listeningReferenceNoteText}>
            {note}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function RecordingNoteSequence(
  props: RecordingNoteSequenceProps,
) {
  if (props.variant === 'melody') {
    return (
      <View
        style={[
          exerciseStyles.recordingNoteList,
          { gap: props.gap },
        ]}
      >
        {props.notes.map((note, index) => (
          <NoteChip
            key={`${note}-${index}`}
            note={note}
            active={index === props.activeIndex}
            size={props.noteSize}
          />
        ))}
      </View>
    );
  }

  if (props.variant === 'interval') {
    return (
      <View style={exerciseStyles.intervalProgress}>
        {props.notes.map((note, index) => {
          const active = index === props.activeIndex;

          return (
            <Fragment key={`${note}-${index}`}>
              <View
                style={[
                  exerciseStyles.intervalProgressNote,
                  active && exerciseStyles.resultIconPassed,
                ]}
              >
                <Text
                  style={[
                    exerciseStyles.intervalProgressText,
                    active && exerciseStyles.liveNoteDetected,
                  ]}
                >
                  {note}
                </Text>
              </View>
              {index === 0 ? (
                <View style={exerciseStyles.progressLine} />
              ) : null}
            </Fragment>
          );
        })}
      </View>
    );
  }

  return (
    <View style={exerciseStyles.scalePreview}>
      {props.notes.map((note, index) => {
        const active = index === props.activeIndex;
        const completed = index < props.activeIndex;

        return (
          <View
            key={`${note}-${index}`}
            style={[
              exerciseStyles.previewNote,
              completed && exerciseStyles.previewNoteCompleted,
              active && exerciseStyles.previewNoteActive,
            ]}
          >
            {completed ? (
              <Ionicons
                name="checkmark"
                size={11}
                color={COLORS.guideGreen}
                style={exerciseStyles.previewCheck}
              />
            ) : null}

            <Text
              style={[
                exerciseStyles.previewNoteText,
                completed && exerciseStyles.statusTextSuccess,
                active && exerciseStyles.liveNoteDetected,
              ]}
            >
              {note}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

type LivePitchIndicatorProps = {
    targetNote: string;
    targetFrequency: number | null;
    detectedNote: string | null;
    detectedFrequency: number | null;
    pitchTrace?: readonly number[];
    children?: ReactNode;
};

export function LivePitchIndicator({
    targetNote,
    targetFrequency,
    detectedNote,
    detectedFrequency,
    pitchTrace = [],
    children,
}: LivePitchIndicatorProps) {
    const hasTarget =
      typeof targetFrequency === 'number' &&
      Number.isFinite(targetFrequency) &&
      targetFrequency > 0;
    const hasPitch =
      typeof detectedFrequency === 'number' &&
      Number.isFinite(detectedFrequency) &&
      detectedFrequency > 0;
    const cents =
      hasTarget && hasPitch
        ? getPitchDifferenceCents(detectedFrequency, targetFrequency)
        : null;
    const absoluteCents = cents === null ? null : Math.abs(cents);
    const color =
      absoluteCents === null
        ? COLORS.muted
        : absoluteCents <= 25
          ? COLORS.guideGreen
          : absoluteCents <= 60
            ? COLORS.guideYellow
            : COLORS.guideRed;
    const label =
      cents === null
        ? 'LISTENING'
        : absoluteCents !== null && absoluteCents <= 25
          ? 'IN TUNE'
          : absoluteCents !== null && absoluteCents <= 60
            ? cents > 0
              ? 'A LITTLE HIGH'
              : 'A LITTLE LOW'
            : cents > 0
              ? 'TOO HIGH'
              : 'TOO LOW';
    const position =
      cents === null ? 50 : clamp(50 + (cents / 100) * 43, 7, 93);
    const borderColor =
      cents === null ? COLORS.border : `${color}70`;

    return (
      <View
        accessibilityLabel={
          cents === null
            ? 'Live pitch guide waiting for a detected pitch.'
            : `Live pitch guide. Target ${targetNote}, detected ${detectedNote ?? 'unknown note'}.`
        }
        style={exerciseStyles.pitchGuideCard}
      >
        <View style={exerciseStyles.pitchGuideHeader}>
          <View style={exerciseStyles.referenceReadyRow}>
            <View style={exerciseStyles.liveStatusDot} />
            <Text style={exerciseStyles.pitchGuideTitle}>
              LIVE PITCH GUIDE
            </Text>
          </View>

          <View
            style={[
              exerciseStyles.guideStatusPill,
              {
                backgroundColor:
                  cents === null ? COLORS.lightGray : `${color}18`,
                borderColor,
              },
            ]}
          >
            <Text
              style={[
                exerciseStyles.guideStatusText,
                { color },
              ]}
            >
              {label}
            </Text>
          </View>
        </View>

        <View style={exerciseStyles.pitchGuideInner}>
          <View style={exerciseStyles.pitchTargetSummary}>
            <View style={exerciseStyles.infoText}>
              <Text style={exerciseStyles.pitchTargetCaption}>
                TARGET NOTE
              </Text>
              <Text style={exerciseStyles.pitchTargetValue}>
                {targetNote}
              </Text>
              <Text style={exerciseStyles.pitchTargetFrequency}>
                {formatFrequency(targetFrequency ?? 0, 0, '-- Hz')}
              </Text>
            </View>

            <View style={exerciseStyles.pitchComparisonArrow}>
              <Ionicons
                name="mic-outline"
                size={22}
                color={COLORS.muted}
              />
            </View>

            <View style={exerciseStyles.pitchDetectedSummary}>
              <Text style={exerciseStyles.pitchTargetCaption}>
                YOUR PITCH
              </Text>
              <Text
                style={[
                  exerciseStyles.pitchDetectedValue,
                  { color: cents === null ? COLORS.brown : color },
                ]}
              >
                {hasPitch ? detectedNote ?? '--' : '--'}
              </Text>
              <Text style={exerciseStyles.pitchTargetFrequency}>
                {formatFrequency(detectedFrequency ?? 0, 0, '-- Hz')}
              </Text>
            </View>
          </View>

          <View style={exerciseStyles.horizontalPitchMeter}>
            <View style={exerciseStyles.recordingProgressLabels}>
              <Text style={exerciseStyles.pitchMeterEdgeLabel}>
                ← LOW
              </Text>
              <Text style={exerciseStyles.pitchMeterCenterLabel}>
                TARGET
              </Text>
              <Text style={exerciseStyles.pitchMeterEdgeLabel}>
                HIGH →
              </Text>
            </View>

            <View style={exerciseStyles.pitchMeterTrack}>
              <View
                style={[
                  exerciseStyles.pitchMeterZone,
                  {
                    left: '0%',
                    width: '20%',
                    backgroundColor: COLORS.guideRed,
                    borderTopLeftRadius: 8,
                    borderBottomLeftRadius: 8,
                  },
                ]}
              />
              <View
                style={[
                  exerciseStyles.pitchMeterZone,
                  {
                    left: '20%',
                    width: '15%',
                    backgroundColor: COLORS.guideYellow,
                  },
                ]}
              />
              <View
                style={[
                  exerciseStyles.pitchMeterZone,
                  {
                    left: '35%',
                    width: '30%',
                    backgroundColor: COLORS.guideGreen,
                  },
                ]}
              />
              <View
                style={[
                  exerciseStyles.pitchMeterZone,
                  {
                    left: '65%',
                    width: '15%',
                    backgroundColor: COLORS.guideYellow,
                  },
                ]}
              />
              <View
                style={[
                  exerciseStyles.pitchMeterZone,
                  {
                    left: '80%',
                    width: '20%',
                    backgroundColor: COLORS.guideRed,
                    borderTopRightRadius: 8,
                    borderBottomRightRadius: 8,
                  },
                ]}
              />

              <View style={exerciseStyles.pitchMeterTargetLine} />

              {pitchTrace.map((sample, index) => {
                const traceCents = Math.abs(sample * 100);
                const traceColor =
                  traceCents <= 25
                    ? COLORS.guideGreen
                    : traceCents <= 60
                      ? COLORS.guideYellow
                      : COLORS.guideRed;

                return (
                  <View
                    key={`pitch-trace-${index}`}
                    style={[
                      exerciseStyles.pitchMeterTrace,
                      {
                        left: `${clamp(50 + sample * 43, 7, 93)}%`,
                        opacity:
                          0.2 +
                          (index / Math.max(pitchTrace.length, 1)) * 0.65,
                        backgroundColor: traceColor,
                      },
                    ]}
                  />
                );
              })}

              <View
                style={[
                  exerciseStyles.pitchMeterMarker,
                  {
                    left: `${position}%`,
                    borderColor: cents === null ? COLORS.muted : color,
                    opacity: cents === null ? 0.55 : 1,
                  },
                ]}
              >
                <View
                  style={[
                    exerciseStyles.pitchMeterMarkerInner,
                    { backgroundColor: cents === null ? COLORS.muted : color },
                  ]}
                />
              </View>
            </View>

            <View style={exerciseStyles.pitchMeterScale}>
              <Text style={exerciseStyles.scaleText}>
                -100 cents
              </Text>
              <Text style={exerciseStyles.scaleText}>0</Text>
              <Text style={exerciseStyles.scaleText}>
                +100 cents
              </Text>
            </View>
          </View>
        </View>

        {children}
      </View>
    );
}
