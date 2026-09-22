// src/services/progress/exerciseProgressService.ts

import { auth } from '@/services/firebase/config';

import type {
  ExerciseRecord,
} from '@/services/progress/progressModule';

import type {
  ComponentId,
} from '@/services/assessment/assessmentModule';

import {
  saveExerciseAndUpdateProgress,
} from '@/services/firebase/progressRepo';

import type {
  Tier,
} from '@/services/adaptiveDifficultyScaling/adaptiveDifficultyScaling';

/* ============================================================
   SAVE COMPLETED EXERCISE
============================================================ */

export async function saveCompletedExercise(
  componentId: ComponentId,
  templateId: string,
  tier: Tier,
  scorePct: number,
): Promise<void> {
  const user =
    auth.currentUser;

  if (!user) {
    console.warn(
      '⚠️ No authenticated user. Exercise result was not saved.'
    );

    return;
  }

  const safeScore =
    Math.max(
      0,
      Math.min(
        100,
        Math.round(scorePct)
      )
    );

  const record: ExerciseRecord =
    {
      componentId,
      templateId,
      tier,
      scorePct:
        safeScore,
      timestamp:
        Date.now(),
    };

  try {
    await saveExerciseAndUpdateProgress(
      user.uid,
      record
    );
  } catch (error) {
    console.error(
      '❌ Failed to save exercise progress:',
      error
    );
  }
}