// Firebase setup. The only file that imports the SDK; everything else imports from here.
import { firebaseConfig } from './config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js';

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Offline cache shared by all open tabs, so a branch can keep working without internet.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

export {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
  signOut,
} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js';

export {
  doc,
  collection,
  getDoc,
  getDocFromServer,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  getDocsFromServer,
  Timestamp,
  onSnapshot,
  writeBatch,
  runTransaction,
  serverTimestamp,
  arrayUnion,
  arrayRemove,
  increment,
  deleteField,
} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js';
