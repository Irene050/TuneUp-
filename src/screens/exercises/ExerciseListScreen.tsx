import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const WHITE = '#FFFFFF';
const MUTED = '#A58F84';

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
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={19} color={BROWN} />
        </TouchableOpacity>

        <Image
          source={require('@/assets/images/tabIcons/tuneup-logo.png')}
          style={styles.logo}
          resizeMode="contain"
        />

        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        <Text style={styles.pageTitle}>{config.title}</Text>

        <Text style={styles.pageSubtitle}>{config.subtitle}</Text>

        <View style={styles.exerciseList}>
          {config.exercises.map((exercise, index) => (
            <TouchableOpacity
              key={exercise.id}
              style={styles.exerciseCard}
              onPress={() => openExercise(exercise)}
              activeOpacity={0.9}
              accessibilityRole="button"
              accessibilityLabel={`Open ${exercise.title}`}
            >
              <View style={styles.exerciseNameContainer}>
                <Text style={styles.exerciseName} numberOfLines={2}>
                  {exercise.title}
                </Text>
              </View>

              <View style={styles.levelBadge}>
                <Text style={styles.levelText}>Beginner</Text>
              </View>

              <Text style={styles.exerciseCategory} numberOfLines={1}>
                {config.category}
              </Text>

              <View style={styles.listPlayButton}>
                <Ionicons name="play" size={16} color={BROWN} />
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {config.freeMode && (
          <TouchableOpacity
            style={styles.freeMode}
            onPress={openFreeMode}
            activeOpacity={0.9}
            accessibilityRole="button"
          >
            <View style={styles.freeModeIcon}>
              <Ionicons
                name="musical-notes"
                size={20}
                color={BROWN}
              />
            </View>

            <View style={styles.freeModeText}>
              <Text style={styles.freeModeTitle}>Free Mode</Text>
              <Text style={styles.freeModeDescription}>
                {config.freeModeDescription}
              </Text>
            </View>

            <Ionicons
              name="chevron-forward"
              size={18}
              color={BROWN}
            />
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );

}


const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: WHITE,
  },
  header: {
    height: 72,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 17,
    position: 'relative',
  },
  backButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 72,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontFamily: 'FredokaBold',
    fontSize: 17,
    color: BROWN,
  },
  headerSpacer: {
    width: 34,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 36,
    paddingBottom: 35,
  },
  logo: {
    width: 45,
    height: 45,
    marginBottom: 0,
    marginTop: 68.4,
    position: 'absolute',
    left: '50%',
    marginLeft: -5.5,
  },
  pageTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 32,
    color: BROWN,
    marginTop: 16,
  },
  pageSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    lineHeight: 18,
    color: MUTED,
    marginTop: 2,
    marginBottom: 16,
  },
  exerciseList: {
    gap: 5,
    marginTop: 4,
  },
  exerciseCard: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 64,
    backgroundColor: LIGHT_PINK,
    borderRadius: 9,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderWidth: 0,
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
    paddingVertical: 3,
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
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  pressed: {
    opacity: 0.9,
  },
  numberCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  numberText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 12,
    color: BROWN,
  },
  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#FDEBF2',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  exerciseInfo: {
    flex: 1,
    marginRight: 10,
  },
  exerciseTitle: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 15,
    color: BROWN,
    marginBottom: 3,
  },
  exerciseDescription: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 15,
    color: MUTED,
  },
  playButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
  },
  freeMode: {
    marginTop: 24,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF4F6',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#F2C9D5',
    padding: 14,
  },
  freeModePressed: {
    opacity: 0.9,
  },
  freeModeIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  freeModeText: {
    flex: 1,
  },
  freeModeTitle: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 15,
    color: BROWN,
  },
  freeModeDescription: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    marginTop: 2,
  },
});