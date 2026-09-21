import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import {
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

        <Text style={styles.headerTitle}>
          Breath Control
        </Text>

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
              {/* NUMBER */}
              <View style={styles.numberCircle}>
                <Text style={styles.numberText}>
                  {exercise.number}
                </Text>
              </View>

              {/* ICON */}
              <View style={styles.iconCircle}>
                <Ionicons
                  name="water-outline"
                  size={19}
                  color={BROWN}
                />
              </View>

              {/* TEXT */}
              <View style={styles.exerciseInfo}>
                <Text
                  style={styles.exerciseTitle}
                  numberOfLines={2}
                >
                  {exercise.title}
                </Text>

                <Text
                  style={styles.exerciseDescription}
                  numberOfLines={2}
                >
                  {exercise.description}
                </Text>
              </View>

              {/* PLAY */}
              <View style={styles.playButton}>
                <Ionicons
                  name="play"
                  size={15}
                  color={BROWN}
                />
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
              '/exercises/breath-control/free-mode' as any,
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
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 17,
  },

  backButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: LIGHT_PINK,
    alignItems: 'center',
    justifyContent: 'center',
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
    paddingHorizontal: 16,
    paddingBottom: 35,
  },

  pageTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 26,
    color: BROWN,
    marginTop: 5,
  },

  pageSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 9,
    lineHeight: 13,
    color: MUTED,
    marginTop: 2,
    marginBottom: 15,
  },

  exerciseList: {
    gap: 8,
  },

  exerciseCard: {
    minHeight: 72,
    backgroundColor: LIGHT_PINK,
    borderRadius: 12,
    paddingHorizontal: 9,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#F0E0E4',
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
    width: 43,
    height: 43,
    borderRadius: 22,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 9,
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
    marginTop: 13,
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
