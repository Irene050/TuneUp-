import {
  Fredoka_300Light,
  Fredoka_400Regular,
  Fredoka_500Medium,
  Fredoka_600SemiBold,
  Fredoka_700Bold,
} from '@expo-google-fonts/fredoka';
import { useFonts } from 'expo-font';
import { router, Slot, usePathname } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export default function RootLayout() {
  const pathname = usePathname();

  const showBackButton =
    pathname === '/register' ||
    pathname === '/forgot-password' ||
    pathname === '/reset-password';

  const [fontsLoaded] = useFonts({
    FredokaLight: Fredoka_300Light,
    FredokaRegular: Fredoka_400Regular,
    FredokaMedium: Fredoka_500Medium,
    FredokaSemiBold: Fredoka_600SemiBold,
    FredokaBold: Fredoka_700Bold,
  });

  if (!fontsLoaded) {
    return null;
  }

  return (
    <View style={styles.container}>
      {showBackButton && (
        <Pressable
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <Text style={styles.backArrow}>‹</Text>
        </Pressable>
      )}

      <Slot />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },

  backButton: {
    position: 'absolute',
    top: 40,
    left: 16,
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 999,
    elevation: 999,
  },

  backArrow: {
    fontSize: 36,
    fontWeight: '300',
    color: '#4A302F',
    lineHeight: 40,
  },
});