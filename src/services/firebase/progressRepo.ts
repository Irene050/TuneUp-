// src/services/firebase/progressRepo.ts

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

import {
  db,
} from '@/services/firebase/config';

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
  summary: ComponentProgressSummary
): Promise<void> {
  await setDoc(
    doc(
      db,
      'users',
      userId,
      'progress',
      summary.componentId
    ),
    summary
  );
}

/* ============================================================
   FETCH ALL COMPONENT SUMMARIES
============================================================ */

export async function fetchAllProgress(
  userId: string
): Promise<ComponentProgressSummary[]> {
  const snapshot =
    await getDocs(
      collection(
        db,
        'users',
        userId,
        'progress'
      )
    );

  return snapshot.docs.map(
    (documentSnapshot) =>
      documentSnapshot.data() as ComponentProgressSummary
  );
}

/* ============================================================
   FETCH ONE COMPONENT SUMMARY
============================================================ */

export async function fetchComponentProgress(
  userId: string,
  componentId: ComponentId
): Promise<ComponentProgressSummary | null> {
  const snapshot =
    await getDoc(
      doc(
        db,
        'users',
        userId,
        'progress',
        componentId
      )
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
  record: ExerciseRecord
): Promise<string> {
  const exercisesRef =
    collection(
      db,
      'users',
      userId,
      'progress',
      record.componentId,
      'exercises'
    );

  const exerciseDoc =
    await addDoc(
      exercisesRef,
      record
    );

  console.log(
    '✅ Exercise record saved:',
    exerciseDoc.id,
    record
  );

  return exerciseDoc.id;
}

/* ============================================================
   FETCH EXERCISE HISTORY
============================================================ */

export async function fetchExerciseRecords(
  userId: string,
  componentId: ComponentId
): Promise<ExerciseRecord[]> {
  const exercisesRef =
    collection(
      db,
      'users',
      userId,
      'progress',
      componentId,
      'exercises'
    );

  const exerciseQuery =
    query(
      exercisesRef,
      orderBy(
        'timestamp',
        'asc'
      )
    );

  const snapshot =
    await getDocs(
      exerciseQuery
    );

  return snapshot.docs.map(
    (documentSnapshot) =>
      documentSnapshot.data() as ExerciseRecord
  );
}

/* ============================================================
   SAVE EXERCISE + UPDATE COMPONENT SUMMARY
============================================================ */

export async function saveExerciseAndUpdateProgress(
  userId: string,
  record: ExerciseRecord
): Promise<ComponentProgressSummary> {
  await saveExerciseRecord(
    userId,
    record
  );

  const existingSummary =
    await fetchComponentProgress(
      userId,
      record.componentId
    );

  const currentTier: Tier =
    existingSummary?.currentTier ??
    record.tier;

  const records =
    await fetchExerciseRecords(
      userId,
      record.componentId
    );

  const currentTiers: Record<
    ComponentId,
    Tier
  > = {
    breathControl:
      'beginner',
    pitch:
      'beginner',
    tone:
      'beginner',
    volume:
      'beginner',
    agility:
      'beginner',
  };

  currentTiers[
    record.componentId
  ] = currentTier;

  const summaries =
    summarizeProgress(
      records,
      currentTiers
    );

  const summary =
    summaries.find(
      (item) =>
        item.componentId ===
        record.componentId
    );

  if (!summary) {
    throw new Error(
      `Unable to create progress summary for ${record.componentId}.`
    );
  }

  await saveComponentProgress(
    userId,
    summary
  );

  console.log(
    '✅ Component progress updated:',
    summary
  );

  return summary;
}