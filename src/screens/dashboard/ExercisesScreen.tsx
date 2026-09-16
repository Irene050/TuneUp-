import AppHeader from '@/components/appheader';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
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
  // =========================================
  // BREATH CONTROL
  // =========================================
  {
    name: 'Sustained Exhale',
    category: 'Breath Control',
    templateId: 'sustainedExhale',
  },
  {
    name: 'Sustained "SSSS" Sound',
    category: 'Breath Control',
    templateId: 'sustainedSSSS',
  },
  {
    name: 'Diaphragmatic Breathing',
    category: 'Breath Control',
    templateId: 'diaphragmaticBreathing',
  },
  {
    name: 'Steady Airflow Maintenance',
    category: 'Breath Control',
    templateId: 'steadyAirflowMaintenance',
  },
  {
    name: 'Controlled Breath Release',
    category: 'Breath Control',
    templateId: 'controlledBreathRelease',
  },

  // =========================================
  // PITCH
  // =========================================
  {
    name: 'Note Matching Exercise',
    category: 'Pitch',
    templateId: 'noteMatchingExercise',
  },
  {
    name: 'Scale Accuracy Drill',
    category: 'Pitch',
    templateId: 'scaleAccuracyDrill',
  },
  {
    name: 'Interval Recognition Task',
    category: 'Pitch',
    templateId: 'intervalRecognitionTask',
  },
  {
    name: 'Sustained Note Stability',
    category: 'Pitch',
    templateId: 'sustainedNoteStability',
  },
  {
    name: 'Melodic Pattern Matching',
    category: 'Pitch',
    templateId: 'melodicPatternMatching',
  },

  // =========================================
  // TONE
  // =========================================
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

  // =========================================
  // VOLUME
  // =========================================
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

  // =========================================
  // AGILITY
  // =========================================
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

const recommendedComponents = [
  {
    name: 'Breath Control',
    route: '/exercises/breath-control',
    icon: 'water-outline' as const,
  },
  {
    name: 'Pitch',
    route: '/exercises/pitch',
    icon: 'musical-notes-outline' as const,
  },
  {
    name: 'Tone',
    route: '/exercises/tone',
    icon: 'radio-outline' as const,
  },
  {
    name: 'Volume',
    route: '/exercises/volume',
    icon: 'volume-high-outline' as const,
  },
  {
    name: 'Agility',
    route: '/exercises/agility',
    icon: 'pulse-outline' as const,
  },
];

export default function ExercisesScreen() {
  const [selectedCategory, setSelectedCategory] =
    useState('All');

  const [filterOpen, setFilterOpen] =
    useState(false);

  const [search, setSearch] =
    useState('');

  // =========================================
  // FILTER
  // =========================================

  const filteredExercises = useMemo(() => {
    return exercises.filter((exercise) => {
      const matchesCategory =
        selectedCategory === 'All' ||
        exercise.category === selectedCategory;

      const matchesSearch =
        exercise.name
          .toLowerCase()
          .includes(search.toLowerCase());

      return (
        matchesCategory &&
        matchesSearch
      );
    });
  }, [selectedCategory, search]);

  

  const handleRecommendedPress = (
    route: string,
  ) => {
    router.push(route as any);
  };



  const handleExercisePress = (exercise: {
    name: string;
    category: string;
    templateId?: string;
  }) => {
    // -----------------------------------------
    // BREATH CONTROL
    // -----------------------------------------

    if (
      exercise.category ===
        'Breath Control' &&
      exercise.templateId
    ) {
      router.push(
        `/exercises/breath-control?templateId=${encodeURIComponent(
          exercise.templateId,
        )}` as any,
      );

      return;
    }

    // -----------------------------------------
    // PITCH
    // -----------------------------------------

    if (
      exercise.category === 'Pitch' &&
      exercise.templateId
    ) {
      router.push(
        `/exercises/pitch?templateId=${encodeURIComponent(
          exercise.templateId,
        )}` as any,
      );

      return;
    }

    // -----------------------------------------
    // VOLUME
    // -----------------------------------------

    if (
      exercise.category === 'Volume'
    ) {
      if (
        exercise.name ===
        'Dynamic Range Exercise'
      ) {
        router.push(
          '/exercises/volume/dynamic-range' as any,
        );
        return;
      }

      if (
        exercise.name ===
        'Controlled Crescendo Drill'
      ) {
        router.push(
          '/exercises/volume/controlled-crescendo' as any,
        );
        return;
      }

      if (
        exercise.name ===
        'Controlled Decrescendo Drill'
      ) {
        router.push(
          '/exercises/volume/controlled-decrescendo' as any,
        );
        return;
      }

      if (
        exercise.name ===
        'Volume Band Targeting'
      ) {
        router.push(
          '/exercises/volume/volume-band-targeting' as any,
        );
        return;
      }

      if (
        exercise.name ===
        'Volume Control Stability'
      ) {
        router.push(
          '/exercises/volume/volume-control-stability' as any,
        );
        return;
      }

      return;
    }

  
  };

  return (
    <View style={styles.screen}>
      <AppHeader />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >

        {/* =====================================
            SEARCH
        ====================================== */}

        <View style={styles.searchRow}>
          <View style={styles.searchContainer}>

            <Ionicons
              name="search-outline"
              size={20}
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

        {/* =====================================
            TITLE
        ====================================== */}

        <Text style={styles.title}>
          Vocal Exercises
        </Text>

        {/* =====================================
            RECOMMENDED FOR YOU
        ====================================== */}

        <View
          style={styles.recommendedHeader}
        >
          <View>

            <Text
              style={
                styles.recommendedTitle
              }
            >
              Recommended For You
            </Text>

            <Text
              style={
                styles.recommendedSubtitle
              }
            >
              Based on your assessment
            </Text>

          </View>
        </View>

        {

        }

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={
            false
          }
          contentContainerStyle={
            styles.recommendedScroll
          }
        >

          {recommendedComponents.map(
            (component) => (
              <View
                key={component.name}
                style={
                  styles.recommendedCard
                }
              >

                {/* IMAGE AREA */}

                <View
                  style={
                    styles.recommendedImage
                  }
                >

                  <View
                    style={
                      styles.componentIcon
                    }
                  >
                    <Ionicons
                      name={
                        component.icon
                      }
                      size={34}
                      color={BROWN}
                    />
                  </View>

                  <View
                    style={
                      styles.recommendedDifficulty
                    }
                  >
                    <Text
                      style={
                        styles.difficultyText
                      }
                    >
                      Beginner
                    </Text>
                  </View>

                </View>

                {/* CARD BOTTOM */}

                <View
                  style={
                    styles.recommendedBottom
                  }
                >

                  <Text
                    style={
                      styles.categoryText
                    }
                    numberOfLines={1}
                  >
                    {component.name}
                  </Text>

                  <Pressable
                    style={
                      styles.smallPlayButton
                    }
                    onPress={() =>
                      handleRecommendedPress(
                        component.route,
                      )
                    }
                  >
                    <Ionicons
                      name="play"
                      size={15}
                      color={BROWN}
                    />
                  </Pressable>

                </View>

              </View>
            ),
          )}

        </ScrollView>

        {/* =====================================
            EXERCISES
        ====================================== */}

        <View
          style={styles.exerciseHeader}
        >

          <Text
            style={styles.exerciseTitle}
          >
            Exercises
          </Text>

          {/* FILTER */}

          <View
            style={
              styles.dropdownWrapper
            }
          >

            <Pressable
              style={styles.dropdown}
              onPress={() =>
                setFilterOpen(
                  !filterOpen,
                )
              }
            >

              <Text
                style={styles.dropdownText}
              >
                {selectedCategory}
              </Text>

              <Ionicons
                name={
                  filterOpen
                    ? 'chevron-up'
                    : 'chevron-down'
                }
                size={14}
                color={MUTED}
              />

            </Pressable>

            {filterOpen && (
              <View
                style={
                  styles.dropdownMenu
                }
              >

                {categories.map(
                  (category) => (
                    <Pressable
                      key={category}
                      style={[
                        styles.dropdownItem,
                        selectedCategory ===
                          category &&
                          styles.selectedDropdownItem,
                      ]}
                      onPress={() => {
                        setSelectedCategory(
                          category,
                        );

                        setFilterOpen(
                          false,
                        );

                        setSearch('');
                      }}
                    >

                      <Text
                        style={[
                          styles.dropdownItemText,
                          selectedCategory ===
                            category &&
                            styles.selectedDropdownText,
                        ]}
                      >
                        {category}
                      </Text>

                    </Pressable>
                  ),
                )}

              </View>
            )}

          </View>

        </View>

        {/* =====================================
            COUNT
        ====================================== */}

        <Text
          style={styles.resultCount}
        >
          {filteredExercises.length}{' '}
          {filteredExercises.length === 1
            ? 'exercise'
            : 'exercises'}
        </Text>

        {/* =====================================
            EXERCISE LIST
        ====================================== */}

        <View
          style={styles.exerciseList}
        >

          {filteredExercises.map(
            (exercise) => (
              <Pressable
                key={exercise.name}
                style={({ pressed }) => [
                  styles.exerciseCard,
                  pressed &&
                    styles.exercisePressed,
                ]}
                onPress={() =>
                  handleExercisePress(
                    exercise,
                  )
                }
              >

                {/* ICON */}

                <View
                  style={styles.exerciseIcon}
                >
                  <Ionicons
                    name={
                      exercise.category ===
                      'Volume'
                        ? 'volume-medium'
                        : exercise.category ===
                          'Pitch'
                        ? 'musical-notes'
                        : exercise.category ===
                          'Tone'
                        ? 'radio'
                        : exercise.category ===
                          'Agility'
                        ? 'pulse'
                        : 'water'
                    }
                    size={19}
                    color={BROWN}
                  />
                </View>

                {/* NAME */}

                <View
                  style={
                    styles.exerciseNameContainer
                  }
                >

                  <Text
                    style={
                      styles.exerciseName
                    }
                    numberOfLines={2}
                  >
                    {exercise.name}
                  </Text>

                </View>

                {/* LEVEL */}

                <View
                  style={styles.levelBadge}
                >

                  <Text
                    style={styles.levelText}
                  >
                    Beginner
                  </Text>

                </View>

                {/* CATEGORY */}

                <Text
                  style={
                    styles.exerciseCategory
                  }
                  numberOfLines={1}
                >
                  {exercise.category}
                </Text>

                {/* PLAY */}

                <View
                  style={
                    styles.listPlayButton
                  }
                >

                  <Ionicons
                    name="play"
                    size={15}
                    color={BROWN}
                  />

                </View>

              </Pressable>
            ),
          )}

          {filteredExercises.length ===
            0 && (
            <View
              style={styles.noResults}
            >

              <Ionicons
                name="search-outline"
                size={30}
                color={MUTED}
              />

              <Text
                style={
                  styles.noResultsTitle
                }
              >
                No exercises found
              </Text>

              <Text
                style={
                  styles.noResultsText
                }
              >
                Try another search or
                category.
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
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 120,
  },

  // =========================================
  // SEARCH
  // =========================================

  searchRow: {
    marginBottom: 12,
  },

  searchContainer: {
    height: 38,

    borderWidth: 1,
    borderColor: BORDER,

    borderRadius: 9,

    backgroundColor: WHITE,

    flexDirection: 'row',
    alignItems: 'center',

    paddingHorizontal: 10,
  },

  searchInput: {
    flex: 1,

    marginLeft: 7,

    fontFamily: 'FredokaRegular',
    fontSize: 11,

    color: BROWN,

    padding: 0,
  },

  // =========================================
  // TITLE
  // =========================================

  title: {
    fontFamily: 'FredokaBold',
    fontSize: 25,
    color: BROWN,

    marginBottom: 15,
  },

  // =========================================
  // RECOMMENDED
  // =========================================

  recommendedHeader: {
    marginBottom: 10,
  },

  recommendedTitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 14,
    color: BROWN,
  },

  recommendedSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 8,
    color: MUTED,

    marginTop: 2,
  },

  recommendedScroll: {
    paddingBottom: 19,
    paddingRight: 8,
  },

  recommendedCard: {
    width: 170,
    height: 145,

    backgroundColor: PINK,

    borderRadius: 9,

    padding: 10,

    marginRight: 10,

    shadowColor: '#000',
    shadowOpacity: 0.10,
    shadowRadius: 4,

    shadowOffset: {
      width: 0,
      height: 2,
    },

    elevation: 3,
  },

  recommendedImage: {
    height: 91,

    backgroundColor: WHITE,

    borderRadius: 6,

    position: 'relative',

    alignItems: 'center',
    justifyContent: 'center',

    marginBottom: 7,
  },

  componentIcon: {
    width: 52,
    height: 52,

    borderRadius: 26,

    backgroundColor: PINK,

    alignItems: 'center',
    justifyContent: 'center',
  },

  recommendedDifficulty: {
    position: 'absolute',

    right: 5,
    bottom: 5,

    backgroundColor: WHITE,

    borderRadius: 8,

    paddingHorizontal: 6,
    paddingVertical: 3,
  },

  difficultyText: {
    fontFamily: 'FredokaBold',
    fontSize: 7,
    color: BROWN,
  },

  recommendedBottom: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  categoryText: {
    flex: 1,

    fontFamily: 'FredokaBold',
    fontSize: 10,
    color: BROWN,

    marginRight: 5,
  },

  smallPlayButton: {
    width: 32,
    height: 32,

    borderRadius: 16,

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

  // =========================================
  // EXERCISES HEADER
  // =========================================

  exerciseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',

    marginBottom: 1,
  },

  exerciseTitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 25,
    color: BROWN,
  },

  // =========================================
  // DROPDOWN
  // =========================================

  dropdownWrapper: {
    position: 'relative',
    zIndex: 100,
  },

  dropdown: {
    width: 88,
    height: 29,

    backgroundColor: PINK,

    borderRadius: 7,

    paddingHorizontal: 9,

    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  dropdownText: {
    fontFamily: 'FredokaRegular',
    fontSize: 9,
    color: BROWN,

    maxWidth: 62,
  },

  dropdownMenu: {
    position: 'absolute',

    top: 34,
    right: 0,

    width: 135,

    backgroundColor: WHITE,

    borderRadius: 8,

    paddingVertical: 4,

    zIndex: 100,

    elevation: 8,

    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 7,

    shadowOffset: {
      width: 0,
      height: 3,
    },
  },

  dropdownItem: {
    paddingHorizontal: 10,
    paddingVertical: 8,
  },

  selectedDropdownItem: {
    backgroundColor: LIGHT_PINK,
  },

  dropdownItemText: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: BROWN,
  },

  selectedDropdownText: {
    fontFamily: 'FredokaBold',
  },

  // =========================================
  // COUNT
  // =========================================

  resultCount: {
    fontFamily: 'FredokaRegular',
    fontSize: 8,
    color: MUTED,

    marginBottom: 6,
  },

  // =========================================
  // EXERCISE LIST
  // =========================================

  exerciseList: {
    gap: 6,
  },

  exerciseCard: {
    minHeight: 59,

    backgroundColor: LIGHT_PINK,

    borderRadius: 8,

    paddingHorizontal: 8,
    paddingVertical: 7,

    flexDirection: 'row',
    alignItems: 'center',
  },

  exercisePressed: {
    opacity: 0.7,
  },

  exerciseIcon: {
    width: 35,
    height: 35,

    borderRadius: 18,

    backgroundColor: PINK,

    alignItems: 'center',
    justifyContent: 'center',

    marginRight: 7,
  },

  exerciseNameContainer: {
    width: 92,

    marginRight: 5,
  },

  exerciseName: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    lineHeight: 13,
    color: BROWN,
  },

  levelBadge: {
    width: 52,

    backgroundColor: PINK,

    borderRadius: 8,

    paddingVertical: 3,

    alignItems: 'center',
    justifyContent: 'center',

    marginRight: 7,
  },

  levelText: {
    fontFamily: 'FredokaBold',
    fontSize: 6,
    color: BROWN,
  },

  exerciseCategory: {
    flex: 1,

    fontFamily: 'FredokaRegular',
    fontSize: 7,
    color: BROWN,

    marginRight: 5,
  },

  listPlayButton: {
    width: 34,
    height: 34,

    borderRadius: 17,

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

  // =========================================
  // NO RESULTS
  // =========================================

  noResults: {
    alignItems: 'center',
    justifyContent: 'center',

    paddingVertical: 35,
  },

  noResultsTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: BROWN,

    marginTop: 8,
  },

  noResultsText: {
    fontFamily: 'FredokaRegular',
    fontSize: 9,
    color: MUTED,

    marginTop: 3,
  },
});