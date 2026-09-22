import { useLocalSearchParams } from 'expo-router';

import IntervalRecognitionTaskScreen from '../../src/screens/exercises/Pitch/IntervalRecognitionTaskScreen';
import MelodicPatternMatchingScreen from '../../src/screens/exercises/Pitch/MelodicPatternMatchingScreen';
import NoteMatchingScreen from '../../src/screens/exercises/Pitch/NoteMatchingScreen';
import ScaleAccuracyDrillScreen from '../../src/screens/exercises/Pitch/ScaleAccuracyDrillScreen';
import SustainedNoteStabilityScreen from '../../src/screens/exercises/Pitch/SustainedNoteStabilityScreen';

export default function PitchRoute() {
  const { templateId } =
    useLocalSearchParams<{
      templateId?: string;
    }>();

  switch (templateId) {
    case 'noteMatchingExercise':
      return (
        <NoteMatchingScreen
          tier="beginner"
        />
      );

    case 'scaleAccuracyDrill':
      return (
        <ScaleAccuracyDrillScreen
          tier="beginner"
        />
      );

    case 'intervalRecognitionTask':
      return (
        <IntervalRecognitionTaskScreen
          tier="beginner"
        />
      );

    case 'sustainedNoteStability':
      return (
        <SustainedNoteStabilityScreen
          tier="beginner"
        />
      );

    case 'melodicPatternMatching':
      return (
        <MelodicPatternMatchingScreen
          tier="beginner"
        />
      );

    default:
      return null;
  }
}