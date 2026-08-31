import ReactNativeAsyncStorage from '@react-native-async-storage/async-storage';

import { getApp, getApps, initializeApp } from 'firebase/app';

import { initializeAuth } from 'firebase/auth';

import { getFirestore } from 'firebase/firestore';

const getReactNativePersistence =
  require('firebase/auth').getReactNativePersistence;
  
const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId:
    process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

const app =
  getApps().length > 0
    ? getApp()
    : initializeApp(firebaseConfig);

const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(
    ReactNativeAsyncStorage
  ),
});

const db = getFirestore(app);

export { app, auth, db };

