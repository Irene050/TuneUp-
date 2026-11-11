import Ionicons from '@expo/vector-icons/Ionicons';
import {
  Modal,
  Pressable,
  Text,
  View,
} from 'react-native';

import { COLORS } from '@/constants/appConstants';
import { exerciseStyles } from '@/constants/exerciseStyles';

type AssessmentProgressActionsProps = {
  onOpenDashboard: () => void;
  onOpenExerciseLibrary: () => void;
};

export function AssessmentProgressActions({
  onOpenDashboard,
  onOpenExerciseLibrary,
}: AssessmentProgressActionsProps) {
  return (
    <View style={exerciseStyles.assessmentBackgroundActions}>
      <Text style={exerciseStyles.processingText}>
        Results may take a little while. You can leave this screen; we will let
        you know when they are ready.
      </Text>

      <Pressable
        accessibilityRole="button"
        style={exerciseStyles.primaryButton_Assessment}
        onPress={onOpenDashboard}
      >
        <Text style={exerciseStyles.startButtonText}>Go to Dashboard</Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        style={exerciseStyles.primaryButton_Assessment}
        onPress={onOpenExerciseLibrary}
      >
        <Text style={exerciseStyles.startButtonText}>View Exercise Library</Text>
      </Pressable>
    </View>
  );
}

type AssessmentCompletionModalProps = {
  visible: boolean;
  title: string;
  message: string;
  onClose: () => void;
  onCheckResults: () => void;
};

export function AssessmentCompletionModal({
  visible,
  title,
  message,
  onClose,
  onCheckResults,
}: AssessmentCompletionModalProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={exerciseStyles.modalOverlay}>
        <View style={exerciseStyles.modalCard}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close notification"
            style={exerciseStyles.assessmentCompletionClose}
            onPress={onClose}
          >
            <Ionicons name="close" size={24} color={COLORS.brown} />
          </Pressable>

          <View style={exerciseStyles.modalIcon}>
            <Ionicons
              name="checkmark"
              size={32}
              color={COLORS.brown}
            />
          </View>

          <Text style={exerciseStyles.modalTitle}>{title}</Text>
          <Text style={exerciseStyles.modalMessage}>{message}</Text>

          <Pressable
            accessibilityRole="button"
            style={exerciseStyles.primaryModalButton}
            onPress={onCheckResults}
          >
            <Text style={exerciseStyles.primaryModalText}>Check Results</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
