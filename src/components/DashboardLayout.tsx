import { router } from 'expo-router';
import type { ReactNode } from 'react';
import {
    Image,
    Pressable,
    StyleSheet,
    View,
} from 'react-native';

export type DashboardTab =
  | 'index'
  | 'exercises'
  | 'profile'
  | 'assessment'
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
  const showTabBar =
    activeTab === 'index' ||
    activeTab === 'exercises' ||
    activeTab === 'profile';

  return (
    <View style={styles.container}>
      <View style={styles.screen}>{children}</View>

      {showTabBar && (
        <View style={styles.tabBar}>
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
                  styles.tabButton,
                  centerTab && styles.centerTabButton,
                ]}
                onPress={() => router.setParams({ tab: tabItem.name })}
              >
                {centerTab ? (
                  <View style={styles.centerCircle}>
                    <View
                      style={
                        focused ? styles.centerActiveCircle : undefined
                      }
                    >
                      <Image
                        source={tabItem.icon}
                        style={styles.centerIcon}
                        resizeMode="contain"
                      />
                    </View>
                  </View>
                ) : (
                  <View
                    style={[
                      styles.iconContainer,
                      focused && styles.activeCircle,
                    ]}
                  >
                    <Image
                      source={tabItem.icon}
                      style={styles.icon}
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

const PINK = '#FCD6DD';
const LIGHT_GRAY = '#F0F0F0';
const WHITE = '#FFFFFF';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: WHITE,
  },
  screen: {
    flex: 1,
  },
  tabBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 95,
    backgroundColor: WHITE,
    borderTopLeftRadius: 50,
    borderTopRightRadius: 50,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 0,
    elevation: 20,
    shadowColor: '#000000',
    shadowOpacity: 0.25,
    shadowRadius: 18,
    shadowOffset: {
      width: 0,
      height: -6,
    },
    overflow: 'visible',
  },
  tabButton: {
    flex: 1,
    height: 95,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 0,
  },
  centerTabButton: {
    zIndex: 100,
    elevation: 100,
  },
  iconContainer: {
    width: 50,
    height: 50,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeCircle: {
    backgroundColor: LIGHT_GRAY,
    borderRadius: 999,
  },
  icon: {
    width: 26,
    height: 26,
  },
  centerCircle: {
    width: 100,
    height: 100,
    borderRadius: 999,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'absolute',
    bottom: 18,
    zIndex: 100,
    elevation: 20,
    shadowColor: '#000000',
    shadowOpacity: 0.25,
    shadowRadius: 14,
    shadowOffset: {
      width: 0,
      height: 7,
    },
  },
  centerActiveCircle: {
    width: 60,
    height: 60,
    borderRadius: 999,
    backgroundColor: LIGHT_GRAY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerIcon: {
    width: 35,
    height: 35,
  },
});