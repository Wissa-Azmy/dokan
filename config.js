// Firebase web app config. Copy the values from:
// Firebase console → Project settings (gear) → General → Your apps → Web app → "SDK setup and configuration" → Config.
// These values are not secrets; access is controlled by firestore.rules.
export const firebaseConfig = {
  apiKey: 'AIzaSyBwzTUJA3AZJVtohtMZXLDZn78lZBQfBRI',
  authDomain: 'dokan-eg.firebaseapp.com',
  projectId: 'dokan-eg',
  storageBucket: 'dokan-eg.firebasestorage.app',
  messagingSenderId: '1057321387868',
  appId: '1:1057321387868:web:9b9c9464f669dbe6ad2399',
};

export const isConfigured = !Object.values(firebaseConfig).some((v) => String(v).includes('PASTE_'));
