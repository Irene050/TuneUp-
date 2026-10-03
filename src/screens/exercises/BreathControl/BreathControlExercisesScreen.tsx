import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const WHITE = '#FFFFFF';
const MUTED = '#A58F84';

const breathExercises = [
  {
    id: 'sustained-exhale',
    number: '1',
    title: 'Sustained Exhale',
    description:
      'Practice maintaining a steady and controlled airflow during a sustained exhale.',
    templateId: 'sustainedExhale',
  },
  {
    id: 'sustained-ssss',
    number: '2',
    title: 'Sustained "SSSS" Sound',
    description:
      'Practice maintaining consistent airflow while producing a sustained SSSS sound.',
    templateId: 'sustainedSSSS',
  },
  {
    id: 'diaphragmatic-breathing',
    number: '3',
    title: 'Diaphragmatic Breathing',
    description:
      'Practice controlled breathing using the diaphragm for better breath support.',
    templateId: 'diaphragmaticBreathing',
  },
  {
    id: 'steady-airflow',
    number: '4',
    title: 'Steady Airflow Maintenance',
    description:
      'Practice maintaining an even and stable airflow throughout the exercise.',
    templateId: 'steadyAirflowMaintenance',
  },
  {
    id: 'controlled-breath-release',
    number: '5',
    title: 'Controlled Breath Release',
    description:
      'Practice releasing breath gradually while maintaining consistent control.',
    templateId: 'controlledBreathRelease',
  },
];

const openExercise = (templateId: string) => {
  router.push(
    `/exercises/breath-control?templateId=${encodeURIComponent(
      templateId,
    )}` as any,
  );
};

export default function BreathControlExercisesScreen() {
  return (
    <View style={styles.screen}>
      {/* HEADER */}
      <View style={styles.header}>
        <Pressable
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <Ionicons
            name="arrow-back"
            size={19}
            color={BROWN}
          />
        </Pressable>

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
        {/* TITLE */}
        <Text style={styles.pageTitle}>
          Breath Control
        </Text>

        <Text style={styles.pageSubtitle}>
          Strengthen your breath support
          and airflow control.
        </Text>

        {/* EXERCISES */}
        <View style={styles.exerciseList}>
          {breathExercises.map((exercise) => (
            <Pressable
              key={exercise.id}
              style={({ pressed }) => [
                styles.exerciseCard,
                pressed && styles.pressed,
              ]}
              onPress={() =>
                openExercise(exercise.templateId)
              }
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
                Breath Control
              </Text>

              <View style={styles.listPlayButton}>
                <Ionicons name="play" size={16} color={BROWN} />
              </View>
            </Pressable>
          ))}
        </View>

        {/* FREE MODE */}
        <Pressable
          style={({ pressed }) => [
            styles.freeMode,
            pressed && styles.freeModePressed,
          ]}
          onPress={() =>
            router.push(
              '/exercises/breath-control?mode=free' as any,
            )
          }
        >
          <View style={styles.freeModeIcon}>
            <Ionicons
              name="musical-notes"
              size={20}
              color={BROWN}
            />
          </View>

          <View style={styles.freeModeText}>
            <Text style={styles.freeModeTitle}>
              Free Mode
            </Text>

            <Text style={styles.freeModeDescription}>
              Practice your breathing freely
              without a structured exercise.
            </Text>
          </View>

          <Ionicons
            name="chevron-forward"
            size={18}
            color={BROWN}
          />
        </Pressable>
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
    marginTop: 68.4,
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
    fontSize: 9,
    lineHeight: 13,
    color: MUTED,
    marginTop: 2,
    marginBottom: 16,
  },

  exerciseList: {
    gap: 5,
    marginTop: 4,
  },

  exerciseCard: {
    minHeight: 64,
    backgroundColor: LIGHT_PINK,
    borderRadius: 9,
    paddingHorizontal: 14,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
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
    opacity: 0.72,
  },

  numberCircle: {
    position: 'absolute',
    top: 5,
    left: 5,
    width: 21,
    height: 21,
    borderRadius: 11,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
  },

  numberText: {
    fontFamily: 'FredokaBold',
    fontSize: 7,
    color: BROWN,
  },

  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },

  exerciseInfo: {
    flex: 1,
    paddingRight: 7,
  },

  exerciseTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 11,
    lineHeight: 14,
    color: BROWN,
    marginBottom: 2,
  },

  exerciseDescription: {
    fontFamily: 'FredokaRegular',
    fontSize: 8,
    lineHeight: 11,
    color: MUTED,
  },

  playButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 3,
    shadowOffset: {
      width: 0,
      height: 2,
    },
    elevation: 2,
  },

  freeMode: {
    minHeight: 67,
    marginTop: 24,
    backgroundColor: PINK,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
  },

  freeModePressed: {
    opacity: 0.72,
  },

  freeModeIcon: {
    width: 41,
    height: 41,
    borderRadius: 21,
    backgroundColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 9,
  },

  freeModeText: {
    flex: 1,
  },

  freeModeTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 12,
    color: BROWN,
    marginBottom: 2,
  },

  freeModeDescription: {
    fontFamily: 'FredokaRegular',
    fontSize: 8,
    lineHeight: 11,
    color: BROWN,
  },
});
