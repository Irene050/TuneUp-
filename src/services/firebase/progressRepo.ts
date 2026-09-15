import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
} from 'firebase/firestore';

import { db } from '@/services/firebase/config';

import type {
  ComponentId,
  ComponentProgressSummary,
  ExerciseRecord,
} from '@/services/progress/progressModule';

import {
  summarizeProgress,
} from '@/services/progress/progressModule';

import type {
  Tier,
} from '@/services/adaptiveDifficultyScaling/adaptiveDifficultyScaling';

/* ============================================================
   SAVE COMPONENT SUMMARY
============================================================ */

export async function saveComponentProgress(
  userId: string,
  summary: ComponentProgressSummary,
): Promise<void> {
  await setDoc(
    doc(
      db,
      'users',
      userId,
      'progress',
      summary.componentId,
    ),
    summary,
  );
}

/* ============================================================
   FETCH ALL COMPONENT SUMMARIES
============================================================ */

export async function fetchAllProgress(
  userId: string,
): Promise<ComponentProgressSummary[]> {
  const snapshot = await getDocs(
    collection(
      db,
      'users',
      userId,
      'progress',
    ),
  );

  return snapshot.docs.map(
    (documentSnapshot) =>
      documentSnapshot.data() as ComponentProgressSummary,
  );
}

/* ============================================================
   FETCH ONE COMPONENT SUMMARY
============================================================ */

export async function fetchComponentProgress(
  userId: string,
  componentId: ComponentId,
): Promise<ComponentProgressSummary | null> {
  const snapshot = await getDoc(
    doc(
      db,
      'users',
      userId,
      'progress',
      componentId,
    ),
  );

  if (!snapshot.exists()) {
    return null;
  }

  return snapshot.data() as ComponentProgressSummary;
}

/* ============================================================
   SAVE EXERCISE RECORD
============================================================ */

export async function saveExerciseRecord(
  userId: string,
  record: ExerciseRecord,
): Promise<string> {
  const exercisesRef = collection(
    db,
    'users',
    userId,
    'progress',
    record.componentId,
    'exercises',
  );

  const exerciseDoc = await addDoc(
    exercisesRef,
    record,
  );

  console.log(
    '✅ Exercise record saved:',
    exerciseDoc.id,
    record,
  );

  return exerciseDoc.id;
}

/* ============================================================
   FETCH EXERCISE HISTORY
============================================================ */

export async function fetchExerciseRecords(
  userId: string,
  componentId: ComponentId,
): Promise<ExerciseRecord[]> {
  const exercisesRef = collection(
    db,
    'users',
    userId,
    'progress',
    componentId,
    'exercises',
  );

  const exerciseQuery = query(
    exercisesRef,
    orderBy('timestamp', 'asc'),
  );

  const snapshot = await getDocs(
    exerciseQuery,
  );

  return snapshot.docs.map(
    (documentSnapshot) =>
      documentSnapshot.data() as ExerciseRecord,
  );
}

/* ============================================================
   SAVE EXERCISE + UPDATE COMPONENT SUMMARY
============================================================ */

export async function saveExerciseAndUpdateProgress(
  userId: string,
  record: ExerciseRecord,
): Promise<ComponentProgressSummary> {
  /*
   * 1. Save the individual completed exercise.
   */
  await saveExerciseRecord(
    userId,
    record,
  );

  /*
   * 2. Get the component's existing summary.
   */
  const existingSummary =
    await fetchComponentProgress(
      userId,
      record.componentId,
    );

  /*
   * Keep the tier already stored in Firebase.
   * If no summary exists yet, use the tier from
   * the exercise that was just completed.
   */
  const currentTier: Tier =
    existingSummary?.currentTier ??
    record.tier;

  /*
   * 3. Get all exercise attempts for this
   *    component.
   */
  const records =
    await fetchExerciseRecords(
      userId,
      record.componentId,
    );

  /*
   * 4. Build the current tier map.
   *
   * Only the current component matters here,
   * but summarizeProgress expects all five
   * ComponentId values.
   */
  const currentTiers: Record<
    ComponentId,
    Tier
  > = {
    breathControl: 'beginner',
    pitch: 'beginner',
    tone: 'beginner',
    volume: 'beginner',
    agility: 'beginner',
  };

  currentTiers[
    record.componentId
  ] = currentTier;

  /*
   * 5. Recalculate this component's summary.
   */
  const summaries =
    summarizeProgress(
      records,
      currentTiers,
    );

  const summary =
    summaries.find(
      (item) =>
        item.componentId ===
        record.componentId,
    );

  if (!summary) {
    throw new Error(
      `Unable to create progress summary for ${record.componentId}.`,
    );
  }

  /*
   * 6. Save the updated summary.
   */
  await saveComponentProgress(
    userId,
    summary,
  );

  console.log(
    '✅ Component progress updated:',
    summary,
  );

  return summary;
}