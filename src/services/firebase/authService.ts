import {
  confirmPasswordReset,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
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

/* =========================================================
   REGISTER USER
========================================================= */

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
    throw new Error(
      'Password must be at least 6 characters.',
    );
  }

  const credential =
    await createUserWithEmailAndPassword(
      auth,
      trimmedEmail,
      password,
    );

  const user = credential.user;

  // Save user's name in Firebase Authentication
  await updateProfile(user, {
    displayName: trimmedName,
  });

  // Save additional information in Firestore
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

/* =========================================================
   LOGIN USER
========================================================= */

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

  const credential =
    await signInWithEmailAndPassword(
      auth,
      trimmedEmail,
      password,
    );

  return credential.user;
}

/* =========================================================
   SEND PASSWORD RESET EMAIL
========================================================= */

export async function sendPasswordReset(
  email: string,
): Promise<void> {
  const trimmedEmail = email.trim().toLowerCase();

  if (!trimmedEmail) {
    throw new Error('Email is required.');
  }

  try {
    await sendPasswordResetEmail(
      auth,
      trimmedEmail,
    );
  } catch (error: any) {
    switch (error?.code) {
      case 'auth/invalid-email':
        throw new Error(
          'Please enter a valid email address.',
        );

      case 'auth/user-not-found':
        throw new Error(
          'No account was found with this email.',
        );

      case 'auth/network-request-failed':
        throw new Error(
          'Network error. Please check your connection.',
        );

      case 'auth/too-many-requests':
        throw new Error(
          'Too many requests. Please try again later.',
        );

      default:
        throw new Error(
          error?.message ||
            'Unable to send password reset email.',
        );
    }
  }
}

/* =========================================================
   SEND PASSWORD RESET CODE
   Alias for compatibility with existing screens.
   
   Firebase sends a secure reset EMAIL/LINK,
   not a random 4/6 digit code.
========================================================= */

export async function sendPasswordResetCode(
  email: string,
): Promise<void> {
  return sendPasswordReset(email);
}

/* =========================================================
   RESET PASSWORD
========================================================= */

export async function resetPassword(
  code: string,
  newPassword: string,
): Promise<void> {
  if (!code) {
    throw new Error(
      'Password reset code is missing.',
    );
  }

  if (!newPassword) {
    throw new Error(
      'New password is required.',
    );
  }

  if (newPassword.length < 6) {
    throw new Error(
      'Password must be at least 6 characters.',
    );
  }

  try {
    await confirmPasswordReset(
      auth,
      code,
      newPassword,
    );
  } catch (error: any) {
    switch (error?.code) {
      case 'auth/expired-action-code':
        throw new Error(
          'This password reset link has expired. Please request a new one.',
        );

      case 'auth/invalid-action-code':
        throw new Error(
          'This password reset link is invalid or has already been used.',
        );

      case 'auth/weak-password':
        throw new Error(
          'The password is too weak. Please choose a stronger password.',
        );

      case 'auth/user-disabled':
        throw new Error(
          'This account has been disabled.',
        );

      case 'auth/user-not-found':
        throw new Error(
          'The account associated with this reset request could not be found.',
        );

      default:
        throw new Error(
          error?.message ||
            'Unable to reset your password.',
        );
    }
  }
}

/* =========================================================
   LOGOUT USER
========================================================= */

export async function logoutUser(): Promise<void> {
  await signOut(auth);
}