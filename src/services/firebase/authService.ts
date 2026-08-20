import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';

import {
  doc,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';

import { auth, db } from './config';

type RegistrationProfile = {
  birthdate: string;
  gender: string;
};

export async function registerUser(
  name: string,
  email: string,
  password: string,
  profile: RegistrationProfile,
): Promise<User> {
  const trimmedName = name.trim();
  const trimmedEmail = email.trim().toLowerCase();

  if (!trimmedName) {
    throw new Error('Name is required.');
  }

  if (!trimmedEmail) {
    throw new Error('Email is required.');
  }

  if (!password) {
    throw new Error('Password is required.');
  }

  if (password.length < 6) {
    throw new Error('Password must be at least 6 characters.');
  }

  const credential = await createUserWithEmailAndPassword(
    auth,
    trimmedEmail,
    password,
  );

  const user = credential.user;

  // Store the user's name in Firebase Authentication
  await updateProfile(user, {
    displayName: trimmedName,
  });

  // Store the user's additional information in Firestore
  await setDoc(doc(db, 'users', user.uid), {
    uid: user.uid,
    name: trimmedName,
    email: trimmedEmail,
    birthdate: profile.birthdate,
    gender: profile.gender,
    createdAt: serverTimestamp(),
  });

  return user;
}

export async function loginUser(
  email: string,
  password: string,
): Promise<User> {
  const trimmedEmail = email.trim().toLowerCase();

  if (!trimmedEmail) {
    throw new Error('Email is required.');
  }

  if (!password) {
    throw new Error('Password is required.');
  }

  const credential = await signInWithEmailAndPassword(
    auth,
    trimmedEmail,
    password,
  );

  return credential.user;
}

export async function logoutUser(): Promise<void> {
  await signOut(auth);
}