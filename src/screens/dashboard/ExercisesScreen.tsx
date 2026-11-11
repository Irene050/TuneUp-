import AppHeader from '@/components/appheader';
import { COLORS } from '@/constants/appConstants';
import { exerciseStyles } from '@/constants/exerciseStyles';
import { auth } from '@/services/firebase/config';
import type {
  ComponentId,
  ComponentProgressSummary,
} from '@/services/progress/progressModule';
import { fetchAllProgress } from '@/services/progress/progressRepo';
import { clampPercentage } from '@/utils/math';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

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
    <View style={exerciseStyles.screen}>
      <AppHeader />

      <ScrollView
        style={exerciseStyles.infoText}
        contentContainerStyle={exerciseStyles.content_Exercises}
        showsVerticalScrollIndicator={false}
      >
        <View style={exerciseStyles.searchRow}>
          <View style={exerciseStyles.searchContainer}>
            <Ionicons
              name="search-outline"
              size={21}
              color={COLORS.muted}
            />

            <TextInput
              style={exerciseStyles.searchInput}
              placeholder="Search exercises..."
              placeholderTextColor={COLORS.muted}
              value={search}
              onChangeText={setSearch}
            />
          </View>
        </View>

        <Text style={exerciseStyles.title_Exercises}>Vocal Exercises</Text>

        <View style={exerciseStyles.recommendedHeader}>
          <View>
            <Text style={exerciseStyles.recommendedTitle}>
              Recommended For You
            </Text>

            <Text style={exerciseStyles.recommendedSubtitle}>
              {recommendationsLoading
                ? 'Loading your exercise scores...'
                : 'Based on your component scores'}
            </Text>
          </View>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={exerciseStyles.recommendedScroll}
        >
          {recommendedExercises.map((exercise) => (
            <View
              key={`${exercise.category}-${exercise.name}`}
              style={exerciseStyles.recommendedCard}
            >
              <View style={exerciseStyles.recommendedImage}>
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

                <View style={exerciseStyles.recommendedDifficulty}>
                  <Text style={exerciseStyles.difficultyText}>
                    {exercise.category}
                  </Text>
                </View>
              </View>

              <View style={exerciseStyles.genderRow}>
                <View style={exerciseStyles.recommendedExerciseText}>
                  <Text
                    style={exerciseStyles.scoreRowValue}
                    numberOfLines={2}
                  >
                    {exercise.name}
                  </Text>
                </View>

                <Pressable
                  style={exerciseStyles.smallPlayButton}
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

        <View style={exerciseStyles.exerciseHeader_Exercises}>
          <Text style={exerciseStyles.exerciseTitle_Exercises}>Exercises</Text>

          <View style={exerciseStyles.dropdownWrapper}>
            <Pressable
              style={exerciseStyles.dropdown_Exercises}
              onPress={() => setFilterOpen(!filterOpen)}
              accessibilityRole="button"
              accessibilityLabel="Filter exercises by category"
            >
              <Text style={exerciseStyles.dropdownText_Exercises}>
                {selectedCategory}
              </Text>

              <Ionicons
                name={filterOpen ? 'chevron-up' : 'chevron-down'}
                size={15}
                color={COLORS.muted}
              />
            </Pressable>

            {filterOpen && (
              <View style={exerciseStyles.dropdownMenu}>
                {categories.map((category) => (
                  <Pressable
                    key={category}
                    style={[
                      exerciseStyles.dropdownItem,
                      selectedCategory === category &&
                        exerciseStyles.selectedDropdownItem,
                    ]}
                    onPress={() => {
                      setSelectedCategory(category);
                      setFilterOpen(false);
                      setSearch('');
                    }}
                  >
                    <Text
                      style={[
                        exerciseStyles.dropdownItemText,
                        selectedCategory === category &&
                          exerciseStyles.selectedDropdownText,
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

        <Text style={exerciseStyles.resultCount}>
          {filteredExercises.length}{' '}
          {filteredExercises.length === 1
            ? 'exercise'
            : 'exercises'}
        </Text>

        <View style={exerciseStyles.exerciseList_Exercises}>
          {filteredExercises.map((exercise) => (
            <Pressable
              key={exercise.name}
              style={({ pressed }) => [
                exerciseStyles.exerciseCard_Exercises,
                pressed && exerciseStyles.disabledButton,
              ]}
              onPress={() => handleExercisePress(exercise)}
              accessibilityRole="button"
              accessibilityLabel={`Open ${exercise.name}`}
            >
              <View style={exerciseStyles.exerciseNameContainer}>
                <Text
                  style={exerciseStyles.exerciseName_Exercises}
                  numberOfLines={2}
                >
                  {exercise.name}
                </Text>
              </View>

              <View style={exerciseStyles.levelBadge_Exercises}>
                <Text style={exerciseStyles.levelText}>
                  {getExerciseDifficulty(exercise)}
                </Text>
              </View>

              <Text
                style={exerciseStyles.exerciseCategory}
                numberOfLines={1}
              >
                {exercise.category}
              </Text>

              <View style={exerciseStyles.listPlayButton_Exercises}>
                <Ionicons
                  name="play"
                  size={16}
                  color={COLORS.brown}
                />
              </View>
            </Pressable>
          ))}

          {filteredExercises.length === 0 && (
            <View style={exerciseStyles.noResults}>
              <Ionicons
                name="search-outline"
                size={32}
                color={COLORS.muted}
              />

              <Text style={exerciseStyles.noResultsTitle}>
                No exercises found
              </Text>

              <Text style={exerciseStyles.noResultsText}>
                Try another search or category.
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
