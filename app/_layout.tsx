import {
  Fredoka_300Light,
  Fredoka_400Regular,
  Fredoka_500Medium,
  Fredoka_600SemiBold,
  Fredoka_700Bold,
} from '@expo-google-fonts/fredoka';
import { useFonts } from 'expo-font';
import { router, Slot, usePathname } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { exerciseStyles } from '@/constants/exerciseStyles';

export default function RootLayout() {
  const pathname = usePathname();

  const showBackButton =
    pathname === '/register'

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
    <View style={exerciseStyles.screen}>
      {showBackButton && (
        <Pressable
          style={exerciseStyles.rootBackButton}
          onPress={() => router.back()}
        >
          <Text style={exerciseStyles.rootBackArrow}>‹</Text>
        </Pressable>
      )}

      <Slot />
    </View>
  );
}
