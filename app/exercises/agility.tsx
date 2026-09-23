// app/exercises/agility.tsx

import { useLocalSearchParams } from 'expo-router';

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
      return <ArpeggioSpeedDrillScreen tier="beginner" />;

    case 'quickIntervalJump':
      return <QuickIntervalJumpScreen tier="beginner" />;

    case 'rapidNoteTransition':
      return (
        <RapidNoteTransitionExerciseScreen
          tier="beginner"
        />
      );

    case 'rapidScaleTrill':
      return <RapidScaleTrillScreen tier="beginner" />;

    case 'vocalRunAccuracy':
      return <VocalRunAccuracyTaskScreen tier="beginner" />;

    default:
      return null;
  }
}