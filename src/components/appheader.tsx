import { Image, StyleSheet, View } from 'react-native';

export default function AppHeader() {
  return (
    <View style={styles.header}>
      <Image
        source={require('@/assets/images/tuneup-icon.png')}
        style={styles.logo}
        resizeMode="contain"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    height: 130,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    paddingTop: 10,
    marginBottom: -20
  },

  logo: {
    width: 45,
    height: 45,
  },
});