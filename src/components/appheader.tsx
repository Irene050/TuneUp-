import { Image, View } from 'react-native';

import { exerciseStyles } from '@/constants/exerciseStyles';

export default function AppHeader() {
  return (
    <View style={exerciseStyles.appHeader}>
      <Image
        source={require('@/assets/images/tabIcons/tuneup-logo.png')}
        style={exerciseStyles.appHeaderLogo}
        resizeMode="contain"
      />
    </View>
  );
}
