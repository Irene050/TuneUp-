import { Tabs } from 'expo-router';
import { Image, Pressable, StyleSheet, View } from 'react-native';

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_GRAY = '#F0F0F0';
const WHITE = '#FFFFFF';

type TabButtonProps = {
  icon: any;
  focused: boolean;
  center?: boolean;
  onPress: () => void;
};

function TabButton({
  icon,
  focused,
  center = false,
  onPress,
}: TabButtonProps) {
  return (
    <Pressable
      style={[
        styles.tabButton,
        center && styles.centerTabButton,
      ]}
      onPress={onPress}
    >
      {center ? (
        <View style={styles.centerCircle}>
            {focused && (
              <View style={styles.centerActiveCircle}>
                <Image
                  source={icon}
                  style={styles.centerIcon}
                  resizeMode="contain"
                />
              </View>
            )}

            {!focused && (
              <Image
                source={icon}
                style={styles.centerIcon}
                resizeMode="contain"
              />
            )}
        </View>
      ) : (
        <View
          style={[
            styles.iconContainer,
            focused && styles.activeCircle,
          ]}
        >
          <Image
            source={icon}
            style={styles.icon}
            resizeMode="contain"
          />
        </View>
      )}
    </Pressable>
  );
}

export default function AppTabs() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
      }}
      tabBar={({ state, navigation }) => (
        <View style={styles.tabBar}>
          {state.routes.map((route, index) => {
            const focused = state.index === index;

            let icon;
            let center = false;

            if (route.name === 'index') {
              icon = require('@/assets/images/home.png');
            }

            if (route.name === 'exercises') {
              icon = require('@/assets/images/tabIcons/exercises.png');
              center = true;
            }

            if (route.name === 'profile') {
              icon = require('@/assets/images/tabIcons/profile.png');
            }

            return (
              <TabButton
                key={route.key}
                icon={icon}
                focused={focused}
                center={center}
                onPress={() => {
                  const event = navigation.emit({
                    type: 'tabPress',
                    target: route.key,
                    canPreventDefault: true,
                  });

                  if (!focused && !event.defaultPrevented) {
                    navigation.navigate(route.name);
                  }
                }}
              />
            );
          })}
        </View>
      )}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
        }}
      />

      <Tabs.Screen
        name="exercises"
        options={{
          title: 'Exercises',
        }}
      />

      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
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
  flex: 1, 
  height: 95, 
  alignItems: 'center', 
  justifyContent: 'center',
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
    borderRadius: 999
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

  // Gray circle shown ON TOP of pink when active
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