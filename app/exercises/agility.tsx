import { useLocalSearchParams } from 'expo-router';

import AgilityExercisesScreen from '../../src/screens/exercises/Agility/AgilityExercisesScreen';
import ArpeggioSpeedDrillScreen from '../../src/screens/exercises/Agility/ArpeggioSpeedDrillScreen';
import QuickIntervalJumpScreen from '../../src/screens/exercises/Agility/QuickIntervalJumpScreen';
import RapidNoteTransitionExerciseScreen from '../../src/screens/exercises/Agility/RapidNoteTransitionExerciseScreen';
import RapidScaleTrillScreen from '../../src/screens/exercises/Agility/RapidScaleTrillScreen';
import VocalRunAccuracyTaskScreen from '../../src/screens/exercises/Agility/VocalRunAccuracyTaskScreen';

export default function AgilityRoute() {
  const { templateId } = useLocalSearchParams<{
      templateId?: string;
    }>();

  switch (templateId) {
    case 'arpeggioSpeed':
      return <ArpeggioSpeedDrillScreen />;
    case 'quickIntervalJump':
      return <QuickIntervalJumpScreen />;
    case 'rapidNoteTransition':
      return <RapidNoteTransitionExerciseScreen/>
    case 'rapidScaleTrill':
      return <RapidScaleTrillScreen/>
    case 'vocalRunAccuracy':
      return <VocalRunAccuracyTaskScreen/>
    default:
      return <AgilityExercisesScreen />;;
  }
}