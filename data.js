// Writes to Firestore. Multi-document changes go in one batch so they succeed or fail together.
import { db, doc, collection, writeBatch, serverTimestamp, arrayUnion } from './firebase.js';

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
