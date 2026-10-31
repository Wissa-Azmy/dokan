// Live listeners and field-by-field saving. A signed-in device always takes the cloud's values.
import { db, doc, onSnapshot, setDoc, updateDoc, serverTimestamp, arrayRemove } from './firebase.js';
import { getLang } from './i18n.js';
import { getDigits } from './format.js';

// Watches users/{uid}. Creates it only when the server confirms it doesn't exist,
// so a new device never writes its own defaults over the cloud profile.
export function watchProfile(user, onData, onError) {
  const ref = doc(db, 'users', user.uid);
  let creating = false;
  return onSnapshot(
    ref,
    async (snap) => {
      if (snap.exists()) return onData(snap.data());
      if (snap.metadata.fromCache || creating) return;
      creating = true;
      try {
        await setDoc(ref, {
          name: user.displayName || sessionStorage.getItem('dokan.pendingName') || '',
          email: user.email,
          lang: getLang(),
          digits: getDigits(),
          shopIds: [],
          createdAt: serverTimestamp(),
        });
        sessionStorage.removeItem('dokan.pendingName');
      } catch (err) {
        creating = false;
        onError?.(err);
      }
    },
    onError,
  );
}

// Saves one preference field only.
export function saveProfileField(uid, field, value) {
  return updateDoc(doc(db, 'users', uid), { [field]: value, updatedAt: serverTimestamp() });
}

// Saves one shop setting only, e.g. saveShopSetting(id, 'markupPct', 30).
export function saveShopSetting(shopId, key, value) {
  return updateDoc(doc(db, 'shops', shopId), { [`settings.${key}`]: value, updatedAt: serverTimestamp() });
}

// Watches a shop the user belongs to. If the server refuses (the user was removed),
// the shop is dropped from the user's list.
export function watchShop(uid, shopId, onData) {
  return onSnapshot(
    doc(db, 'shops', shopId),
    (snap) => onData(snap.exists() ? { id: snap.id, ...snap.data() } : null),
    (err) => {
      if (err.code === 'permission-denied') {
        updateDoc(doc(db, 'users', uid), { shopIds: arrayRemove(shopId) }).catch(() => {});
      }
      onData(null);
    },
  );
}

export function watchMember(shopId, uid, onData) {
  return onSnapshot(
    doc(db, 'shops', shopId, 'members', uid),
    (snap) => onData(snap.exists() ? snap.data() : null),
    () => onData(null),
  );
}
