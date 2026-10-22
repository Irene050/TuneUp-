import { useLocalSearchParams } from 'expo-router';
import type { ComponentType } from 'react';

import DashboardLayout, {
  type DashboardTab,
} from '@/components/DashboardLayout';
import AssessmentScreen from '@/screens/dashboard/AssessmentScreen';
import DashboardScreen from '@/screens/dashboard/DashboardScreen';
import ExercisesScreen from '@/screens/dashboard/ExercisesScreen';
import ProfileScreen from '@/screens/dashboard/ProfileScreen';
import ProgressScreen from '@/screens/dashboard/ProgressScreen';
import SingingAssessmentScreen from '@/screens/dashboard/SingingAssessmentScreen';

const screens: Record<DashboardTab, ComponentType> = {
  index: DashboardScreen,
  exercises: ExercisesScreen,
  profile: ProfileScreen,
  assessment: AssessmentScreen,
  progress: ProgressScreen,
  singing: SingingAssessmentScreen,
};

export default function DashboardRoute() {
  const { tab } = useLocalSearchParams<{ tab?: string }>();
  const activeTab: DashboardTab =
    tab === 'exercises' ||
    tab === 'profile' ||
    tab === 'assessment' ||
    tab === 'singing' ||
    tab === 'progress'
      ? tab
      : 'index';
  const Screen = screens[activeTab];

  return (
    <DashboardLayout activeTab={activeTab}>
      <Screen />
    </DashboardLayout>
  );
}
