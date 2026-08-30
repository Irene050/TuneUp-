import AppHeader from '@/components/appheader';
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
const LIGHT_GRAY = '#F2F2F2';
const WHITE = '#FFFFFF';
const MUTED = '#8E7770';

export default function DashboardScreen() {
  return (
    <View style={styles.screen}>
      <AppHeader />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* USER INTRO */}
        <View style={styles.userSection}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>U</Text>
          </View>

          <View>
            <Text style={styles.userName}>User</Text>
            <Text style={styles.userLevel}>lvl. 0</Text>
          </View>
        </View>

        {/* ASSESSMENT */}
        <Pressable style={styles.assessmentCard}>
          <View style={styles.assessmentIcon}>
            <Ionicons
              name="mic"
              size={25}
              color={BROWN}
            />
          </View>

          <View style={styles.assessmentContent}>
            <Text style={styles.assessmentTitle}>
              Find your vocal strengths!
            </Text>

            <Text style={styles.assessmentDescription}>
              Take a quick assessment to personalize
              your exercises.
            </Text>

            <View style={styles.assessmentButton}>
              <Text style={styles.assessmentButtonText}>
                Assess Me!
              </Text>

              <Ionicons
                name="arrow-forward"
                size={16}
                color={WHITE}
              />
            </View>
          </View>
        </Pressable>

        {/* VOCAL EXERCISES HEADER */}
        <View style={styles.sectionHeader}></View>

        {/* VOCAL EXERCISES HEADER */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>
            Vocal Components
          </Text>

          <Pressable
            onPress={() => router.push('/dashboard/exercises')}
            >
            <Text style={styles.viewMore}>
                view more
            </Text>
        </Pressable>
        </View>

        {/* RECOMMENDED EXERCISES */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.exerciseScroll}
        >
          {/* CARD 1 */}
          <Pressable style={styles.exerciseCard}>
            <View style={styles.exerciseImage}>
            </View>

            <View style={styles.exerciseBottom}>
              <View style={styles.exerciseText}>
                <Text style={styles.exerciseName}>
                  Breath Control
                </Text>

                <Text style={styles.exerciseDescription}>
                  Breath Control Exercises Available Here!
                </Text>
              </View>

              <View style={styles.playButton}>
                <Ionicons
                  name="play"
                  size={20}
                  color={BROWN}
                />
              </View>
            </View>
          </Pressable>

          {/* CARD 2 */}
          <Pressable style={styles.exerciseCard}>
            <View style={styles.exerciseImage}>
            </View>

            <View style={styles.exerciseBottom}>
              <View style={styles.exerciseText}>
                <Text style={styles.exerciseName}>
                  Pitch
                </Text>

                <Text style={styles.exerciseDescription}>
                  Pitch Exercises Available Here!
                </Text>
              </View>

              <View style={styles.playButton}>
                <Ionicons
                  name="play"
                  size={20}
                  color={BROWN}
                />
              </View>
            </View>
          </Pressable>

          {/* CARD 3 */}
          <Pressable style={styles.exerciseCard}>
            <View style={styles.exerciseImage}>
            </View>

            <View style={styles.exerciseBottom}>
              <View style={styles.exerciseText}>
                <Text style={styles.exerciseName}>
                  Tone
                </Text>

                <Text style={styles.exerciseDescription}>
                  Tone Exercises Available Here!
                </Text>
              </View>

              <View style={styles.playButton}>
                <Ionicons
                  name="play"
                  size={20}
                  color={BROWN}
                />
              </View>
            </View>
          </Pressable>

          {/* CARD 4 */}
          <Pressable style={styles.exerciseCard}>
            <View style={styles.exerciseImage}>
            </View>

            <View style={styles.exerciseBottom}>
              <View style={styles.exerciseText}>
                <Text style={styles.exerciseName}>
                  Volume
                </Text>

                <Text style={styles.exerciseDescription}>
                  Volume Exercises Available Here!
                </Text>
              </View>

              <View style={styles.playButton}>
                <Ionicons
                  name="play"
                  size={20}
                  color={BROWN}
                />
              </View>
            </View>
          </Pressable>

          {/* CARD 5 */}
          <Pressable style={styles.exerciseCard}>
            <View style={styles.exerciseImage}>
            </View>

            <View style={styles.exerciseBottom}>
              <View style={styles.exerciseText}>
                <Text style={styles.exerciseName}>
                  Agility
                </Text>

                <Text style={styles.exerciseDescription}>
                  Agility Exercises Available Here!
                </Text>
              </View>

              <View style={styles.playButton}>
                <Ionicons
                  name="play"
                  size={20}
                  color={BROWN}
                />
              </View>
            </View>
          </Pressable>
        </ScrollView>

        {/* MY PROGRESS */}
        <View style={styles.progressHeader}>
          <Text style={styles.sectionTitle}>
            My Progress
          </Text>
        </View>

        <View style={styles.progressCard}>
          <View style={styles.progressTop}>
            <View>
              <Text style={styles.progressTitle}>
                Keep practicing!
              </Text>

              <Text style={styles.progressSubtitle}>
                Complete exercises to improve your skills.
              </Text>
            </View>
          </View>

            <Text style={styles.progressPercent}>
              0%
            </Text>

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

  userSection: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 28,
  },

  avatar: {
    width: 58,
    height: 58,
    borderRadius: 29,

    backgroundColor: PINK,

    alignItems: 'center',
    justifyContent: 'center',

    marginRight: 14,
  },

  avatarText: {
    fontFamily: 'FredokaBold',
    fontSize: 24,
    color: BROWN,
  },

  userName: {
    fontFamily: 'FredokaBold',
    fontSize: 20,
    color: BROWN,
  },

  userLevel: {
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    color: BROWN,
    marginTop: -2,
  },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',

    marginBottom: 14,
  },

  sectionTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 24,
    color: BROWN,
  },

  viewMore: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: BROWN,
  },

  exerciseScroll: {
    paddingBottom: 35,
  },

  exerciseCard: {
    width: 320,
    height: 300,

    backgroundColor: PINK,

    borderRadius: 20,

    padding: 14,

    marginRight: 18,

    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 8,
    shadowOffset: {
      width: 0,
      height: 4,
    },

    elevation: 5,
  },

  exerciseImage: {
    height: 195,

    backgroundColor: WHITE,

    borderRadius: 18,

    position: 'relative',

    marginBottom: 14,
  },

  difficultyBadge: {
    position: 'absolute',

    right: 10,
    bottom: 10,

    backgroundColor: WHITE,

    borderRadius: 12,

    paddingHorizontal: 10,
    paddingVertical: 5,
  },

  difficultyText: {
    fontFamily: 'FredokaBold',
    fontSize: 10,
    color: BROWN,
  },

  exerciseBottom: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  exerciseText: {
    flex: 1,
  },

  exerciseName: {
    fontFamily: 'FredokaBold',
    fontSize: 20,
    color: BROWN,

    marginBottom: 4,
  },

  exerciseDescription: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: BROWN,
  },

  playButton: {
    width: 48,
    height: 48,

    borderRadius: 24,

    backgroundColor: WHITE,

    alignItems: 'center',
    justifyContent: 'center',

    marginLeft: 8,

    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 4,
    shadowOffset: {
      width: 0,
      height: 2,
    },

    elevation: 3,
  },

  // PROGRESS
  progressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',

    marginBottom: 14,
  },

  progressCard: {
    flexDirection: 'row',
    backgroundColor: LIGHT_PINK,

    borderRadius: 18,

    padding: 18,

    borderWidth: 1,
    borderColor: '#F2DDE5',
  },

  progressTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  progressTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 18,
    color: BROWN,
  },

  progressSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,

    marginTop: 3,
  },

  progressIcon: {
    width: 48,
    height: 48,

    borderRadius: 24,

    backgroundColor: PINK,

    alignItems: 'center',
    justifyContent: 'center',
  },

  progressBarBackground: {
    height: 10,

    backgroundColor: LIGHT_GRAY,

    borderRadius: 10,

    marginTop: 20,

    overflow: 'hidden',
  },

  progressBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',

    marginTop: 8,
  },

  progressText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
  },

  progressPercent: {
    fontFamily: 'FredokaBold',
    fontSize: 50,
    color: BROWN,
    marginLeft: 30
  },

  assessmentCard: {
    width: '100%',
    minHeight: 140,

    backgroundColor: PINK,

    borderRadius: 20,

    padding: 20,

    flexDirection: 'row',

    marginBottom: 30,

    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 7,
    shadowOffset: {
      width: 0,
      height: 4,
    },

    elevation: 4,
  },

  assessmentIcon: {
    width: 48,
    height: 48,

    borderRadius: 24,

    backgroundColor: LIGHT_GRAY,

    alignItems: 'center',
    justifyContent: 'center',

    marginRight: 14,
  },

  assessmentContent: {
    flex: 1,
  },

  assessmentTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 18,

    color: BROWN,

    marginBottom: 5,
  },

  assessmentDescription: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,

    lineHeight: 15,

    color: BROWN,

    marginBottom: 13,
  },

  assessmentButton: {
    alignSelf: 'flex-start',

    height: 34,

    paddingHorizontal: 14,

    borderRadius: 17,

    backgroundColor: BROWN,

    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',

    gap: 4,
  },

  assessmentButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 12,

    color: WHITE,
  },
});