import AppHeader from '@/components/appheader';
import { StyleSheet, Text, View } from 'react-native';

export default function ProfileScreen() {
  return (
    <View style={styles.screen}>
      <AppHeader />

      <View style={styles.content}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>User</Text>
        </View>

        <Text style={styles.name}>User</Text>
        <Text style={styles.email}>user@email.com</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },

  content: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 24,
  },

  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#FCD6DD',
    alignItems: 'center',
    justifyContent: 'center',
  },

  avatarText: {
    color: '#4E2F1F',
    fontFamily: 'FredokaBold',
    fontSize: 22,
  },

  name: {
    marginTop: 16,
    fontFamily: 'FredokaBold',
    fontSize: 20,
    color: '#4E2F1F',
  },

  email: {
    marginTop: 4,
    fontFamily: 'FredokaRegular',
    fontSize: 15,
    color: '#4E2F1F',
  },
});