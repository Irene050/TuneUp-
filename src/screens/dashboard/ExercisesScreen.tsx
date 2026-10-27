import AppHeader from '@/components/appheader';
import { COLORS } from '@/constants/appConstants';
import { auth } from '@/services/firebase/config';
import type {
  ComponentId,
  ComponentProgressSummary,
} from '@/services/progress/progressModule';
import { fetchAllProgress } from '@/services/progress/progressRepo';
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

const categories = [
  'All',
  'Free Mode',
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

type Exercise = {
  name: string;
  category: string;
  templateId?: string;
  mode?: string;
};

const exercises: Exercise[] = [
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
  {
    name: 'Dynamic Range Exercise',
    category: 'Volume',
    templateId: 'dynamic-range',
  },
  {
    name: 'Controlled Crescendo Drill',
    category: 'Volume',
    templateId: 'controlled-crescendo',
  },
  {
    name: 'Controlled Decrescendo Drill',
    category: 'Volume',
    templateId: 'controlled-decrescendo',
  },
  {
    name: 'Volume Band Targeting',
    category: 'Volume',
    templateId: 'volume-band-targeting',
  },
  {
    name: 'Volume Control Stability',
    category: 'Volume',
    templateId: 'volume-control-stability',
  },
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
  {
    name: 'Breath Control Free Mode',
    category: 'Free Mode',
    mode: 'free',
    templateId: 'breathControlFree',
  },
  {
    name: 'Pitch Free Mode',
    category: 'Free Mode',
    mode: 'free',
    templateId: 'pitchFree',
  },
  {
    name: 'Volume Free Mode',
    category: 'Free Mode',
    mode: 'free',
    templateId: 'volumeFree',
  },
];

const fallbackRecommendations: Exercise[] = [
  exercises[0],
  exercises[5],
  exercises[10],
  exercises[15],
  exercises[20],
].filter((exercise): exercise is Exercise => Boolean(exercise));

function clampPercentage(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.round(Math.max(0, Math.min(100, value)));
}

function getExerciseDifficulty(_exercise: Exercise): string {
  return 'Beginner';
}

export default function ExercisesScreen() {
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [filterOpen, setFilterOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [progressSummaries, setProgressSummaries] =
    useState<ComponentProgressSummary[]>([]);
  const [recommendationsLoading, setRecommendationsLoading] =
    useState(true);

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

  const filteredExercises = useMemo(() => {
    return exercises.filter((exercise) => {
      const matchesCategory =
        selectedCategory === 'All' ||
        (selectedCategory === 'Free Mode'
          ? exercise.mode === 'free'
          : exercise.category === selectedCategory);

      const matchesSearch = exercise.name
        .toLowerCase()
        .includes(search.toLowerCase());

      return matchesCategory && matchesSearch;
    });
  }, [selectedCategory, search]);

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
          (item) => item.componentId === componentId,
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
        if (a.completed > 0 && b.completed === 0) {
          return -1;
        }

        if (a.completed === 0 && b.completed > 0) {
          return 1;
        }

        if (a.completed > 0 && b.completed > 0) {
          return a.score - b.score;
        }

        return 0;
      });

    const recommendations: Exercise[] = [];

    for (const component of rankedComponents) {
      const exercise = exercises.find(
        (item) => item.category === component.category,
      );

      if (exercise) {
        recommendations.push(exercise);
      }

      if (recommendations.length >= 5) {
        break;
      }
    }

    for (const component of rankedComponents) {
      if (recommendations.length >= 3) {
        break;
      }

      const remainingExercises = exercises.filter(
        (exercise) =>
          exercise.category === component.category &&
          !recommendations.some(
            (recommended) =>
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
  
  const handleExercisePress = (exercise: Exercise) => {
    if (exercise.mode === 'free') {
      const freeModeRoutes: Record<string, string> = {
        'Breath Control': '/exercises/breath-control',
        Pitch: '/exercises/pitch',
        Volume: '/exercises/volume',
      };

      const routeKey = exercise.name.startsWith('Breath Control')
        ? 'Breath Control'
        : exercise.name.startsWith('Pitch')
          ? 'Pitch'
          : exercise.name.startsWith('Volume')
            ? 'Volume'
            : '';

      const pathname = freeModeRoutes[routeKey];

      if (!pathname) {
        console.warn('Free Mode route not found:', exercise.name);
        return;
      }

      router.push({
        pathname: pathname as
          | '/exercises/breath-control'
          | '/exercises/pitch'
          | '/exercises/volume',
        params: {
          mode: 'free',
        },
      });

      return;
    }

    if (!exercise.templateId) {
      console.warn('Missing templateId for:', exercise.name);
      return;
    }

    const routes: Record<string, string> = {
      'Breath Control': '/exercises/breath-control',
      Pitch: '/exercises/pitch',
      Tone: '/exercises/tone',
      Volume: '/exercises/volume',
      Agility: '/exercises/agility',
    };

    const pathname = routes[exercise.category];

    if (!pathname) {
      console.warn('No route found for:', exercise.category);
      return;
    }

    router.push({
      pathname: pathname as
        | '/exercises/breath-control'
        | '/exercises/pitch'
        | '/exercises/tone'
        | '/exercises/volume'
        | '/exercises/agility',
      params: {
        templateId: exercise.templateId,
      },
    });
  };

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
              color={COLORS.muted}
            />

            <TextInput
              style={styles.searchInput}
              placeholder="Search exercises..."
              placeholderTextColor={COLORS.muted}
              value={search}
              onChangeText={setSearch}
            />
          </View>
        </View>

        <Text style={styles.title}>Vocal Exercises</Text>

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
              <View style={styles.recommendedImage}>
                <Ionicons
                  name={
                    exercise.category === 'Breath Control'
                      ? 'leaf-outline'
                      : exercise.category === 'Pitch'
                        ? 'musical-note-outline'
                        : exercise.category === 'Tone'
                          ? 'radio-outline'
                          : exercise.category === 'Volume'
                            ? 'volume-high-outline'
                            : 'flash-outline'
                  }
                  size={56}
                  color={COLORS.brown}
                />

                <View style={styles.recommendedDifficulty}>
                  <Text style={styles.difficultyText}>
                    {exercise.category}
                  </Text>
                </View>
              </View>

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
                    color={COLORS.brown}
                  />
                </Pressable>
              </View>
            </View>
          ))}
        </ScrollView>

        <View style={styles.exerciseHeader}>
          <Text style={styles.exerciseTitle}>Exercises</Text>

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
                color={COLORS.muted}
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

        <Text style={styles.resultCount}>
          {filteredExercises.length}{' '}
          {filteredExercises.length === 1
            ? 'exercise'
            : 'exercises'}
        </Text>

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
                  color={COLORS.brown}
                />
              </View>
            </Pressable>
          ))}

          {filteredExercises.length === 0 && (
            <View style={styles.noResults}>
              <Ionicons
                name="search-outline"
                size={32}
                color={COLORS.muted}
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
    backgroundColor: COLORS.white,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 140,
  },
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
    borderColor: COLORS.border,
    borderRadius: 10,
    backgroundColor: COLORS.white,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  searchInput: {
    flex: 1,
    marginLeft: 9,
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    color: COLORS.brown,
    padding: 0,
  },
  title: {
    fontFamily: 'FredokaBold',
    fontSize: 34,
    color: COLORS.brown,
    marginBottom: 20,
  },
  recommendedHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  recommendedTitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 16,
    color: COLORS.brown,
  },
  recommendedSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: COLORS.brown,
    marginTop: 2,
  },
  recommendedScroll: {
    paddingBottom: 26,
  },
  recommendedCard: {
    width: 180,
    height: 193,
    backgroundColor: COLORS.pink,
    borderRadius: 10,
    padding: 14,
    marginRight: 14,
    shadowColor: COLORS.black,
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
    backgroundColor: COLORS.white,
    borderRadius: 7,
    position: 'relative',
    marginBottom: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recommendedDifficulty: {
    position: 'absolute',
    right: 7,
    bottom: 7,
    backgroundColor: COLORS.white,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  difficultyText: {
    fontFamily: 'FredokaBold',
    fontSize: 9,
    color: COLORS.brown,
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
    color: COLORS.brown,
  },
  smallPlayButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.black,
    shadowOpacity: 0.12,
    shadowRadius: 4,
    shadowOffset: {
      width: 0,
      height: 2,
    },
    elevation: 3,
  },
  exerciseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  exerciseTitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 31,
    color: COLORS.brown,
  },
  dropdownWrapper: {
    position: 'relative',
    zIndex: 100,
  },
  dropdown: {
    width: 125,
    height: 32,
    backgroundColor: COLORS.pink,
    borderRadius: 8,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dropdownText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: COLORS.brown,
    maxWidth: 90,
  },
  dropdownMenu: {
    position: 'absolute',
    top: 37,
    right: 0,
    width: 145,
    backgroundColor: COLORS.white,
    borderRadius: 10,
    paddingVertical: 5,
    zIndex: 100,
    elevation: 8,
    shadowColor: COLORS.black,
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
    backgroundColor: COLORS.background,
  },
  dropdownItemText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: COLORS.brown,
  },
  selectedDropdownText: {
    fontFamily: 'FredokaBold',
  },
  resultCount: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: COLORS.muted,
    marginBottom: 8,
  },
  exerciseList: {
    gap: 7,
  },
  exerciseCard: {
    minHeight: 64,
    backgroundColor: COLORS.background,
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
    color: COLORS.brown,
  },
  levelBadge: {
    width: 61,
    backgroundColor: COLORS.pink,
    borderRadius: 10,
    paddingVertical: 4,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  levelText: {
    fontFamily: 'FredokaBold',
    fontSize: 8,
    color: COLORS.brown,
  },
  exerciseCategory: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    lineHeight: 12,
    color: COLORS.brown,
  },
  listPlayButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.black,
    shadowOpacity: 0.1,
    shadowRadius: 3,
    shadowOffset: {
      width: 0,
      height: 2,
    },
    elevation: 2,
  },
  noResults: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  noResultsTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 17,
    color: COLORS.brown,
    marginTop: 10,
  },
  noResultsText: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: COLORS.muted,
    marginTop: 4,
  },
});