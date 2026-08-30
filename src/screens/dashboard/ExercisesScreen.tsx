import AppHeader from '@/components/appheader';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState } from 'react';
import {
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const WHITE = '#FFFFFF';
const BORDER = '#D8C9C2';
const MUTED = '#A58F84';

const categories = [
  'All',
  'Breath Control',
  'Pitch',
  'Tone',
  'Volume',
  'Agility',
];

const exercises = [
  // BREATH CONTROL
  {
    name: 'Sustained Exhale',
    category: 'Breath Control',
  },
  {
    name: 'Sustained "SSSS" Sound',
    category: 'Breath Control',
  },
  {
    name: 'Diaphragmatic Breathing',
    category: 'Breath Control',
  },
  {
    name: 'Steady Airflow Maintenance',
    category: 'Breath Control',
  },
  {
    name: 'Controlled Breath Release',
    category: 'Breath Control',
  },

  // PITCH
  {
    name: 'Note Matching Exercise',
    category: 'Pitch',
  },
  {
    name: 'Scale Accuracy Drill',
    category: 'Pitch',
  },
  {
    name: 'Interval Recognition Task',
    category: 'Pitch',
  },
  {
    name: 'Sustained Note Stability',
    category: 'Pitch',
  },
  {
    name: 'Melodic Pattern Matching',
    category: 'Pitch',
  },

  // TONE
  {
    name: 'Vowel Consistency Exercise',
    category: 'Tone',
  },
  {
    name: 'Waveform Smoothness Drill',
    category: 'Tone',
  },
  {
    name: 'Resonance Stabilization Task',
    category: 'Tone',
  },
  {
    name: 'Tone Consistency Exercise',
    category: 'Tone',
  },
  {
    name: 'Steady Tone Holding',
    category: 'Tone',
  },

  // VOLUME
  {
    name: 'Dynamic Range Exercise',
    category: 'Volume',
  },
  {
    name: 'Controlled Crescendo Drill',
    category: 'Volume',
  },
  {
    name: 'Controlled Decrescendo Drill',
    category: 'Volume',
  },
  {
    name: 'Volume Band Targeting',
    category: 'Volume',
  },
  {
    name: 'Volume Control Stability',
    category: 'Volume',
  },

  // AGILITY
  {
    name: 'Rapid Note-Transition Exercise',
    category: 'Agility',
  },
  {
    name: 'Arpeggio Speed Drill',
    category: 'Agility',
  },
  {
    name: 'Vocal Run Accuracy Task',
    category: 'Agility',
  },
  {
    name: 'Quick Interval Jump',
    category: 'Agility',
  },
  {
    name: 'Rapid Scale Trill',
    category: 'Agility',
  },
];

export default function ExercisesScreen() {
  const [selectedCategory, setSelectedCategory] =
    useState('All');

  const [filterOpen, setFilterOpen] = useState(false);

  const [search, setSearch] = useState('');

  const filteredExercises = useMemo(() => {
    return exercises.filter((exercise) => {
      const matchesCategory =
        selectedCategory === 'All' ||
        exercise.category === selectedCategory;

      const matchesSearch =
        exercise.name
          .toLowerCase()
          .includes(search.toLowerCase());

      return matchesCategory && matchesSearch;
    });
  }, [selectedCategory, search]);

  return (
    <View style={styles.screen}>
      <AppHeader />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >

        <View style={styles.searchRow}>

          <View style={styles.searchContainer}>
            <Ionicons
              name="search-outline"
              size={21}
              color={MUTED}
            />

            <TextInput
              style={styles.searchInput}
              placeholder="search exercises..."
              placeholderTextColor={MUTED}
              value={search}
              onChangeText={setSearch}
            />
          </View>

        </View>

        <Text style={styles.title}>
          Vocal Exercises
        </Text>

        <View style={styles.recommendedHeader}>
          <View>
            <Text style={styles.recommendedTitle}>
              Recommended For You
            </Text>

            <Text style={styles.recommendedSubtitle}>
              Based on your assessment
            </Text>
          </View>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.recommendedScroll}
        >

          {/* CARD 1 */}
          <Pressable style={styles.recommendedCard}>
            <View style={styles.recommendedImage}>
              <View style={styles.recommendedDifficulty}>
                <Text style={styles.difficultyText}>
                  Beginner
                </Text>
              </View>
            </View>

            <View style={styles.recommendedBottom}>
              <Text style={styles.categoryText}>
                Breath Control
              </Text>

              <View style={styles.smallPlayButton}>
                <Ionicons
                  name="play"
                  size={16}
                  color={BROWN}
                />
              </View>
            </View>
          </Pressable>

          {/* CARD 2 */}
          <Pressable style={styles.recommendedCard}>
            <View style={styles.recommendedImage}>
              <View style={styles.recommendedDifficulty}>
                <Text style={styles.difficultyText}>
                  Beginner
                </Text>
              </View>
            </View>

            <View style={styles.recommendedBottom}>
              <Text style={styles.categoryText}>
                Pitch Accuracy
              </Text>

              <View style={styles.smallPlayButton}>
                <Ionicons
                  name="play"
                  size={16}
                  color={BROWN}
                />
              </View>
            </View>
          </Pressable>

        </ScrollView>

        {/* EXERCISES HEADER */}
        <View style={styles.exerciseHeader}>
          <Text style={styles.exerciseTitle}>
            Exercises
          </Text>

          {/* FILTER DROPDOWN */}
          <View style={styles.dropdownWrapper}>

            <Pressable
              style={styles.dropdown}
              onPress={() =>
                setFilterOpen(!filterOpen)
              }
            >
              <Text style={styles.dropdownText}>
                {selectedCategory}
              </Text>

              <Ionicons
                name={
                  filterOpen
                    ? 'chevron-up'
                    : 'chevron-down'
                }
                size={15}
                color={MUTED}
              />
            </Pressable>

            {filterOpen && (
              <View style={styles.dropdownMenu}>
                {categories.map((category) => (
                  <Pressable
                    key={category}
                    style={[
                      styles.dropdownItem,
                      selectedCategory === category &&
                        styles.selectedDropdownItem,
                    ]}
                    onPress={() => {
                      setSelectedCategory(category);
                      setFilterOpen(false);
                    }}
                  >
                    <Text
                      style={[
                        styles.dropdownItemText,
                        selectedCategory === category &&
                          styles.selectedDropdownText,
                      ]}
                    >
                      {category}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}

          </View>
        </View>

        {/* EXERCISE COUNT */}
        <Text style={styles.resultCount}>
          {filteredExercises.length}{' '}
          {filteredExercises.length === 1
            ? 'exercise'
            : 'exercises'}
        </Text>

        {/* EXERCISE LIST */}
        <View style={styles.exerciseList}>

          {filteredExercises.map((exercise) => (
            <Pressable
              key={exercise.name}
              style={styles.exerciseCard}
            >

              {/* NAME */}
              <View style={styles.exerciseNameContainer}>
                <Text style={styles.exerciseName}>
                  {exercise.name}
                </Text>
              </View>

              {/* DIFFICULTY */}
              <View style={styles.levelBadge}>
                <Text style={styles.levelText}>
                  Beginner
                </Text>
              </View>

              {/* CATEGORY */}
              <Text style={styles.exerciseCategory}>
                {exercise.category}
              </Text>

              {/* PLAY */}
              <View style={styles.listPlayButton}>
                <Ionicons
                  name="play"
                  size={16}
                  color={BROWN}
                />
              </View>

            </Pressable>
          ))}

          {/* NO RESULTS */}
          {filteredExercises.length === 0 && (
            <View style={styles.noResults}>
              <Ionicons
                name="search-outline"
                size={32}
                color={MUTED}
              />

              <Text style={styles.noResultsTitle}>
                No exercises found
              </Text>

              <Text style={styles.noResultsText}>
                Try another search or category.
              </Text>
            </View>
          )}

        </View>

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: WHITE,
  },

  scrollView: {
    flex: 1,
  },

  content: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 140,
  },

  // SEARCH
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginBottom: 14,
  },

  searchContainer: {
    flex: 1,
    height: 44,

    borderWidth: 1,
    borderColor: BORDER,

    borderRadius: 10,

    backgroundColor: WHITE,

    flexDirection: 'row',
    alignItems: 'center',

    paddingHorizontal: 12,
  },

  searchInput: {
    flex: 1,

    marginLeft: 9,

    fontFamily: 'FredokaRegular',
    fontSize: 13,

    color: BROWN,

    padding: 0,
  },

  filterIconButton: {
    width: 42,
    height: 44,

    borderRadius: 10,

    backgroundColor: PINK,

    alignItems: 'center',
    justifyContent: 'center',
  },

  // TITLE
  title: {
    fontFamily: 'FredokaBold',
    fontSize: 34,
    color: BROWN,

    marginBottom: 20,
  },

  // RECOMMENDED
  recommendedHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',

    marginBottom: 14,
  },

  recommendedTitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 16,
    color: BROWN,
  },

  recommendedSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: BROWN,

    marginTop: 2,
  },

  recommendedScroll: {
    paddingBottom: 26,
  },

  recommendedCard: {
    width: 180,
    height: 193,

    backgroundColor: PINK,

    borderRadius: 10,

    padding: 14,

    marginRight: 14,

    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 5,
    shadowOffset: {
      width: 0,
      height: 3,
    },

    elevation: 4,
  },

  recommendedImage: {
    height: 111,

    backgroundColor: WHITE,

    borderRadius: 7,

    position: 'relative',

    marginBottom: 10,
  },

  recommendedDifficulty: {
    position: 'absolute',

    right: 7,
    bottom: 7,

    backgroundColor: WHITE,

    borderRadius: 10,

    paddingHorizontal: 8,
    paddingVertical: 4,
  },

  difficultyText: {
    fontFamily: 'FredokaBold',
    fontSize: 9,
    color: BROWN,
  },

  recommendedBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  categoryText: {
    fontFamily: 'FredokaBold',
    fontSize: 12,
    color: BROWN,
  },

  smallPlayButton: {
    width: 38,
    height: 38,

    borderRadius: 19,

    backgroundColor: WHITE,

    alignItems: 'center',
    justifyContent: 'center',

    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 4,
    shadowOffset: {
      width: 0,
      height: 2,
    },

    elevation: 3,
  },

  // EXERCISES HEADER
  exerciseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',

    marginBottom: 2,
  },

  exerciseTitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 31,
    color: BROWN,
  },

  // DROPDOWN
  dropdownWrapper: {
    position: 'relative',
    zIndex: 100,
  },

  dropdown: {
    width: 108,
    height: 32,

    backgroundColor: PINK,

    borderRadius: 8,

    paddingHorizontal: 12,

    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  dropdownText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: BROWN,

    maxWidth: 75,
  },

  dropdownMenu: {
    position: 'absolute',

    top: 37,
    right: 0,

    width: 145,

    backgroundColor: WHITE,

    borderRadius: 10,

    paddingVertical: 5,

    zIndex: 100,

    elevation: 8,

    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: {
      width: 0,
      height: 3,
    },
  },

  dropdownItem: {
    paddingHorizontal: 12,
    paddingVertical: 9,
  },

  selectedDropdownItem: {
    backgroundColor: LIGHT_PINK,
  },

  dropdownItemText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: BROWN,
  },

  selectedDropdownText: {
    fontFamily: 'FredokaBold',
  },

  // RESULT COUNT
  resultCount: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,

    marginBottom: 8,
  },

  // EXERCISE LIST
  exerciseList: {
    gap: 7,
  },

  exerciseCard: {
    minHeight: 64,

    backgroundColor: LIGHT_PINK,

    borderRadius: 9,

    paddingHorizontal: 14,
    paddingVertical: 9,

    flexDirection: 'row',
    alignItems: 'center',
  },

  exerciseNameContainer: {
    width: 108,
  },

  exerciseName: {
    fontFamily: 'FredokaRegular',
    fontSize: 15,
    lineHeight: 17,
    color: BROWN,
  },

  levelBadge: {
    width: 61,

    backgroundColor: PINK,

    borderRadius: 10,

    paddingVertical: 4,

    alignItems: 'center',
    justifyContent: 'center',

    marginRight: 14,
  },

  levelText: {
    fontFamily: 'FredokaBold',
    fontSize: 8,
    color: BROWN,
  },

  exerciseCategory: {
    flex: 1,

    fontFamily: 'FredokaRegular',
    fontSize: 10,
    lineHeight: 12,
    color: BROWN,
  },

  listPlayButton: {
    width: 38,
    height: 38,

    borderRadius: 19,

    backgroundColor: WHITE,

    alignItems: 'center',
    justifyContent: 'center',

    shadowColor: '#000',
    shadowOpacity: 0.10,
    shadowRadius: 3,
    shadowOffset: {
      width: 0,
      height: 2,
    },

    elevation: 2,
  },

  // NO RESULTS
  noResults: {
    alignItems: 'center',
    justifyContent: 'center',

    paddingVertical: 40,
  },

  noResultsTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 17,
    color: BROWN,

    marginTop: 10,
  },

  noResultsText: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: MUTED,

    marginTop: 4,
  },
});