import { useLocalSearchParams } from 'expo-router';

import ControlledCrescendoDrill from '@/screens/exercises/Volume/ControlledCrescendoDrillScreen';
import ControlledDecrescendoDrill from '@/screens/exercises/Volume/ControlledDecrescendoDrillScreen';
import DynamicRangeExercise from '@/screens/exercises/Volume/DynamicRangeExerciseScreen';
import VolumeBandTargeting from '@/screens/exercises/Volume/VolumeBandTargetingScreen';
import VolumeControlStabilityScreen from '@/screens/exercises/Volume/VolumeControlStabilityScreen';
import VolumeFreeModeScreen from '@/screens/exercises/Volume/VolumeFreeModeScreen';
import ExerciseListScreen from '../../src/screens/exercises/ExerciseListScreen';

export default function VolumeRoute() {
  const { mode, templateId } = useLocalSearchParams<{
    mode?: string;
    templateId?: string;
  }>();

  if (mode === 'free') {
    return <VolumeFreeModeScreen />;
  }

  switch (templateId) {
    case 'dynamic-range':
      return <DynamicRangeExercise />;
    case 'controlled-crescendo':
      return <ControlledCrescendoDrill />;
    case 'controlled-decrescendo':
      return <ControlledDecrescendoDrill />;
    case 'volume-band-targeting':
      return <VolumeBandTargeting />;
    case 'volume-control-stability':
      return <VolumeControlStabilityScreen />;
    default:
      return <ExerciseListScreen component="volume" />;
  }
}