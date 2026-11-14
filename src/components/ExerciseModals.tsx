import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';

import { COLORS } from '@/constants/appConstants';
import { exerciseStyles } from '@/constants/exerciseStyles';

type ExerciseQuitModalProps = {
  visible: boolean;
  message: ReactNode;
  onContinue: () => void;
  onQuit: () => void;
  isQuitting: boolean;
  title?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  hint?: ReactNode;
  continueLabel?: string;
  quitLabel?: string;
  quittingLabel?: string;
  statusBarTranslucent?: boolean;
};

export function ExerciseQuitModal({
  visible,
  message,
  onContinue,
  onQuit,
  isQuitting,
  title = 'Quit Exercise?',
  icon = 'exit-outline',
  hint,
  continueLabel = 'Continue Exercise',
  quitLabel = 'Quit Exercise',
  quittingLabel = 'Stopping...',
  statusBarTranslucent = true,
}: ExerciseQuitModalProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent={statusBarTranslucent}
      onRequestClose={onContinue}
    >
      <View style={exerciseStyles.quitModalOverlay}>
        <View
          accessibilityRole="alert"
          accessibilityLabel="Quit exercise confirmation"
          style={exerciseStyles.quitModalCard}
        >
          <View style={exerciseStyles.quitModalIconCircle}>
            <Ionicons name={icon} size={30} color={COLORS.brown} />
          </View>

          <Text style={exerciseStyles.quitModalTitle}>{title}</Text>
          <Text style={exerciseStyles.quitModalMessage}>{message}</Text>
          {hint ? (
            <Text style={exerciseStyles.quitModalHint}>{hint}</Text>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={continueLabel}
            disabled={isQuitting}
            onPress={onContinue}
            style={({ pressed }) => [
              exerciseStyles.noAudioRedoButton,
              pressed && exerciseStyles.buttonPressed,
              isQuitting && exerciseStyles.quitModalButtonDisabled,
            ]}
          >
            <Text style={exerciseStyles.cardTitle}>{continueLabel}</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={quitLabel}
            disabled={isQuitting}
            onPress={onQuit}
            style={({ pressed }) => [
              exerciseStyles.quitModalAssessmentQuitButton,
              pressed && exerciseStyles.buttonPressed,
              isQuitting && exerciseStyles.quitModalButtonDisabled,
            ]}
          >
            <Text style={exerciseStyles.quitButtonText}>
              {isQuitting ? quittingLabel : quitLabel}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

type ExerciseNoAudioModalProps = {
  visible: boolean;
  onRedo: () => void;
  onQuit: () => void;
  isQuitting: boolean;
};

export function ExerciseNoAudioModal({
  visible,
  onRedo,
  onQuit,
  isQuitting,
}: ExerciseNoAudioModalProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onRedo}
    >
      <View style={exerciseStyles.quitModalOverlay}>
        <View
          accessibilityRole="alert"
          accessibilityLabel="No audio captured"
          style={exerciseStyles.quitModalCard}
        >
          <View style={exerciseStyles.quitModalIconCircle}>
            <Ionicons
              name="mic-off-outline"
              size={30}
              color={COLORS.brown}
            />
          </View>

          <Text style={exerciseStyles.quitModalTitle}>No audio captured</Text>
          <Text style={exerciseStyles.quitModalMessage}>
            There was no audio captured for this repetition. Check your
            microphone and try again.
          </Text>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Redo repetition"
            disabled={isQuitting}
            onPress={onRedo}
            style={({ pressed }) => [
              exerciseStyles.noAudioRedoButton,
              pressed && exerciseStyles.buttonPressed,
              isQuitting && exerciseStyles.quitModalButtonDisabled,
            ]}
          >
            <Text style={exerciseStyles.cardTitle}>Redo Repetition</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Quit exercise"
            disabled={isQuitting}
            onPress={onQuit}
            style={({ pressed }) => [
              exerciseStyles.quitModalAssessmentQuitButton,
              pressed && exerciseStyles.buttonPressed,
              isQuitting && exerciseStyles.quitModalButtonDisabled,
            ]}
          >
            <Text style={exerciseStyles.quitButtonText}>
              {isQuitting ? 'Leaving...' : 'Quit Exercise'}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}