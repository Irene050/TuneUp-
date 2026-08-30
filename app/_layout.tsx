import { router, Slot, usePathname } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export default function RootLayout() {
  const pathname = usePathname();
  const showBackButton = pathname !== '/login';

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