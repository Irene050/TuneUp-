import AppHeader from '@/components/appheader';
import Ionicons from '@expo/vector-icons/Ionicons';
import {
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';

const categories = [ 'All', 'Breath Control', 'Pitch', 'Tone', 'Volume', 'Agility', ];

export default function ExercisesScreen() {
  return (
    <View style={styles.screen}>
      <AppHeader />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.searchContainer}> 
            <Ionicons 
            name="search-outline" 
            size={22} 
            color={'#A58F84'} 
            /> 
            <TextInput style={styles.searchInput} 
            placeholder="search exercises..." 
            placeholderTextColor={'#A58F84'} 
            /> 
        </View>

        <Text style={styles.title}>Vocal Exercises</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },

  scrollView: {
    flex: 1,
  },

  content: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 120,
  },

  searchContainer: { 
    height: 48, 
    borderWidth: 1, 
    borderColor: '#A58F84', 
    borderRadius: 12, 
    backgroundColor: '#ffffff', 
    flexDirection: 'row', 
    alignItems: 'center', 
    paddingHorizontal: 14, 
    marginBottom: 28, 
},

  searchInput: {
    fontFamily: 'FredokaRegular',
    fontSize: 16,
    color: '#4E2F1F',
    padding: 0,
  },

  title: {
    fontFamily: 'FredokaBold',
    fontSize: 35,
    color: '#4E2F1F',
    marginBottom: 20,
  },
});