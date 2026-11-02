// Live listeners and field-by-field saving. A signed-in device always takes the cloud's values.
// Every listener restarts itself after an error: after 5 s, or 20 s when access was refused
// (for example while a new membership is still syncing). restartListeners() restarts all now.
import { db, doc, collection, query, onSnapshot, setDoc, updateDoc, getDocFromServer, serverTimestamp, arrayRemove } from './firebase.js';
import { getLang } from './i18n.js';
import { getDigits } from './format.js';

const RETRY_MS = 5000;
const RETRY_DENIED_MS = 20000;
const active = new Set();
let errorHook = null;

// Called with (error) whenever a listener fails, e.g. to show "Reconnecting…".
export function onListenerError(fn) {
  errorHook = fn;
}

// subscribe(onError) starts one onSnapshot and returns its unsubscribe function.
function resilient(subscribe) {
  const h = { stop: null, timer: null, dead: false };
  h.restart = () => {
    clearTimeout(h.timer);
    h.stop?.();
    h.stop = null;
    if (h.dead) return;
    h.stop = subscribe((err) => {
      h.stop = null;
      errorHook?.(err);
      if (h.dead) return;
      clearTimeout(h.timer);
      h.timer = setTimeout(h.restart, err?.code === 'permission-denied' ? RETRY_DENIED_MS : RETRY_MS);
    });
  };
  active.add(h);
  h.restart();
  return () => {
    h.dead = true;
    clearTimeout(h.timer);
    h.stop?.();
    active.delete(h);
  };
}

export function restartListeners() {
  for (const h of active) h.restart();
}

const denied = (err) => err?.code === 'permission-denied';

// Watches users/{uid}. Creates it only when the server confirms it doesn't exist,
// so a new device never writes its own defaults over the cloud profile.
export function watchProfile(user, onData, onError) {
  const ref = doc(db, 'users', user.uid);
  let creating = false;
  return resilient((fail) => onSnapshot(
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
    (err) => { onError?.(err); fail(err); },
  ));
}

// Saves one preference field only.
export function saveProfileField(uid, field, value) {
  return updateDoc(doc(db, 'users', uid), { [field]: value, updatedAt: serverTimestamp() });
}

// Saves one shop setting only, e.g. saveShopSetting(id, 'markupPct', 30).
export function saveShopSetting(shopId, key, value) {
  return updateDoc(doc(db, 'shops', shopId), { [`settings.${key}`]: value, updatedAt: serverTimestamp() });
}

// Saves one top-level shop field, e.g. its name.
export function saveShopField(shopId, key, value) {
  return updateDoc(doc(db, 'shops', shopId), { [key]: value, updatedAt: serverTimestamp() });
}

// Watches a shop the user belongs to. If the server refuses and the membership is really gone
// (removed, not just disabled), the shop is dropped from the user's list.
export function watchShop(uid, shopId, onData) {
  return resilient((fail) => onSnapshot(
    doc(db, 'shops', shopId),
    (snap) => onData(snap.exists() ? { id: snap.id, ...snap.data() } : null),
    async (err) => {
      fail(err);
      if (!denied(err)) return;
      onData(null);
      try {
        const m = await getDocFromServer(doc(db, 'shops', shopId, 'members', uid));
        if (!m.exists()) await updateDoc(doc(db, 'users', uid), { shopIds: arrayRemove(shopId) });
      } catch {
        // Offline or no access: keep the shop in the list for now.
      }
    },
  ));
}

// Watches one document. Calls onData with { id, ...data }, or false if it's missing or access is refused.
// Other errors keep the last data on screen while the listener retries.
export function watchDoc(path, onData) {
  return resilient((fail) => onSnapshot(
    doc(db, ...path),
    (snap) => onData(snap.exists() ? { id: snap.id, ...snap.data() } : false),
    (err) => { if (denied(err)) onData(false); fail(err); },
  ));
}

// Watches a collection, e.g. watchCollection(['shops', id, 'locations'], set).
// Calls onData with an array of { id, ...data }, or [] if access is refused.
export function watchCollection(path, onData, ...constraints) {
  const ref = collection(db, ...path);
  return resilient((fail) => onSnapshot(
    constraints.length ? query(ref, ...constraints) : ref,
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => { if (denied(err)) onData([]); fail(err); },
  ));
}

export function watchMember(shopId, uid, onData) {
  return resilient((fail) => onSnapshot(
    doc(db, 'shops', shopId, 'members', uid),
    (snap) => onData(snap.exists() ? snap.data() : null),
    (err) => { if (denied(err)) onData(null); fail(err); },
  ));
}
