import { exerciseStyles } from '@/constants/exerciseStyles';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import {
  Image,
  Pressable,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type DashboardTab =
  | 'index'
  | 'exercises'
  | 'profile'
  | 'assessment'
  | 'singing'
  | 'progress';

type DashboardLayoutProps = {
  activeTab: DashboardTab;
  children: ReactNode;
};

const tabs = [
  {
    name: 'index',
    label: 'Home',
    icon: require('@/assets/images/tabIcons/home.png'),
  },
  {
    name: 'exercises',
    label: 'Exercises',
    icon: require('@/assets/images/tabIcons/exercises.png'),
  },
  {
    name: 'profile',
    label: 'Profile',
    icon: require('@/assets/images/tabIcons/profile.png'),
  },
] as const;

export default function DashboardLayout({
  activeTab,
  children,
}: DashboardLayoutProps) {
  const insets = useSafeAreaInsets();
  const bottomInset = insets.bottom;
  const showTabBar =
    activeTab === 'index' ||
    activeTab === 'exercises' ||
    activeTab === 'profile';

  return (
    <View style={exerciseStyles.screen}>
      <View
      style={[
      exerciseStyles.dashboardScreen,
        { paddingBottom: showTabBar ? 95 + bottomInset : 0 },
      ]}
    >
      {children}
    </View>

  {showTabBar && (
    <View
        style={[
          exerciseStyles.dashboardTabBar,
            {
              bottom: bottomInset,
              height: 95,
            },
          ]}
        >
    
      {tabs.map((tabItem) => {
        const focused = activeTab === tabItem.name;
        const centerTab = tabItem.name === 'exercises';

        return (
          <Pressable
            key={tabItem.name}
            accessibilityLabel={tabItem.label}
            accessibilityRole="button"
            accessibilityState={{ selected: focused }}
              style={[
                exerciseStyles.dashboardTabButton,
                centerTab && exerciseStyles.dashboardCenterTabButton,
              ]}
              onPress={() => router.setParams({ tab: tabItem.name })}
            >
            
            {centerTab ? (
              <View style={exerciseStyles.dashboardCenterCircle}>
                <View
                  style={
                    focused ? exerciseStyles.dashboardCenterActiveCircle : undefined
                  }
                  >
                  <Image
                    source={tabItem.icon}
                    style={exerciseStyles.dashboardCenterIcon}
                    resizeMode="contain"
                  />
                </View>
              </View>
              ) : (
              <View
                style={[
                  exerciseStyles.dashboardIconContainer,
                  focused && exerciseStyles.dashboardActiveCircle,
                ]}
                >
                <Image
                  source={tabItem.icon}
                  style={exerciseStyles.dashboardIcon}
                  resizeMode="contain"
                  />
              </View>
            )}
          </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}
