// Writes to Firestore. Multi-document changes go in one batch so they succeed or fail together.
import {
  db, doc, collection, writeBatch, serverTimestamp, arrayUnion,
  setDoc, updateDoc, deleteDoc, getDocFromServer, Timestamp,
} from './firebase.js';

export const DEFAULT_SETTINGS = {
  markupPct: 25,
  roundStep: 5,
  passThroughPct: 100,
  usdRate: null,
  rateMode: 'auto',
  receiptWidth: '80',
  receiptFooter: '',
};

// Creates the shop, makes the user its owner, adds the first branch and links the shop to the user.
// Returns the new shop id straight away; the batch syncs in the background when offline.
export function createShop({ nameAr, nameEn, branchName }, user, profileName) {
  const shopRef = doc(collection(db, 'shops'));
  const locRef = doc(collection(db, 'shops', shopRef.id, 'locations'));
  const batch = writeBatch(db);
  batch.set(shopRef, {
    nameAr,
    nameEn,
    ownerId: user.uid,
    currency: 'EGP',
    settings: DEFAULT_SETTINGS,
    createdAt: serverTimestamp(),
  });
  batch.set(doc(db, 'shops', shopRef.id, 'members', user.uid), {
    uid: user.uid,
    name: profileName || user.displayName || '',
    email: user.email,
    role: 'owner',
    branchIds: [],
    canSeeCosts: true,
    disabled: false,
    joinedAt: serverTimestamp(),
  });
  batch.set(locRef, {
    type: 'branch',
    nameAr: branchName,
    nameEn: branchName,
    code: 'B1',
    active: true,
    createdAt: serverTimestamp(),
  });
  batch.update(doc(db, 'users', user.uid), {
    shopIds: arrayUnion(shopRef.id),
    lastShopId: shopRef.id,
    updatedAt: serverTimestamp(),
  });
  return { id: shopRef.id, done: batch.commit() };
}

// ---------- Locations (branches and warehouses) ----------

export function addLocation(shopId, { type, nameAr, nameEn, code }) {
  const ref = doc(collection(db, 'shops', shopId, 'locations'));
  return { id: ref.id, done: setDoc(ref, { type, nameAr, nameEn, code, active: true, createdAt: serverTimestamp() }) };
}

export function updateLocation(shopId, id, patch) {
  return updateDoc(doc(db, 'shops', shopId, 'locations', id), { ...patch, updatedAt: serverTimestamp() });
}

// Later steps block this when the location has stock or history.
export function deleteLocation(shopId, id) {
  return deleteDoc(doc(db, 'shops', shopId, 'locations', id));
}

// ---------- Invites ----------

const INVITE_DAYS = 7;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I

function randomCode(length = 8) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
}

// Single-use invite. The full invite lives in the shop; inviteCodes/{code} only says which shop.
export async function createInvite(shop, { role, branchIds, canSeeCosts }, uid) {
  const code = randomCode();
  const expiresAt = Timestamp.fromMillis(Date.now() + INVITE_DAYS * 864e5);
  const batch = writeBatch(db);
  batch.set(doc(db, 'shops', shop.id, 'invites', code), {
    code,
    shopId: shop.id,
    shopNameAr: shop.nameAr || '',
    shopNameEn: shop.nameEn || '',
    role,
    branchIds,
    canSeeCosts,
    createdBy: uid,
    createdAt: serverTimestamp(),
    expiresAt,
    usedBy: null,
    usedAt: null,
  });
  batch.set(doc(db, 'inviteCodes', code), { shopId: shop.id, expiresAt });
  await batch.commit();
  return { code, expiresAt };
}

export function cancelInvite(shopId, code) {
  const batch = writeBatch(db);
  batch.delete(doc(db, 'shops', shopId, 'invites', code));
  batch.delete(doc(db, 'inviteCodes', code));
  return batch.commit();
}

export function cleanCode(code) {
  return String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Reads the invite from the server. Returns { invite } or { error: text key }.
export async function lookupInvite(code, uid) {
  const clean = cleanCode(code);
  if (clean.length !== 8) return { error: 'inviteInvalid' };
  const pointer = await getDocFromServer(doc(db, 'inviteCodes', clean));
  if (!pointer.exists()) return { error: 'inviteInvalid' };
  const { shopId } = pointer.data();
  const snap = await getDocFromServer(doc(db, 'shops', shopId, 'invites', clean));
  if (!snap.exists()) return { error: 'inviteInvalid' };
  const invite = snap.data();
  const mine = await getDocFromServer(doc(db, 'shops', shopId, 'members', uid));
  if (mine.exists()) return { error: 'alreadyMember', shopId };
  if (invite.usedBy) return { error: 'inviteUsed' };
  if (invite.expiresAt.toMillis() < Date.now()) return { error: 'inviteExpired' };
  return { invite };
}

// Joins the shop: creates the membership, marks the invite used and adds the shop to the profile.
export function acceptInvite(invite, user, name) {
  const batch = writeBatch(db);
  batch.set(doc(db, 'shops', invite.shopId, 'members', user.uid), {
    uid: user.uid,
    name: name || user.displayName || '',
    email: user.email,
    role: invite.role,
    branchIds: invite.branchIds,
    canSeeCosts: invite.canSeeCosts,
    disabled: false,
    inviteCode: invite.code,
    joinedAt: serverTimestamp(),
  });
  batch.update(doc(db, 'shops', invite.shopId, 'invites', invite.code), { usedBy: user.uid, usedAt: serverTimestamp() });
  batch.update(doc(db, 'users', user.uid), {
    shopIds: arrayUnion(invite.shopId),
    lastShopId: invite.shopId,
    updatedAt: serverTimestamp(),
  });
  return batch.commit();
}

// ---------- Members ----------

export function updateMember(shopId, uid, patch) {
  return updateDoc(doc(db, 'shops', shopId, 'members', uid), { ...patch, updatedAt: serverTimestamp() });
}

export function removeMember(shopId, uid) {
  return deleteDoc(doc(db, 'shops', shopId, 'members', uid));
}
