import {
  addDoc,
  collection,
  DocumentData,
  getDocs,
  limit,
  orderBy,
  query,
  QueryDocumentSnapshot,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';

import {
  SINGING_ASSESSMENT_BPM,
  type SingingAssessmentResult,
} from '@/services/assessment/singingAssessment';
import {
  auth,
  db,
} from '@/services/firebase/config';

export type SavedSingingAssessmentResult =
  SingingAssessmentResult & {
    id: string;
    timestamp: number;
  };

export async function saveSingingAssessment(
  result: SingingAssessmentResult,
): Promise<string | null> {
  const user = auth.currentUser;

  if (!user) {
    return null;
  }

  const assessmentDoc = await addDoc(
    collection(db, 'users', user.uid, 'singingAssessments'),
    {
      assessmentType: 'maryHadALittleLamb',
      guideMode: 'beat',
      tempoBpm: SINGING_ASSESSMENT_BPM,
      overallScore: result.overallScore,
      pitchAccuracy: result.pitchAccuracy,
      pitchStability: result.pitchStability,
      vocalConsistency: result.vocalConsistency,
      voicedFrameCount: result.voicedFrameCount,
      detectedNoteCount: result.detectedNoteCount,
      durationSeconds: result.durationSeconds,
      feedback: result.feedback,
      timestamp: serverTimestamp(),
    },
  );

  return assessmentDoc.id;
}

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
  documentSnapshot: QueryDocumentSnapshot<DocumentData>,
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
            typeof item === 'string',
        )
      : [],
    timestamp: toTimestampMillis(data.timestamp),
  };
}

export async function getRecentSingingAssessments(
  count: number = 2,
): Promise<SavedSingingAssessmentResult[]> {
  const user = auth.currentUser;

  if (!user) {
    return [];
  }

  const recentQuery = query(
    collection(db, 'users', user.uid, 'singingAssessments'),
    orderBy('timestamp', 'desc'),
    limit(Math.max(1, Math.floor(count))),
  );

  const snapshot = await getDocs(recentQuery);

  return snapshot.docs.map(toSavedSingingAssessment);
}

export async function getLatestSingingAssessment():
  Promise<SavedSingingAssessmentResult | null> {
  const [latest] = await getRecentSingingAssessments(1);

  return latest ?? null;
}