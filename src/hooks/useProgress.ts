import { useEffect, useState } from 'react';
import { useAuth } from './useAuth';

import type {
    ComponentProgressSummary,
    ExerciseRecord,
} from '@/services/progress/progressModule';

import {
    fetchAllExerciseRecords,
    fetchAllProgress,
} from '@/services/progress/progressRepo';

export function useProgress() {
  const { userId } = useAuth();

  const [summaries, setSummaries] = useState<
    ComponentProgressSummary[]
  >([]);

  const [exerciseRecords, setExerciseRecords] = useState<
    ExerciseRecord[]
  >([]);

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadProgress() {
      if (!userId) {
        setSummaries([]);
        setExerciseRecords([]);
        setLoading(false);
        return;
      }

      setLoading(true);

      try {
        const [summaryData, recordsData] = await Promise.all([
          fetchAllProgress(userId),
          fetchAllExerciseRecords(userId),
        ]);

        if (cancelled) return;

        setSummaries(summaryData);
        setExerciseRecords(recordsData);
      } catch (error) {
        console.error('Failed to load progress:', error);

        if (!cancelled) {
          setSummaries([]);
          setExerciseRecords([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadProgress();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  const totalExercisesCompleted = exerciseRecords.length;

  const practiceDays = new Set(
    exerciseRecords
      .filter((record) => Number.isFinite(record.timestamp))
      .map((record) => {
        const date = new Date(record.timestamp);

        return [
          date.getFullYear(),
          String(date.getMonth() + 1).padStart(2, '0'),
          String(date.getDate()).padStart(2, '0'),
        ].join('-');
      })
  ).size;

  return {
    summaries,
    exerciseRecords,
    totalExercisesCompleted,
    practiceDays,
    loading,
  };
}