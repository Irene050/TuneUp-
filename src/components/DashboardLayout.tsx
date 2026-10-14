import { router } from 'expo-router';
import type { ReactNode } from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();

  const isCompactScreen = height < 720 || width < 360;
  const tabBarHeight = isCompactScreen ? 76 : 84;
  const sideIconContainerSize = isCompactScreen ? 44 : 50;
  const sideIconSize = isCompactScreen ? 24 : 26;
  const centerCircleSize = isCompactScreen ? 82 : 90;
  const centerActiveSize = isCompactScreen ? 54 : 60;
  const centerIconSize = isCompactScreen ? 30 : 35;
  const centerCircleBottom = isCompactScreen ? 12 : 14;
  const safeBottom = Math.max(insets.bottom, 8);

  const showTabBar =
    activeTab === 'index' ||
    activeTab === 'exercises' ||
    activeTab === 'profile';

  // Reserve enough screen space for the tab bar and its raised center button.
  // This prevents scrollable dashboard content from rendering underneath it.
  const contentBottomInset = showTabBar
    ? safeBottom + Math.max(tabBarHeight, centerCircleSize + centerCircleBottom)
    : 0;

  return (
    <View style={styles.container}>
      <View style={[styles.screen, { paddingBottom: contentBottomInset }]}>
        {children}
      </View>

      {showTabBar && (
        <View
          style={[
            styles.tabBar,
            {
              height: tabBarHeight,
              bottom: safeBottom,
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
                  styles.tabButton,
                  { height: tabBarHeight },
                  centerTab && styles.centerTabButton,
                ]}
                onPress={() => router.setParams({ tab: tabItem.name })}
              >
                {centerTab ? (
                  <View
                    style={[
                      styles.centerCircle,
                      {
                        width: centerCircleSize,
                        height: centerCircleSize,
                        borderRadius: centerCircleSize / 2,
                        bottom: centerCircleBottom,
                      },
                    ]}
                  >
                    <View
                      style={[
                        focused && styles.centerActiveCircle,
                        focused && {
                          width: centerActiveSize,
                          height: centerActiveSize,
                          borderRadius: centerActiveSize / 2,
                        },
                      ]}
                    >
                      <Image
                        source={tabItem.icon}
                        style={[
                          styles.centerIcon,
                          {
                            width: centerIconSize,
                            height: centerIconSize,
                          },
                        ]}
                        resizeMode="contain"
                      />
                    </View>
                  </View>
                ) : (
                  <View
                    style={[
                      styles.iconContainer,
                      {
                        width: sideIconContainerSize,
                        height: sideIconContainerSize,
                        borderRadius: sideIconContainerSize / 2,
                      },
                      focused && styles.activeCircle,
                    ]}
                  >
                    <Image
                      source={tabItem.icon}
                      style={[
                        styles.icon,
                        {
                          width: sideIconSize,
                          height: sideIconSize,
                        },
                      ]}
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
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'absolute',
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
    backgroundColor: LIGHT_GRAY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerIcon: {
    width: 35,
    height: 35,
  },
});
