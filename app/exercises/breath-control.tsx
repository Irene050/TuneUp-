import { useLocalSearchParams } from 'expo-router';

import ControlledBreathReleaseScreen from '../../src/screens/exercises/BreathControl/ControlledBreathReleaseScreen';
import DiaphragmaticBreathingScreen from '../../src/screens/exercises/BreathControl/DiaphragmaticBreathingScreen';
import SteadyAirflowMaintenanceScreen from '../../src/screens/exercises/BreathControl/SteadyAirflowMaintenanceScreen';
import SustainedExhaleScreen from '../../src/screens/exercises/BreathControl/SustainedExhaleScreen';
import SustainedSSSSScreen from '../../src/screens/exercises/BreathControl/SustainedSSSSScreen';

export default function BreathControlRoute() {
  const { templateId } =
    useLocalSearchParams<{
      templateId?: string;
    }>();

  switch (templateId) {
    case 'sustainedExhale':
      return (
        <SustainedExhaleScreen
          tier="beginner"
        />
      );

    case 'sustainedSSSS':
      return (
        <SustainedSSSSScreen
          tier="beginner"
        />
      );

    case 'diaphragmaticBreathing':
      return (
        <DiaphragmaticBreathingScreen
          tier="beginner"
        />
      );

    case 'steadyAirflowMaintenance':
      return (
        <SteadyAirflowMaintenanceScreen
          tier="beginner"
        />
      );

    case 'controlledBreathRelease':
      return (
        <ControlledBreathReleaseScreen
          tier="beginner"
        />
      );

    default:
      return null;
  }
}