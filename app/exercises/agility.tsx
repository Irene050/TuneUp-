import { useLocalSearchParams } from 'expo-router';

import RapidNoteTransitionExerciseScreen from '../../src/screens/exercises/Agility/RapidNoteTransitionExerciseScreen';

export default function AgilityRoute() {
  const { templateId } =
    useLocalSearchParams<{
      templateId?: string;
    }>();

  /*
   * For now, Rapid Note Transition is the first
   * Agility exercise being implemented.
   *
   * If no templateId is supplied, open the first
   * Agility exercise by default.
   */
  switch (templateId) {
    case undefined:
    case 'rapidNoteTransitionExercise':
      return (
        <RapidNoteTransitionExerciseScreen
          tier="beginner"
        />
      );

    default:
      return (
        <RapidNoteTransitionExerciseScreen
          tier="beginner"
        />
      );
  }
}