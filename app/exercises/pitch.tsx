import { useLocalSearchParams } from 'expo-router';

import IntervalRecognitionTaskScreen from '../../src/screens/exercises/Pitch/IntervalRecognitionTaskScreen';
import MelodicPatternMatchingScreen from '../../src/screens/exercises/Pitch/MelodicPatternMatchingScreen';
import NoteMatchingScreen from '../../src/screens/exercises/Pitch/NoteMatchingScreen';
import PitchExercisesScreen from '../../src/screens/exercises/Pitch/PitchExercisesScreen';
import PitchFreeModeScreen from '../../src/screens/exercises/Pitch/PitchFreeModeScreen';
import ScaleAccuracyDrillScreen from '../../src/screens/exercises/Pitch/ScaleAccuracyDrillScreen';
import SustainedNoteStabilityScreen from '../../src/screens/exercises/Pitch/SustainedNoteStabilityScreen';

export default function PitchRoute() {
  const { mode, templateId } = useLocalSearchParams<{
      templateId?: string;
      mode?: string;
    }>();

  if (mode === 'free') {
    return <PitchFreeModeScreen />;
  }

  switch (templateId) {
    case 'noteMatchingExercise':
      return <NoteMatchingScreen />;
    case 'scaleAccuracyDrill':
      return <ScaleAccuracyDrillScreen />;
    case 'intervalRecognitionTask':
      return <IntervalRecognitionTaskScreen />;
    case 'sustainedNoteStability':
      return <SustainedNoteStabilityScreen />;
    case 'melodicPatternMatching':
      return <MelodicPatternMatchingScreen />;
    default:
      return <PitchExercisesScreen />;
  }
}