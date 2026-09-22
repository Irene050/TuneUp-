import {
  addDoc,
  collection,
  getDocs,
  limit,
  orderBy,
  query,
} from 'firebase/firestore';

import {
  auth,
  db,
} from '@/services/firebase/config';

import type {
  AssessmentResult,
  AssessmentType,
} from '@/services/assessment/assessmentModule';


// ============================================================
// TYPES
// ============================================================

export type SavedAssessmentResult =
  AssessmentResult & {
    id: string;
    assessmentType?: AssessmentType;
  };


// ============================================================
// HELPERS
// ============================================================

function parseAssessmentType(
  value: unknown
): AssessmentType | undefined {
  if (value === 'initial') {
    return 'initial';
  }

  if (value === 'followUp') {
    return 'followUp';
  }

  return undefined;
}


// ============================================================
// SAVE ASSESSMENT
// ============================================================

export async function saveAssessment(
  result: AssessmentResult,
  assessmentType: AssessmentType
): Promise<string> {
  const user =
    auth.currentUser;

  if (!user) {
    throw new Error(
      'You must be logged in to save your assessment.'
    );
  }

  const assessmentsRef =
    collection(
      db,
      'users',
      user.uid,
      'assessments'
    );

  const assessmentDoc =
    await addDoc(
      assessmentsRef,
      {
        assessmentType,

        vocalRange: {
          lowHz:
            result.vocalRange.lowHz,

          highHz:
            result.vocalRange.highHz,
        },

        vocalRangeLowHz:
          result.vocalRangeLowHz,

        vocalRangeHighHz:
          result.vocalRangeHighHz,

        scores:
          result.scores,

        recommendations:
          result.recommendations,

        timestamp:
          result.timestamp,
      }
    );

  console.log(
    'Assessment saved to Firebase:',
    {
      id: assessmentDoc.id,
      assessmentType,
    }
  );

  return assessmentDoc.id;
}


// ============================================================
// GET LATEST ASSESSMENT
// ============================================================

export async function getLatestAssessment():
  Promise<SavedAssessmentResult | null> {

  const user =
    auth.currentUser;

  if (!user) {
    return null;
  }

  const assessmentsRef =
    collection(
      db,
      'users',
      user.uid,
      'assessments'
    );

  const latestQuery =
    query(
      assessmentsRef,
      orderBy(
        'timestamp',
        'desc'
      ),
      limit(1)
    );

  const snapshot =
    await getDocs(
      latestQuery
    );

  if (
    snapshot.empty
  ) {
    return null;
  }

  const documentSnapshot =
    snapshot.docs[0];

  const data =
    documentSnapshot.data();

  const lowHz =
    Number(
      data.vocalRange?.lowHz ??
      data.vocalRangeLowHz ??
      0
    );

  const highHz =
    Number(
      data.vocalRange?.highHz ??
      data.vocalRangeHighHz ??
      0
    );

  return {
    id:
      documentSnapshot.id,

    assessmentType:
      parseAssessmentType(
        data.assessmentType
      ),

    vocalRange: {
      lowHz,
      highHz,
    },

    vocalRangeLowHz:
      lowHz,

    vocalRangeHighHz:
      highHz,

    scores:
      Array.isArray(
        data.scores
      )
        ? data.scores
        : [],

    recommendations:
      data.recommendations ??
      {},

    timestamp:
      Number(
        data.timestamp ??
        0
      ),
  };
}


// ============================================================
// GET LATEST ASSESSMENT BY TYPE
// ============================================================

export async function getAssessmentByType(
  assessmentType: AssessmentType
): Promise<SavedAssessmentResult | null> {

  const user =
    auth.currentUser;

  if (!user) {
    return null;
  }

  const assessmentsRef =
    collection(
      db,
      'users',
      user.uid,
      'assessments'
    );

  const assessmentQuery =
    query(
      assessmentsRef,
      orderBy(
        'timestamp',
        'desc'
      )
    );

  const snapshot =
    await getDocs(
      assessmentQuery
    );

  for (
    const documentSnapshot
    of snapshot.docs
  ) {
    const data =
      documentSnapshot.data();

    const storedType =
      parseAssessmentType(
        data.assessmentType
      );

    if (
      storedType !==
      assessmentType
    ) {
      continue;
    }

    const lowHz =
      Number(
        data.vocalRange?.lowHz ??
        data.vocalRangeLowHz ??
        0
      );

    const highHz =
      Number(
        data.vocalRange?.highHz ??
        data.vocalRangeHighHz ??
        0
      );

    return {
      id:
        documentSnapshot.id,

      assessmentType:
        storedType,

      vocalRange: {
        lowHz,
        highHz,
      },

      vocalRangeLowHz:
        lowHz,

      vocalRangeHighHz:
        highHz,

      scores:
        Array.isArray(
          data.scores
        )
          ? data.scores
          : [],

      recommendations:
        data.recommendations ??
        {},

      timestamp:
        Number(
          data.timestamp ??
          0
        ),
    };
  }

  return null;
}