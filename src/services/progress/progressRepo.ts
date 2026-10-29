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

import type { Tier } from '@/constants/params';

import {
  checkTierProgression,
} from '@/services/adaptiveDifficultyScaling/adaptiveDifficultyScaling';

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

export async function fetchAllExerciseRecords(
  userId: string
): Promise<ExerciseRecord[]> {
  const componentIds: ComponentId[] = [
    'breathControl',
    'pitch',
    'tone',
    'volume',
    'agility',
  ];

  const recordsByComponent = await Promise.all(
    componentIds.map((componentId) =>
      fetchExerciseRecords(userId, componentId)
    )
  );

  return recordsByComponent
    .flat()
    .sort((a, b) => a.timestamp - b.timestamp);
}

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

  let currentTier: Tier =
    existingSummary?.currentTier ??
    record.tier;

  const records =
    await fetchExerciseRecords(
      userId,
      record.componentId
    );

  const currentTierRecords =
    records.filter(
      exercise =>
        exercise.tier === currentTier
    );

  const progressionHistory =
    currentTierRecords.map(
      exercise => ({
        templateId:
          exercise.templateId,
        scorePct:
          exercise.scorePct,
      })
    );

  const progression =
    checkTierProgression(
      currentTier,
      progressionHistory
    );

  if (
    progression.canUnlock &&
    progression.nextTier
  ) {
    console.log(
      `🎉 ${record.componentId} unlocked ${progression.nextTier} tier.`
    );

    currentTier =
      progression.nextTier;
  } else {
    console.log(
      `📈 ${record.componentId} remains at ${currentTier} tier.`
    );
  }

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