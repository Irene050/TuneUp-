import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  SUSTAINED_EXHALE_PARAMS,
  Tier,
} from '@/constants/exercises/breathControl';

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const WHITE = '#FFFFFF';
const MUTED = '#8E7770';

interface Props {
  tier: Tier;
}

export default function SustainedExhaleScreen({
  tier,
}: Props) {
  const params = SUSTAINED_EXHALE_PARAMS[tier];

  return (
    <View style={styles.screen}>
      <Pressable
        style={styles.backButton}
        onPress={() => router.replace('/dashboard/exercises')}
      >
        <Ionicons
          name="arrow-back"
          size={22}
          color={BROWN}
        />
      </Pressable>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        <View style={styles.iconCircle}>
          <Ionicons
            name="cloud-outline"
            size={34}
            color={BROWN}
          />
        </View>

        <Text style={styles.title}>
          Sustained Exhale
        </Text>

        <Text style={styles.subtitle}>
          Breath Control
        </Text>

        <View style={styles.instructionCard}>

          <View style={styles.prepareCard}>
  <View style={styles.prepareHeader}>
    <Ionicons
      name="mic-outline"
      size={21}
      color={BROWN}
    />

    <Text style={styles.prepareTitle}>
      Before You Begin
    </Text>
  </View>

  <View style={styles.prepareItem}>
    <Ionicons
      name="volume-mute-outline"
      size={17}
      color={BROWN}
    />

    <Text style={styles.prepareText}>
      Find a quiet room or area with minimal
      background noise.
    </Text>
  </View>

  <View style={styles.prepareItem}>
    <Ionicons
      name="body-outline"
      size={17}
      color={BROWN}
    />

    <Text style={styles.prepareText}>
      Sit upright or stand with your back straight
      and your shoulders relaxed.
    </Text>
  </View>

  <View style={styles.prepareItem}>
    <Ionicons
      name="mic-outline"
      size={17}
      color={BROWN}
    />

    <Text style={styles.prepareText}>
      If available, using an external microphone or
      audio recording equipment is recommended for
      clearer audio capture.
    </Text>
  </View>
</View>

          <Text style={styles.cardTitle}>
            Instructions
          </Text>

          <Text style={styles.instruction}>
            Take a deep breath, then slowly exhale
            in a smooth and controlled way.
          </Text>

          <Text style={styles.instruction}>
            Try to maintain your exhale for:
          </Text>

          <View style={styles.targetBox}>
            <Text style={styles.targetText}>
              {params.durationRangeSec[0]}–
              {params.durationRangeSec[1]} seconds
            </Text>
          </View>

          <Text style={styles.helperText}>
            Focus on keeping your airflow smooth
            and consistent from beginning to end.
          </Text>
        </View>

        <View style={styles.tipCard}>
          <Ionicons
            name="bulb-outline"
            size={21}
            color={BROWN}
          />

          <Text style={styles.tipText}>
            Breathe comfortably and avoid forcing
            your exhale.
          </Text>
        </View>

        <View style={styles.difficultyRow}>
          <Text style={styles.difficultyLabel}>
            Difficulty
          </Text>

          <Text style={styles.difficultyValue}>
            {tier}
          </Text>
        </View>

        <Pressable
          style={styles.startButton}
          onPress={() => {
            // Screen 2 will be added here later.
          }}
        >
          <Text style={styles.startButtonText}>
            Start Exercise
          </Text>

          <Ionicons
            name="arrow-forward"
            size={18}
            color={WHITE}
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

  content: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 100,
    paddingBottom: 60,
    alignItems: 'center',
  },

  backButton: {
    position: 'absolute',
    top: 55,
    left: 24,
    zIndex: 10,

    width: 40,
    height: 40,

    alignItems: 'center',
    justifyContent: 'center',
  },

  iconCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,

    backgroundColor: PINK,

    alignItems: 'center',
    justifyContent: 'center',

    marginBottom: 20,
  },

  title: {
    fontFamily: 'FredokaBold',
    fontSize: 28,
    color: BROWN,
    textAlign: 'center',
  },

  subtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: MUTED,

    marginTop: 3,
    marginBottom: 24,
  },

  instructionCard: {
    width: '100%',

    backgroundColor: LIGHT_PINK,

    borderRadius: 20,

    padding: 20,

    borderWidth: 1,
    borderColor: '#F2DDE5',
  },

  cardTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 19,
    color: BROWN,

    marginBottom: 14,
  },

  prepareCard: {
  width: '100%',

  backgroundColor: PINK,

  borderRadius: 18,

  padding: 16,

  marginBottom: 14,

  borderWidth: 1,
  borderColor: '#F2DDE5',
},

prepareHeader: {
  flexDirection: 'row',
  alignItems: 'center',

  marginBottom: 12,
},

prepareTitle: {
  fontFamily: 'FredokaBold',
  fontSize: 16,
  color: BROWN,

  marginLeft: 9,
},

prepareItem: {
  flexDirection: 'row',
  alignItems: 'flex-start',

  marginTop: 8,
},

prepareText: {
  flex: 1,

  fontFamily: 'FredokaRegular',
  fontSize: 11,
  lineHeight: 17,
  color: BROWN,

  marginLeft: 9,
},

  instruction: {
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    lineHeight: 20,
    color: BROWN,

    marginBottom: 10,
  },

  targetBox: {
    backgroundColor: PINK,

    borderRadius: 14,

    paddingVertical: 14,
    paddingHorizontal: 10,

    alignItems: 'center',

    marginVertical: 8,
  },

  targetText: {
    fontFamily: 'FredokaBold',
    fontSize: 24,
    color: BROWN,
  },

  helperText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 17,
    color: MUTED,

    textAlign: 'center',

    marginTop: 6,
  },

  tipCard: {
    width: '100%',

    flexDirection: 'row',
    alignItems: 'center',

    backgroundColor: PINK,

    borderRadius: 15,

    padding: 14,

    marginTop: 14,
  },

  tipText: {
    flex: 1,

    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 16,
    color: BROWN,

    marginLeft: 10,
  },

  difficultyRow: {
    width: '100%',

    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',

    marginTop: 18,
    marginBottom: 20,
  },

  difficultyLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
  },

  difficultyValue: {
    fontFamily: 'FredokaBold',
    fontSize: 13,
    color: BROWN,

    textTransform: 'capitalize',
  },

  startButton: {
    width: '100%',
    height: 54,

    borderRadius: 27,

    backgroundColor: BROWN,

    flexDirection: 'row',

    alignItems: 'center',
    justifyContent: 'center',

    gap: 8,
  },

  startButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: WHITE,
  },
});