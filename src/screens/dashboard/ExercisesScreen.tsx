
import AppHeader from '@/components/appheader';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';

import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { auth } from '@/services/firebase/config';

import {
  fetchAllProgress,
} from '@/services/progress/progressRepo';

import type {
  ComponentId,
  ComponentProgressSummary,
} from '@/services/progress/progressModule';

// =========================================================
// COLORS
// =========================================================

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const WHITE = '#FFFFFF';
const BORDER = '#D8C9C2';
const MUTED = '#A58F84';

// =========================================================
// CATEGORIES
// =========================================================

const categories = [
  'All',
  'Breath Control',
  'Pitch',
  'Tone',
  'Volume',
  'Agility',
];

const componentIds: Record<string, ComponentId> = {
  'Breath Control': 'breathControl',
  Pitch: 'pitch',
  Tone: 'tone',
  Volume: 'volume',
  Agility: 'agility',
};

// =========================================================
// EXERCISE DATA
// =========================================================

type Exercise = {
  name: string;
  category: string;
  templateId?: string;
};

const exercises: Exercise[] = [
  // BREATH CONTROL
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

  // PITCH
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

  // TONE
  {
    name: 'Vowel Consistency Exercise',
    category: 'Tone',
    templateId: 'vowelConsistencyExercise',
  },
  {
    name: 'Waveform Smoothness Drill',
    category: 'Tone',
    templateId: 'waveformSmoothnessDrill',
  },
  {
    name: 'Frequency Zone Stability',
    category: 'Tone',
    templateId: 'frequencyZoneStability',
  },
  {
    name: 'Tone Consistency Exercise',
    category: 'Tone',
    templateId: 'toneConsistencyExercise',
  },
  {
    name: 'Steady Tone Holding',
    category: 'Tone',
    templateId: 'steadyToneHolding',
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
    templateId: 'rapidNoteTransition',
  },
  {
    name: 'Arpeggio Speed Drill',
    category: 'Agility',
    templateId: 'arpeggioSpeed',
  },
  {
    name: 'Vocal Run Accuracy Task',
    category: 'Agility',
    templateId: 'vocalRunAccuracy',
  },
  {
    name: 'Quick Interval Jump',
    category: 'Agility',
    templateId: 'quickIntervalJump',
  },
  {
    name: 'Rapid Scale Trill',
    category: 'Agility',
    templateId: 'rapidScaleTrill',
  },
];

// =========================================================
// DEFAULT RECOMMENDATIONS
// =========================================================

const fallbackRecommendations: Exercise[] = [
  exercises[0],
  exercises[5],
  exercises[10],
  exercises[15],
  exercises[20],
].filter((exercise): exercise is Exercise => Boolean(exercise));

// =========================================================
// HELPERS
// =========================================================

function clampPercentage(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.round(Math.max(0, Math.min(100, value)));
}

function getExerciseDifficulty(
  exercise: Exercise,
): string {
  return 'Beginner';
}

// =========================================================
// SCREEN
// =========================================================

export default function ExercisesScreen() {
  const [selectedCategory, setSelectedCategory] =
    useState('All');

  const [filterOpen, setFilterOpen] =
    useState(false);

  const [search, setSearch] =
    useState('');

  const [progressSummaries, setProgressSummaries] =
    useState<ComponentProgressSummary[]>([]);

  const [recommendationsLoading, setRecommendationsLoading] =
    useState(true);

  // =======================================================
  // LOAD PROGRESS WHEN SCREEN GAINS FOCUS
  // =======================================================

  useFocusEffect(
    useCallback(() => {
      let active = true;

      async function loadRecommendations() {
        setRecommendationsLoading(true);

        try {
          const user = auth.currentUser;

          if (!user) {
            if (active) {
              setProgressSummaries([]);
            }

            return;
          }

          const summaries = await fetchAllProgress(user.uid);

          if (active) {
            setProgressSummaries(summaries);
          }
        } catch (error) {
          console.error(
            'Failed to load exercise recommendations:',
            error,
          );

          if (active) {
            setProgressSummaries([]);
          }
        } finally {
          if (active) {
            setRecommendationsLoading(false);
          }
        }
      }

      void loadRecommendations();

      return () => {
        active = false;
      };
    }, []),
  );

  // =======================================================
  // FILTER EXERCISES
  // =======================================================

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

  // =======================================================
  // RECOMMEND EXERCISES
  // =======================================================

  const recommendedExercises = useMemo(() => {
    if (
      recommendationsLoading ||
      progressSummaries.length === 0
    ) {
      return fallbackRecommendations;
    }

    const rankedComponents = Object.entries(componentIds)
      .map(([category, componentId]) => {
        const summary = progressSummaries.find(
          item => item.componentId === componentId,
        );

        return {
          category,
          score: clampPercentage(
            summary?.averageRecentScorePct ?? 0,
          ),
          completed: summary?.exercisesCompleted ?? 0,
        };
      })
      .sort((a, b) => {
        // Prioritize components that have exercise history.
        if (a.completed > 0 && b.completed === 0) {
          return -1;
        }

        if (a.completed === 0 && b.completed > 0) {
          return 1;
        }

        // Among practiced components, lowest score first.
        if (a.completed > 0 && b.completed > 0) {
          return a.score - b.score;
        }

        return 0;
      });

    const recommendations: Exercise[] = [];

    // First, recommend one exercise from each of the
    // lowest-scoring components.
    for (const component of rankedComponents) {
      const exercise = exercises.find(
        item => item.category === component.category,
      );

      if (exercise) {
        recommendations.push(exercise);
      }

      if (recommendations.length >= 5) {
        break;
      }
    }

    // Ensure there are at least three recommendations.
    // Add exercises from the lowest-scoring categories first.
    for (const component of rankedComponents) {
      if (recommendations.length >= 3) {
        break;
      }

      const remainingExercises = exercises.filter(
        exercise =>
          exercise.category === component.category &&
          !recommendations.some(
            recommended =>
              recommended.name === exercise.name,
          ),
      );

      for (const exercise of remainingExercises) {
        recommendations.push(exercise);

        if (recommendations.length >= 3) {
          break;
        }
      }
    }

    return recommendations.slice(0, 5);
  }, [progressSummaries, recommendationsLoading]);

  // =======================================================
  // EXERCISE NAVIGATION
  // =======================================================

  const handleExercisePress = (
    exercise: Exercise,
  ) => {
    // BREATH CONTROL
    if (
      exercise.category === 'Breath Control' &&
      exercise.templateId
    ) {
      router.push({
        pathname: '/exercises/breath-control',
        params: {
          templateId: exercise.templateId,
        },
      } as any);

      return;
    }

    // PITCH
    if (
      exercise.category === 'Pitch' &&
      exercise.templateId
    ) {
      router.push({
        pathname: '/exercises/pitch',
        params: {
          templateId: exercise.templateId,
        },
      } as any);

      return;
    }

    // TONE
    if (
      exercise.category === 'Tone' &&
      exercise.templateId
    ) {
      router.push({
        pathname: '/exercises/tone',
        params: {
          templateId: exercise.templateId,
        },
      } as any);

      return;
    }

    // VOLUME
    if (exercise.category === 'Volume') {
      const volumeRoutes: Record<string, string> = {
        'Dynamic Range Exercise': 'dynamic-range',
        'Controlled Crescendo Drill': 'controlled-crescendo',
        'Controlled Decrescendo Drill': 'controlled-decrescendo',
        'Volume Band Targeting': 'volume-band-targeting',
        'Volume Control Stability': 'volume-control-stability',
      };

      const exerciseParam = volumeRoutes[exercise.name];

      if (exerciseParam) {
        router.push(
          `/exercises/volume?exercise=${exerciseParam}` as any,
        );
      }

      return;
    }

    // AGILITY
    if (
      exercise.category === 'Agility' &&
      exercise.templateId
    ) {
      router.push({
        pathname: '/exercises/agility',
        params: {
          templateId: exercise.templateId,
        },
      } as any);
    }
  };

  // =======================================================
  // UI
  // =======================================================

  return (
    <View style={styles.screen}>
      <AppHeader />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* SEARCH */}

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

        {/* TITLE */}

        <Text style={styles.title}>
          Vocal Exercises
        </Text>

        {/* RECOMMENDED FOR YOU */}

        <View style={styles.recommendedHeader}>
          <View>
            <Text style={styles.recommendedTitle}>
              Recommended For You
            </Text>

            <Text style={styles.recommendedSubtitle}>
              {recommendationsLoading
                ? 'Loading your exercise scores...'
                : 'Based on your component scores'}
            </Text>
          </View>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.recommendedScroll}
        >
          {recommendedExercises.map((exercise) => (
            <View
              key={`${exercise.category}-${exercise.name}`}
              style={styles.recommendedCard}
            >
              {/* IMAGE AREA */}

              <View style={styles.recommendedImage}>
                <View style={styles.recommendedDifficulty}>
                  <Text style={styles.difficultyText}>
                    {exercise.category}
                  </Text>
                </View>
              </View>

              {/* CARD BOTTOM */}

              <View style={styles.recommendedBottom}>
                <View style={styles.recommendedExerciseText}>
                  <Text
                    style={styles.categoryText}
                    numberOfLines={2}
                  >
                    {exercise.name}
                  </Text>
                </View>

                <Pressable
                  style={styles.smallPlayButton}
                  onPress={() => handleExercisePress(exercise)}
                  accessibilityRole="button"
                  accessibilityLabel={`Start ${exercise.name}`}
                >
                  <Ionicons
                    name="play"
                    size={16}
                    color={BROWN}
                  />
                </Pressable>
              </View>
            </View>
          ))}
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
              onPress={() => setFilterOpen(!filterOpen)}
              accessibilityRole="button"
              accessibilityLabel="Filter exercises by category"
            >
              <Text style={styles.dropdownText}>
                {selectedCategory}
              </Text>

              <Ionicons
                name={filterOpen ? 'chevron-up' : 'chevron-down'}
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
                      setSearch('');
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
              style={({ pressed }) => [
                styles.exerciseCard,
                pressed && styles.exercisePressed,
              ]}
              onPress={() => handleExercisePress(exercise)}
              accessibilityRole="button"
              accessibilityLabel={`Open ${exercise.name}`}
            >
              <View style={styles.exerciseNameContainer}>
                <Text
                  style={styles.exerciseName}
                  numberOfLines={2}
                >
                  {exercise.name}
                </Text>
              </View>

              <View style={styles.levelBadge}>
                <Text style={styles.levelText}>
                  {getExerciseDifficulty(exercise)}
                </Text>
              </View>

              <Text
                style={styles.exerciseCategory}
                numberOfLines={1}
              >
                {exercise.category}
              </Text>

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

// =========================================================
// STYLES
// =========================================================

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
    flex: 1,
  },

  recommendedExerciseText: {
    flex: 1,
    marginRight: 6,
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

  exercisePressed: {
    opacity: 0.7,
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
