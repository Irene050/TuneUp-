// app/exercises/agility.tsx

import { useLocalSearchParams } from 'expo-router';

import AgilityExercisesScreen from '../../src/screens/exercises/Agility/AgilityExercisesScreen';
import AgilityFreeModeScreen from '../../src/screens/exercises/Agility/AgilityFreeModeScreen';
import ArpeggioSpeedDrillScreen from '../../src/screens/exercises/Agility/ArpeggioSpeedDrillScreen';
import QuickIntervalJumpScreen from '../../src/screens/exercises/Agility/QuickIntervalJumpScreen';
import RapidNoteTransitionExerciseScreen from '../../src/screens/exercises/Agility/RapidNoteTransitionExerciseScreen';
import RapidScaleTrillScreen from '../../src/screens/exercises/Agility/RapidScaleTrillScreen';
import VocalRunAccuracyTaskScreen from '../../src/screens/exercises/Agility/VocalRunAccuracyTaskScreen';

export default function AgilityRoute() {
  const { mode, templateId } =
    useLocalSearchParams<{
      templateId?: string;
      mode?: string;
    }>();

  if (mode === 'free') {
    return <AgilityFreeModeScreen />;
  }

  if (!templateId) {
    return <AgilityExercisesScreen />;
  }

  switch (templateId) {
    /*
     * Arpeggio Speed Drill
     *
     * Determines the user's current Agility tier
     * internally.
     */
    case 'arpeggioSpeedDrill':
      return <ArpeggioSpeedDrillScreen />;

    /*
     * Quick Interval Jump
     *
     * Determines the user's current Agility tier
     * internally and applies ADS.
     */
    case 'quickIntervalJump':
      return <QuickIntervalJumpScreen />;

    /*
     * Rapid Note Transition
     *
     * Still uses the tier prop for now.
     */
    case 'rapidNoteTransition':
      return (
        <RapidNoteTransitionExerciseScreen
        />
      );

    /*
     * Rapid Scale Trill
     *
     * Still uses the tier prop for now.
     */
    case 'rapidScaleTrill':
      return (
        <RapidScaleTrillScreen
        />
      );

    /*
     * Vocal Run Accuracy Task
     *
     * Still uses the tier prop for now.
     */
    case 'vocalRunAccuracy':
      return (
        <VocalRunAccuracyTaskScreen
        />
      );

    default:
      return null;
  }
}