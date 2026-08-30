import AppHeader from '@/components/appheader';
import { StyleSheet, Text, View } from 'react-native';

export default function DashboardScreen() {
  return (
    <View style={styles.screen}>
      <AppHeader />

      <View style={styles.content}>
        <Text style={styles.greeting}>Welcome back!</Text>
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
    paddingHorizontal: 24,
    paddingTop: 24,
  },

  greeting: {
    fontFamily: 'FredokaBold',
    fontSize: 22,
    color: '#4E2F1F',
    marginBottom: 20,
  },
});