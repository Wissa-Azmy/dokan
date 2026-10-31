// Firebase web app config. Copy the values from:
// Firebase console → Project settings (gear) → General → Your apps → Web app → "SDK setup and configuration" → Config.
// These values are not secrets; access is controlled by firestore.rules.
export const firebaseConfig = {
  apiKey: 'PASTE_API_KEY',
  authDomain: 'PASTE_PROJECT_ID.firebaseapp.com',
  projectId: 'PASTE_PROJECT_ID',
  storageBucket: 'PASTE_PROJECT_ID.firebasestorage.app',
  messagingSenderId: 'PASTE_SENDER_ID',
  appId: 'PASTE_APP_ID',
};

export const isConfigured = !Object.values(firebaseConfig).some((v) => String(v).includes('PASTE_'));
