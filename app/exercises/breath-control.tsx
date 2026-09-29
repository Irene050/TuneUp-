import { useLocalSearchParams } from 'expo-router';

import BreathControlExercisesScreen from '../../src/screens/exercises/BreathControl/BreathControlExercisesScreen';
import BreathControlFreeModeScreen from '../../src/screens/exercises/BreathControl/BreathControlFreeModeScreen';
import ControlledBreathReleaseScreen from '../../src/screens/exercises/BreathControl/ControlledBreathReleaseScreen';
import DiaphragmaticBreathingScreen from '../../src/screens/exercises/BreathControl/DiaphragmaticBreathingScreen';
import SteadyAirflowMaintenanceScreen from '../../src/screens/exercises/BreathControl/SteadyAirflowMaintenanceScreen';
import SustainedExhaleScreen from '../../src/screens/exercises/BreathControl/SustainedExhaleScreen';
import SustainedSSSSScreen from '../../src/screens/exercises/BreathControl/SustainedSSSSScreen';

export default function BreathControlRoute() {
  const { mode, templateId } =
    useLocalSearchParams<{
      templateId?: string;
      mode?: string;
    }>();

  if (mode === 'free') {
    return <BreathControlFreeModeScreen />;
  }

  if (!templateId) {
    return <BreathControlExercisesScreen />;
  }

  switch (templateId) {
    case 'sustainedExhale':
      return <SustainedExhaleScreen />;

    case 'sustainedSSSS':
      return <SustainedSSSSScreen />;

    case 'diaphragmaticBreathing':
      return <DiaphragmaticBreathingScreen />;

    case 'steadyAirflowMaintenance':
      return <SteadyAirflowMaintenanceScreen />;

    case 'controlledBreathRelease':
      return <ControlledBreathReleaseScreen />;

    default:
      return null;
  }
}