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

type ExerciseConfirmationModalProps = {
  visible: boolean;
  title: string;
  message: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel: string;
  cancelLabel: string;
  icon?: keyof typeof Ionicons.glyphMap;
  confirmFirst?: boolean;
  isDisabled?: boolean;
  statusBarTranslucent?: boolean;
};

export function ExerciseConfirmationModal({
  visible,
  title,
  message,
  onConfirm,
  onCancel,
  confirmLabel,
  cancelLabel,
  icon = 'help-circle-outline',
  confirmFirst = false,
  isDisabled = false,
  statusBarTranslucent = true,
}: ExerciseConfirmationModalProps) {
  const cancelButton = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={cancelLabel}
      disabled={isDisabled}
      onPress={onCancel}
      style={({ pressed }) => [
        confirmFirst
          ? exerciseStyles.quitButton
          : exerciseStyles.continueButton,
        pressed && exerciseStyles.buttonPressed,
        isDisabled && exerciseStyles.buttonDisabled,
      ]}
    >
      <Text
        style={
          confirmFirst
            ? exerciseStyles.quitButtonText
            : exerciseStyles.cardTitle
        }
      >
        {cancelLabel}
      </Text>
    </Pressable>
  );
  const confirmButton = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={confirmLabel}
      disabled={isDisabled}
      onPress={onConfirm}
      style={({ pressed }) => [
        confirmFirst
          ? exerciseStyles.continueButton
          : exerciseStyles.quitButton,
        pressed && exerciseStyles.buttonPressed,
        isDisabled && exerciseStyles.buttonDisabled,
      ]}
    >
      <Text
        style={
          confirmFirst
            ? exerciseStyles.cardTitle
            : exerciseStyles.quitButtonText
        }
      >
        {confirmLabel}
      </Text>
    </Pressable>
  );
  const actionButtons = confirmFirst ? (
    <>
      {confirmButton}
      {cancelButton}
    </>
  ) : (
    <>
      {cancelButton}
      {confirmButton}
    </>
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent={statusBarTranslucent}
      onRequestClose={onCancel}
    >
      <View style={exerciseStyles.modalOverlay}>
        <View
          accessibilityRole="alert"
          accessibilityLabel={title}
          style={exerciseStyles.modalCard}
        >
          <View style={exerciseStyles.modalIcon}>
            <Ionicons name={icon} size={30} color={COLORS.brown} />
          </View>

          <Text style={exerciseStyles.modalTitle}>{title}</Text>
          <Text style={exerciseStyles.modalMessage}>{message}</Text>
          {actionButtons}
        </View>
      </View>
    </Modal>
  );
}

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