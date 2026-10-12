import { useLocalSearchParams } from 'expo-router';

import ExerciseListScreen from '../../src/screens/exercises/ExerciseListScreen';
import FrequencyZoneStabilityScreen from '../../src/screens/exercises/Tone/FrequencyZoneStabilityScreen';
import SteadyToneHoldingScreen from '../../src/screens/exercises/Tone/SteadyToneHoldingScreen';
import ToneConsistencyExerciseScreen from '../../src/screens/exercises/Tone/ToneConsistencyExerciseScreen';
import VowelConsistencyExerciseScreen from '../../src/screens/exercises/Tone/VowelConsistencyExerciseScreen';
import WaveformSmoothnessDrillScreen from '../../src/screens/exercises/Tone/WaveformSmoothnessDrillScreen';

export default function ToneRoute() {
  const { templateId } = useLocalSearchParams<{
    templateId?: string;
  }>();

  switch (templateId) {
    case 'vowelConsistencyExercise':
      return <VowelConsistencyExerciseScreen />;
    case 'waveformSmoothnessDrill':
      return <WaveformSmoothnessDrillScreen />;
    case 'frequencyZoneStability':
      return <FrequencyZoneStabilityScreen />;
    case 'toneConsistencyExercise':
      return <ToneConsistencyExerciseScreen />;
    case 'steadyToneHolding':
      return <SteadyToneHoldingScreen />;
    default:
      return <ExerciseListScreen component="tone" />;
  }
}