import AppHeader from '@/components/appheader';
import Ionicons from '@expo/vector-icons/Ionicons';
import {
    Image,
    Pressable,
    StyleSheet,
    Text,
    View,
} from 'react-native';

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_GRAY = '#F7F7F7';
const WHITE = '#FFFFFF';
const RED = '#FF5A5F';

export default function ProfileScreen() {
  return (
    <View style={styles.screen}>
      <AppHeader />

      <View style={styles.content}>

        {/* PROFILE */}
        <View style={styles.profileSection}>
          <Image
            source={require('@/assets/images/tabIcons/profile.png')}
            style={styles.avatar}
            resizeMode="cover"
          />

          <Text style={styles.name}>
            User
          </Text>

          <Pressable style={styles.editButton}>
            <Text style={styles.editText}>
              Edit Profile
            </Text>
          </Pressable>
        </View>

        {/* SETTINGS */}
        <View style={styles.optionsContainer}>

          {/* ACCOUNT SETTINGS */}
          <Pressable style={styles.optionCard}>
            <View style={styles.optionIcon}>
              <Ionicons
                name="settings"
                size={28}
                color="#A5A5A5"
              />
            </View>

            <Text style={styles.optionText}>
              Account Settings
            </Text>

            <Ionicons
              name="chevron-forward"
              size={22}
              color="#A5A5A5"
            />
          </Pressable>

          {/* VIEW PROGRESS */}
          <Pressable style={styles.optionCard}>
            <View style={styles.progressIcon}>
              <Ionicons
                name="bar-chart"
                size={28}
                color="#52B788"
              />
            </View>

            <Text style={styles.optionText}>
              View Progress
            </Text>

            <Ionicons
              name="chevron-forward"
              size={22}
              color="#A5A5A5"
            />
          </Pressable>

        </View>

        {/* LOG OUT */}
        <Pressable style={styles.logoutButton}>
          <Text style={styles.logoutText}>
            Log out
          </Text>
        </Pressable>

      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: WHITE,
  },

  content: {
    flex: 1,

    alignItems: 'center',

    paddingHorizontal: 24,
    paddingTop: 70,
    paddingBottom: 120,
  },

  // PROFILE
  profileSection: {
    alignItems: 'center',

    marginBottom: 36,
  },

  avatar: {
    width: 94,
    height: 94,

    borderRadius: 47,

    backgroundColor: PINK,

    marginBottom: 10,
  },

  name: {
    fontFamily: 'FredokaBold',
    fontSize: 21,

    color: BROWN,

    marginBottom: 8,
  },

  editButton: {
    minWidth: 84,
    height: 22,

    paddingHorizontal: 14,

    borderRadius: 12,

    backgroundColor: PINK,

    alignItems: 'center',
    justifyContent: 'center',

    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 2,
    shadowOffset: {
      width: 0,
      height: 1,
    },

    elevation: 2,
  },

  editText: {
    fontFamily: 'FredokaBold',
    fontSize: 8,

    color: BROWN,
  },

  // OPTIONS
  optionsContainer: {
    width: '100%',

    gap: 18,
  },

  optionCard: {
    width: '100%',
    height: 68,

    backgroundColor: LIGHT_GRAY,

    borderRadius: 17,

    paddingHorizontal: 24,

    flexDirection: 'row',
    alignItems: 'center',

    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 4,
    shadowOffset: {
      width: 0,
      height: 2,
    },

    elevation: 3,
  },

  optionIcon: {
    width: 38,

    alignItems: 'center',
    justifyContent: 'center',

    marginRight: 20,
  },

  progressIcon: {
    width: 38,

    alignItems: 'center',
    justifyContent: 'center',

    marginRight: 20,
  },

  optionText: {
    flex: 1,

    fontFamily: 'FredokaBold',
    fontSize: 19,

    color: BROWN,
  },

  // LOG OUT
  logoutButton: {
    width: 107,
    height: 38,

    borderRadius: 20,

    backgroundColor: RED,

    alignItems: 'center',
    justifyContent: 'center',

    marginTop: 70,

    shadowColor: '#000',
    shadowOpacity: 0.10,
    shadowRadius: 4,
    shadowOffset: {
      width: 0,
      height: 2,
    },

    elevation: 3,
  },

  logoutText: {
    fontFamily: 'FredokaBold',
    fontSize: 14,

    color: WHITE,
  },
});