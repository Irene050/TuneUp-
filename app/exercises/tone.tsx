import { useLocalSearchParams } from 'expo-router';

import FrequencyZoneStabilityScreen from '../../src/screens/exercises/Tone/FrequencyZoneStabilityScreen';
import SteadyToneHoldingScreen from '../../src/screens/exercises/Tone/SteadyToneHoldingScreen';
import ToneConsistencyExerciseScreen from '../../src/screens/exercises/Tone/ToneConsistencyExerciseScreen';
import ToneExercisesScreen from '../../src/screens/exercises/Tone/ToneExercisesScreen';
import VowelConsistencyExerciseScreen from '../../src/screens/exercises/Tone/VowelConsistencyExerciseScreen';
import WaveformSmoothnessDrillScreen from '../../src/screens/exercises/Tone/WaveformSmoothnessDrillScreen';

export default function ToneRoute() {
  const { mode, templateId } = useLocalSearchParams<{
    templateId?: string;
    mode?: string;
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
      return <ToneExercisesScreen />;;
  }
}