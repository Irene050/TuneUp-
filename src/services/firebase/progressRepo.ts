import { db } from '@/services/firebase/config';
import { ComponentProgressSummary } from '@/services/progress/progressModule';
import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';

export async function saveComponentProgress(
  userId: string,
  summary: ComponentProgressSummary
): Promise<void> {
  await setDoc(doc(db, 'users', userId, 'progress', summary.componentId), summary);
}

export async function fetchAllProgress(userId: string): Promise<ComponentProgressSummary[]> {
  const snapshot = await getDocs(collection(db, 'users', userId, 'progress'));
  return snapshot.docs.map((doc) => doc.data() as ComponentProgressSummary);
}

export async function fetchComponentProgress(
  userId: string,
  componentId: string
): Promise<ComponentProgressSummary | null> {
  const snapshot = await getDoc(doc(db, 'users', userId, 'progress', componentId));
  return snapshot.exists() ? (snapshot.data() as ComponentProgressSummary) : null;
}