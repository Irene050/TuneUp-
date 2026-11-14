import { auth } from '@/services/firebase/config';

import type {
  ExerciseRecord,
} from '@/services/progress/progressModule';

import type {
  ComponentId,
} from '@/services/assessment/assessmentModule';

import {
  saveExerciseAndUpdateProgress,
} from '@/services/progress/progressRepo';

import type { Tier } from '@/constants/params';

export function saveCompletedExercise(
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

    return Promise.resolve();
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

  void saveExerciseAndUpdateProgress(user.uid, record).catch(error => {
    console.error(
      '❌ Failed to save exercise progress:',
      error
    );
  });

  return Promise.resolve();
}