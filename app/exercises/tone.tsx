// app/exercises/tone.tsx

import { useLocalSearchParams } from 'expo-router';

import FrequencyZoneStabilityScreen from '../../src/screens/exercises/Tone/FrequencyZoneStabilityScreen';
import SteadyToneHoldingScreen from '../../src/screens/exercises/Tone/SteadyToneHoldingScreen';
import ToneConsistencyExerciseScreen from '../../src/screens/exercises/Tone/ToneConsistencyExerciseScreen';
import ToneExercisesScreen from '../../src/screens/exercises/Tone/ToneExercisesScreen';
import ToneFreeModeScreen from '../../src/screens/exercises/Tone/ToneFreeModeScreen';
import VowelConsistencyExerciseScreen from '../../src/screens/exercises/Tone/VowelConsistencyExerciseScreen';
import WaveformSmoothnessDrillScreen from '../../src/screens/exercises/Tone/WaveformSmoothnessDrillScreen';

export default function ToneRoute() {
  const { mode, templateId } = useLocalSearchParams<{
    templateId?: string;
    mode?: string;
  }>();

  if (mode === 'free') {
    return <ToneFreeModeScreen />;
  }

  if (!templateId) {
    return <ToneExercisesScreen />;
  }

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
      return null;
  }
}