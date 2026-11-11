import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Image, ScrollView, Text, TouchableOpacity, View } from 'react-native';

import { COLORS } from '@/constants/appConstants';
import { exerciseStyles } from '@/constants/exerciseStyles';

type ExerciseComponent =
  | 'breath-control'
  | 'pitch'
  | 'tone'
  | 'volume'
  | 'agility';

type Exercise = {
  id: string;
  title: string;
  description: string;
  templateId: string;
};

type ComponentConfig = {
  title: string;
  subtitle: string;
  category: string;
  route: string;
  exercises: Exercise[];
  freeMode?: boolean;
  freeModeDescription?: string;
};

const COMPONENTS: Record<ExerciseComponent, ComponentConfig> = {
  'breath-control': {
    title: 'Breath Control',
    subtitle: 'Strengthen your breath support and airflow control.',
    category: 'Breath Control',
    route: '/exercises/breath-control',
    freeMode: true,
    freeModeDescription:
      'Practice your breathing freely without a structured exercise.',
    exercises: [
      {
        id: 'sustained-exhale',
        title: 'Sustained Exhale',
        description:
          'Practice releasing your breath steadily for a controlled duration.',
        templateId: 'sustainedExhale',
      },
      {
        id: 'sustained-ssss',
        title: 'Sustained "SSSS" Sound',
        description:
          'Maintain a steady stream of air while sustaining an SSSS sound.',
        templateId: 'sustainedSSSS',
      },
      {
        id: 'diaphragmatic-breathing',
        title: 'Diaphragmatic Breathing',
        description:
          'Practice controlled breathing with attention to diaphragmatic movement.',
        templateId: 'diaphragmaticBreathing',
      },
      {
        id: 'steady-airflow',
        title: 'Steady Airflow Maintenance',
        description:
          'Develop consistent airflow throughout a sustained breathing task.',
        templateId: 'steadyAirflowMaintenance',
      },
      {
        id: 'controlled-breath-release',
        title: 'Controlled Breath Release',
        description:
          'Improve control over how gradually and consistently you release air.',
        templateId: 'controlledBreathRelease',
      },
    ],
  },

  pitch: {
    title: 'Pitch',
    subtitle: 'Build accuracy, intonation, and musical control.',
    category: 'Pitch',
    route: '/exercises/pitch',
    freeMode: true,
    freeModeDescription:
      'Practice singing freely without a structured exercise.',
    exercises: [
      {
        id: 'note-matching',
        title: 'Note Matching Exercise',
        description:
          'Listen to a reference note and sing the matching pitch.',
        templateId: 'noteMatchingExercise',
      },
      {
        id: 'scale-accuracy',
        title: 'Scale Accuracy Drill',
        description:
          'Practice singing scale notes accurately and in the correct order.',
        templateId: 'scaleAccuracyDrill',
      },
      {
        id: 'interval-recognition',
        title: 'Interval Recognition Task',
        description:
          'Practice identifying and reproducing pitch intervals.',
        templateId: 'intervalRecognitionTask',
      },
      {
        id: 'sustained-note-stability',
        title: 'Sustained Note Stability',
        description:
          'Maintain a consistent target pitch while holding a note.',
        templateId: 'sustainedNoteStability',
      },
      {
        id: 'melodic-pattern-matching',
        title: 'Melodic Pattern Matching',
        description:
          'Listen to a short melodic pattern and reproduce its sequence of notes.',
        templateId: 'melodicPatternMatching',
      },
    ],
  },

  tone: {
    title: 'Tone',
    subtitle: 'Refine resonance, consistency, and vocal color.',
    category: 'Tone',
    route: '/exercises/tone',
    exercises: [
      {
        id: 'vowel-consistency',
        title: 'Vowel Consistency Exercise',
        description:
          'Practice maintaining a consistent vocal tone while producing vowel sounds.',
        templateId: 'vowelConsistencyExercise',
      },
      {
        id: 'waveform-smoothness',
        title: 'Waveform Smoothness Drill',
        description:
          'Work on producing a smoother and more consistent vocal sound.',
        templateId: 'waveformSmoothnessDrill',
      },
      {
        id: 'frequency-zone',
        title: 'Frequency Zone Stability',
        description:
          'Practice maintaining tonal consistency within a target frequency zone.',
        templateId: 'frequencyZoneStability',
      },
      {
        id: 'tone-consistency',
        title: 'Tone Consistency Exercise',
        description:
          'Develop a more even vocal tone throughout the exercise.',
        templateId: 'toneConsistencyExercise',
      },
      {
        id: 'steady-tone-holding',
        title: 'Steady Tone Holding',
        description:
          'Sustain a steady vocal tone for the required duration.',
        templateId: 'steadyToneHolding',
      },
    ],
  },

  volume: {
    title: 'Volume',
    subtitle: 'Strengthen your volume control and vocal expression.',
    category: 'Volume',
    route: '/exercises/volume',
    freeMode: true,
    freeModeDescription:
      'Practice your volume freely without a structured exercise.',
    exercises: [
      {
        id: 'dynamic-range',
        title: 'Dynamic Range Exercise',
        description:
          'Practice controlling changes between softer and louder vocal output.',
        templateId: 'dynamic-range',
      },
      {
        id: 'controlled-crescendo',
        title: 'Controlled Crescendo Drill',
        description:
          'Gradually increase vocal volume while maintaining control.',
        templateId: 'controlled-crescendo',
      },
      {
        id: 'controlled-decrescendo',
        title: 'Controlled Decrescendo Drill',
        description:
          'Gradually decrease vocal volume while maintaining control.',
        templateId: 'controlled-decrescendo',
      },
      {
        id: 'volume-band-targeting',
        title: 'Volume Band Targeting',
        description:
          'Practice producing vocal output within a specified volume range.',
        templateId: 'volume-band-targeting',
      },
      {
        id: 'volume-control-stability',
        title: 'Volume Control Stability',
        description:
          'Maintain a consistent vocal volume throughout a sustained task.',
        templateId: 'volume-control-stability',
      },
    ],
  },

  agility: {
    title: 'Agility',
    subtitle: 'Build speed, dexterity, and smooth vocal transitions.',
    category: 'Agility',
    route: '/exercises/agility',
    exercises: [
      {
        id: 'rapid-note-transition',
        title: 'Rapid Note-Transition Exercise',
        description:
          'Practice moving smoothly and accurately between notes.',
        templateId: 'rapidNoteTransition',
      },
      {
        id: 'arpeggio-speed',
        title: 'Arpeggio Speed Drill',
        description:
          'Practice singing arpeggio notes accurately at the required speed.',
        templateId: 'arpeggioSpeed',
      },
      {
        id: 'vocal-run-accuracy',
        title: 'Vocal Run Accuracy Task',
        description:
          'Improve accuracy when singing a sequence of quickly changing notes.',
        templateId: 'vocalRunAccuracy',
      },
      {
        id: 'quick-interval-jump',
        title: 'Quick Interval Jump',
        description:
          'Practice moving quickly and accurately between different pitches.',
        templateId: 'quickIntervalJump',
      },
      {
        id: 'rapid-scale-trill',
        title: 'Rapid Scale Trill',
        description:
          'Develop speed and control when performing rapid scale patterns.',
        templateId: 'rapidScaleTrill',
      },
    ],
  },
};

type Props = {
  component: ExerciseComponent;
};

export default function ExerciseListScreen({ component }: Props) {
  const config = COMPONENTS[component];

  const openExercise = (exercise: Exercise) => {
    router.push({
      pathname: config.route as never,
      params: {
        templateId: exercise.templateId,
      },
    });
  };

  const openFreeMode = () => {
    router.push({
      pathname: config.route as never,
      params: {
        mode: 'free',
      },
    });
  };

  return (
    <View style={exerciseStyles.screen}>
      <View style={exerciseStyles.header_ExerciseList}>
        <TouchableOpacity
          style={exerciseStyles.backButton_ExerciseList}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={19} color={COLORS.brown} />
        </TouchableOpacity>

        <Image
          source={require('@/assets/images/tabIcons/tuneup-logo.png')}
          style={exerciseStyles.logo_ExerciseList}
          resizeMode="contain"
        />

        <View style={exerciseStyles.headerSpacer} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={exerciseStyles.content_ExerciseList}
      >
        <Text style={exerciseStyles.pageTitle_ExerciseList}>{config.title}</Text>

        <Text style={exerciseStyles.pageSubtitle}>{config.subtitle}</Text>

        <View style={exerciseStyles.exerciseList_ExerciseList}>
          {config.exercises.map(exercise => (
            <TouchableOpacity
              key={exercise.id}
              style={exerciseStyles.exerciseCard_ExerciseList}
              onPress={() => openExercise(exercise)}
              activeOpacity={0.9}
              accessibilityRole="button"
              accessibilityLabel={`Open ${exercise.title}`}
            >
              <View style={exerciseStyles.exerciseNameContainer}>
                <Text style={exerciseStyles.exerciseName_Exercises} numberOfLines={2}>
                  {exercise.title}
                </Text>
              </View>

              <View style={exerciseStyles.levelBadge_ExerciseList}>
                <Text style={exerciseStyles.levelText}>Beginner</Text>
              </View>

              <Text style={exerciseStyles.exerciseCategory} numberOfLines={1}>
                {config.category}
              </Text>

              <View style={exerciseStyles.listPlayButton_ExerciseList}>
                <Ionicons name="play" size={16} color={COLORS.brown} />
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {config.freeMode && (
          <TouchableOpacity
            style={exerciseStyles.freeMode}
            onPress={openFreeMode}
            activeOpacity={0.9}
            accessibilityRole="button"
          >
            <View style={exerciseStyles.infoIcon}>
              <Ionicons
                name="musical-notes"
                size={20}
                color={COLORS.brown}
              />
            </View>

            <View style={exerciseStyles.infoText}>
              <Text style={exerciseStyles.cardTitle}>Free Mode</Text>
              <Text style={exerciseStyles.repResultDetails}>
                {config.freeModeDescription}
              </Text>
            </View>

            <Ionicons
              name="chevron-forward"
              size={18}
              color={COLORS.brown}
            />
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );

}
