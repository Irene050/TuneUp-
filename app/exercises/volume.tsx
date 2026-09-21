import { useLocalSearchParams } from 'expo-router';

import ControlledCrescendoDrillScreen from '../../src/screens/exercises/Volume/ControlledCrescendoDrillScreen';
import ControlledDecrescendoDrillScreen from '../../src/screens/exercises/Volume/ControlledDecrescendoDrillScreen';
import DynamicRangeExerciseScreen from '../../src/screens/exercises/Volume/DynamicRangeExerciseScreen';
import VolumeBandTargetingScreen from '../../src/screens/exercises/Volume/VolumeBandTargetingScreen';
import VolumeControlStabilityScreen from '../../src/screens/exercises/Volume/VolumeControlStabilityScreen';

export default function VolumeRoute() {
  const { templateId } =
    useLocalSearchParams<{
      templateId?: string;
    }>();

  switch (templateId) {
    case 'noteMatchingExercise':
      return (
        <DynamicRangeExerciseScreen
          tier="beginner"
        />
      );

    case 'scaleAccuracyDrill':
      return (
        <ControlledCrescendoDrillScreen
          tier="beginner"
        />
      );

    case 'intervalRecognitionTask':
      return (
        <ControlledDecrescendoDrillScreen
          tier="beginner"
        />
      );

    case 'sustainedNoteStability':
      return (
        <VolumeBandTargetingScreen
          tier="beginner"
        />
      );

    case 'melodicPatternMatching':
      return (
        <VolumeControlStabilityScreen
          tier="beginner"
        />
      );

    default:
      return null;
  }
}