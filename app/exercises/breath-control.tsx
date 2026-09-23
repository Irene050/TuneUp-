import {
  useLocalSearchParams,
} from 'expo-router';

import ControlledBreathReleaseScreen from '../../src/screens/exercises/BreathControl/ControlledBreathReleaseScreen';
import DiaphragmaticBreathingScreen from '../../src/screens/exercises/BreathControl/DiaphragmaticBreathingScreen';
import SteadyAirflowMaintenanceScreen from '../../src/screens/exercises/BreathControl/SteadyAirflowMaintenanceScreen';
import SustainedExhaleScreen from '../../src/screens/exercises/BreathControl/SustainedExhaleScreen';
import SustainedSSSSScreen from '../../src/screens/exercises/BreathControl/SustainedSSSSScreen';

import type {
  Tier,
} from '@/constants/exercises/breathControl';

import {
  generateSustainedExhaleParams,
} from '@/services/exerciseSession/generateParams/breathControl';

export default function BreathControlRoute() {
  const {
    templateId,
    tier: tierParam,
  } =
    useLocalSearchParams<{
      templateId?: string;
      tier?: string;
    }>();

  const validTiers: Tier[] = [
    'beginner',
    'intermediate',
    'advanced',
  ];

  const tier: Tier =
    validTiers.includes(
      tierParam as Tier
    )
      ? (tierParam as Tier)
      : 'beginner';

  switch (templateId) {
    case 'sustainedExhale': {
      const generatedParams =
        generateSustainedExhaleParams(
          tier
        );

      return (
        <SustainedExhaleScreen
          tier={tier}
          generatedParams={
            generatedParams
          }
        />
      );
    }

    case 'sustainedSSSS':
      return (
        <SustainedSSSSScreen
          tier={tier}
        />
      );

    case 'diaphragmaticBreathing':
      return (
        <DiaphragmaticBreathingScreen
          tier={tier}
        />
      );

    case 'steadyAirflow':
      return (
        <SteadyAirflowMaintenanceScreen
          tier={tier}
        />
      );

    case 'controlledBreathRelease':
      return (
        <ControlledBreathReleaseScreen
          tier={tier}
        />
      );

    default:
      return null;
  }
}