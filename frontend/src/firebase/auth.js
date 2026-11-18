import {
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { auth } from './firebaseConfig';

/**
 * Firebase Authentication Helper for Arshith Connect
 */
export const loginWithFirebase = async (email, password) => {
  try {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Firebase auth timeout')), 12000)
    );
    const userCredential = await Promise.race([
      signInWithEmailAndPassword(auth, email.trim(), password),
      timeoutPromise,
    ]);
    const token = await userCredential.user.getIdToken();
    return {
      user: userCredential.user,
      token,
      error: null,
    };
  } catch (err) {
    return {
      user: null,
      token: null,
      error: err,
    };
  }
};

export const logoutWithFirebase = async () => {
  await firebaseSignOut(auth);
};

export const getFirebaseIdToken = async (forceRefresh = false) => {
  if (typeof auth.authStateReady === 'function') {
    try {
      await auth.authStateReady();
    } catch {
      // ignore
    }
  }
  if (auth.currentUser) {
    return await auth.currentUser.getIdToken(forceRefresh);
  }
  return null;
};

export const getCurrentFirebaseUser = async () => {
  if (typeof auth.authStateReady === 'function') {
    try {
      await auth.authStateReady();
    } catch {
      // ignore
    }
  }
  return auth.currentUser || null;
};

export const sendResetPassword = async (email) => {
  await sendPasswordResetEmail(auth, email.trim());
};

export const onAuthStatusChange = (callback) => {
  return onAuthStateChanged(auth, callback);
};
