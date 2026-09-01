import AppHeader from '@/components/appheader';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
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

type Period = 'daily' | 'weekly' | 'monthly';

const components = [
  {
    name: 'Breath Control',
    score: 0,
  },
  {
    name: 'Pitch',
    score: 0,
  },
  {
    name: 'Tone',
    score: 0,
  },
  {
    name: 'Volume',
    score: 0,
  },
  {
    name: 'Agility',
    score: 0,
  },
];

export default function ProgressScreen() {
  const [period, setPeriod] =
    useState<Period>('daily');

  const periodLabel =
    period === 'daily'
      ? 'Today'
      : period === 'weekly'
      ? 'This Week'
      : 'This Month';

  return (
    <View style={styles.screen}>
      <AppHeader />

      {/* BACK BUTTON */}
      <Pressable
        style={styles.backButton}
        onPress={() => router.back()}
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
        {/* TITLE */}
        <Text style={styles.title}>
          My Progress
        </Text>

        <Text style={styles.subtitle}>
          Track your vocal improvement.
        </Text>

        {/* DAILY / WEEKLY / MONTHLY */}
        <View style={styles.periodSelector}>
          <Pressable
            style={[
              styles.periodButton,
              period === 'daily' &&
                styles.periodButtonActive,
            ]}
            onPress={() =>
              setPeriod('daily')
            }
          >
            <Text
              style={[
                styles.periodText,
                period === 'daily' &&
                  styles.periodTextActive,
              ]}
            >
              Daily
            </Text>
          </Pressable>

          <Pressable
            style={[
              styles.periodButton,
              period === 'weekly' &&
                styles.periodButtonActive,
            ]}
            onPress={() =>
              setPeriod('weekly')
            }
          >
            <Text
              style={[
                styles.periodText,
                period === 'weekly' &&
                  styles.periodTextActive,
              ]}
            >
              Weekly
            </Text>
          </Pressable>

          <Pressable
            style={[
              styles.periodButton,
              period === 'monthly' &&
                styles.periodButtonActive,
            ]}
            onPress={() =>
              setPeriod('monthly')
            }
          >
            <Text
              style={[
                styles.periodText,
                period === 'monthly' &&
                  styles.periodTextActive,
              ]}
            >
              Monthly
            </Text>
          </Pressable>
        </View>

        {/* PERIOD SUMMARY */}
        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>
            {periodLabel}
          </Text>

          <View style={styles.summaryRow}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryValue}>
                0
              </Text>

              <Text style={styles.summaryLabel}>
                Exercises
              </Text>
            </View>

            <View style={styles.divider} />

            <View style={styles.summaryItem}>
              <Text style={styles.summaryValue}>
                0%
              </Text>

              <Text style={styles.summaryLabel}>
                Average Score
              </Text>
            </View>
          </View>
        </View>

        {/* VOCAL COMPONENTS */}
        <Text style={styles.sectionTitle}>
          Vocal Components
        </Text>

        {components.map((component) => (
          <View
            key={component.name}
            style={styles.componentCard}
          >
            <View style={styles.componentHeader}>
              <Text style={styles.componentName}>
                {component.name}
              </Text>

              <Text style={styles.componentScore}>
                {component.score}%
              </Text>
            </View>

            <View style={styles.progressBackground}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${component.score}%`,
                  },
                ]}
              />
            </View>
          </View>
        ))}
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
    paddingHorizontal: 24,
    paddingTop: 25,
    paddingBottom: 140,
  },

  // BACK BUTTON

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

  // TITLE

  title: {
    fontFamily: 'FredokaBold',
    fontSize: 30,

    color: BROWN,

    marginTop: 30,
  },

  subtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,

    color: MUTED,

    marginTop: 3,
    marginBottom: 20,
  },

  // PERIOD SELECTOR

  periodSelector: {
    flexDirection: 'row',

    backgroundColor: LIGHT_GRAY,

    borderRadius: 14,

    padding: 4,

    marginBottom: 20,
  },

  periodButton: {
    flex: 1,

    height: 36,

    borderRadius: 11,

    alignItems: 'center',
    justifyContent: 'center',
  },

  periodButtonActive: {
    backgroundColor: PINK,
  },

  periodText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,

    color: MUTED,
  },

  periodTextActive: {
    fontFamily: 'FredokaBold',

    color: BROWN,
  },

  // SUMMARY

  summaryCard: {
    backgroundColor: PINK,

    borderRadius: 20,

    padding: 20,

    marginBottom: 28,
  },

  summaryTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 18,

    color: BROWN,

    marginBottom: 15,
  },

  summaryRow: {
    flexDirection: 'row',

    alignItems: 'center',
  },

  summaryItem: {
    flex: 1,

    alignItems: 'center',
  },

  summaryValue: {
    fontFamily: 'FredokaBold',
    fontSize: 30,

    color: BROWN,
  },

  summaryLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,

    color: MUTED,

    marginTop: 2,
  },

  divider: {
    width: 1,
    height: 42,

    backgroundColor: '#E8C7D0',
  },

  // COMPONENTS

  sectionTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 22,

    color: BROWN,

    marginBottom: 14,
  },

  componentCard: {
    backgroundColor: LIGHT_PINK,

    borderRadius: 16,

    padding: 16,

    marginBottom: 12,

    borderWidth: 1,
    borderColor: '#F2DDE5',
  },

  componentHeader: {
    flexDirection: 'row',

    justifyContent: 'space-between',

    alignItems: 'center',

    marginBottom: 8,
  },

  componentName: {
    fontFamily: 'FredokaBold',
    fontSize: 15,

    color: BROWN,
  },

  componentScore: {
    fontFamily: 'FredokaBold',
    fontSize: 14,

    color: BROWN,
  },

  progressBackground: {
    height: 9,

    width: '100%',

    backgroundColor: WHITE,

    borderRadius: 10,

    overflow: 'hidden',
  },

  progressFill: {
    height: '100%',

    backgroundColor: BROWN,

    borderRadius: 10,
  },
});