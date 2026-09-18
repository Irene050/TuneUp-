// app/exercises/tone.tsx

import { useLocalSearchParams } from 'expo-router';

import ResonanceStabilizationTaskScreen from '../../src/screens/exercises/Tone/ResonanceStabilizationTaskScreen';
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
      return <VowelConsistencyExerciseScreen tier="beginner" />;

    case 'waveformSmoothnessDrill':
      return <WaveformSmoothnessDrillScreen tier="beginner" />;

    case 'resonanceStabilizationTask':
      return <ResonanceStabilizationTaskScreen tier="beginner" />;

    case 'toneConsistencyExercise':
      return <ToneConsistencyExerciseScreen tier="beginner" />;

    case 'steadyToneHolding':
      return <SteadyToneHoldingScreen tier="beginner" />;

    default:
      return null;
  }
}