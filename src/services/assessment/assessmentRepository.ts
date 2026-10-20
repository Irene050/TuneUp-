
import {
  addDoc,
  collection,
  DocumentData,
  getDocs,
  limit,
  orderBy,
  query,
  QueryDocumentSnapshot,
  Timestamp,
} from 'firebase/firestore';

import {
  auth,
  db,
} from '@/services/firebase/config';

import type {
  AssessmentResult,
} from '@/services/assessment/assessmentModule';

import type {
  SingingAssessmentResult,
} from '@/services/assessment/singingAssessment';

export type SavedAssessmentResult =
  AssessmentResult & {
    id: string;
  };

export type SavedSingingAssessmentResult =
  SingingAssessmentResult & {
    id: string;
    timestamp: number;
  };

export async function saveAssessment(
  result: AssessmentResult
): Promise<string> {
  const user = auth.currentUser;

  if (!user) {
    throw new Error(
      'You must be logged in to save your assessment.'
    );
  }

  const assessmentsRef = collection(
    db,
    'users',
    user.uid,
    'assessments'
  );

  const assessmentDoc = await addDoc(
    assessmentsRef,
    {
      vocalRange: {
        lowHz: result.vocalRange.lowHz,
        highHz: result.vocalRange.highHz,
      },
      vocalRangeLowHz: result.vocalRangeLowHz,
      vocalRangeHighHz: result.vocalRangeHighHz,
      scores: result.scores,
      recommendations: result.recommendations,
      timestamp: result.timestamp,
    }
  );

  console.log(
    'Assessment saved to Firebase:',
    assessmentDoc.id
  );

  return assessmentDoc.id;
}

function toSavedAssessment(
  documentSnapshot: QueryDocumentSnapshot<DocumentData>
): SavedAssessmentResult {
  const data = documentSnapshot.data();

  const lowHz = Number(
    data.vocalRange?.lowHz ?? data.vocalRangeLowHz ?? 0
  );

  const highHz = Number(
    data.vocalRange?.highHz ?? data.vocalRangeHighHz ?? 0
  );

  return {
    id: documentSnapshot.id,
    vocalRange: { lowHz, highHz },
    vocalRangeLowHz: lowHz,
    vocalRangeHighHz: highHz,
    scores: Array.isArray(data.scores) ? data.scores : [],
    recommendations: data.recommendations ?? {},
    timestamp: Number(data.timestamp ?? 0),
  };
}

export async function getRecentAssessments(
  count: number = 2
): Promise<SavedAssessmentResult[]> {
  const user = auth.currentUser;

  if (!user) {
    return [];
  }

  const assessmentsRef = collection(
    db,
    'users',
    user.uid,
    'assessments'
  );

  const recentQuery = query(
    assessmentsRef,
    orderBy('timestamp', 'desc'),
    limit(Math.max(1, Math.floor(count)))
  );

  const snapshot = await getDocs(recentQuery);

  return snapshot.docs.map(toSavedAssessment);
}

export async function getLatestAssessment():
  Promise<SavedAssessmentResult | null> {
  const [latest] = await getRecentAssessments(1);

  return latest ?? null;
}

/**
 * Converts Firestore timestamps and legacy numeric timestamps
 * into milliseconds for display in the progress screen.
 */
function toTimestampMillis(value: unknown): number {
  if (value instanceof Timestamp) {
    return value.toMillis();
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  return 0;
}

function toSavedSingingAssessment(
  documentSnapshot: QueryDocumentSnapshot<DocumentData>
): SavedSingingAssessmentResult {
  const data = documentSnapshot.data();

  const safeNumber = (value: unknown): number => {
    const numberValue = Number(value ?? 0);

    return Number.isFinite(numberValue) ? numberValue : 0;
  };

  return {
    id: documentSnapshot.id,
    overallScore: safeNumber(data.overallScore),
    pitchAccuracy: safeNumber(data.pitchAccuracy),
    pitchStability: safeNumber(data.pitchStability),
    vocalConsistency: safeNumber(data.vocalConsistency),
    voicedFrameCount: safeNumber(data.voicedFrameCount),
    detectedNoteCount: safeNumber(data.detectedNoteCount),
    durationSeconds: safeNumber(data.durationSeconds),
    feedback: Array.isArray(data.feedback)
      ? data.feedback.filter(
          (item: unknown): item is string =>
            typeof item === 'string'
        )
      : [],
    timestamp: toTimestampMillis(data.timestamp),
  };
}

/**
 * Retrieves the most recent singing assessments for the
 * currently signed-in user.
 */
export async function getRecentSingingAssessments(
  count: number = 2
): Promise<SavedSingingAssessmentResult[]> {
  const user = auth.currentUser;

  if (!user) {
    return [];
  }

  const singingAssessmentsRef = collection(
    db,
    'users',
    user.uid,
    'singingAssessments'
  );

  const recentQuery = query(
    singingAssessmentsRef,
    orderBy('timestamp', 'desc'),
    limit(Math.max(1, Math.floor(count)))
  );

  const snapshot = await getDocs(recentQuery);

  return snapshot.docs.map(toSavedSingingAssessment);
}

export async function getLatestSingingAssessment():
  Promise<SavedSingingAssessmentResult | null> {
  const [latest] = await getRecentSingingAssessments(1);

  return latest ?? null;
}