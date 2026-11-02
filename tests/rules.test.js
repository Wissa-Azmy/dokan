// Firestore security rules tests. They run against the local emulator, never the live project.
//
// One-time setup on your Mac (needs Node.js 20+ and Java 11+):
//   cd dokan && npm install
// Run:
//   npm test
// which starts the Firestore emulator, runs this file, and stops the emulator.
import { readFileSync } from 'node:fs';
import { test, before, after, beforeEach } from 'node:test';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where, writeBatch, serverTimestamp, increment, Timestamp } from 'firebase/firestore';

const SHOP = 'shop1';
const B1 = 'branch1';
const B2 = 'branch2';
let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'dokan-rules-test',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
  });
});
after(() => env.cleanup());

// A shop with an owner, a manager limited to Branch 1 without cost access, a manager with costs,
// an employee at Branch 1, a disabled employee, and one sale at each branch.
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const m = (uid, role, branchIds = [], extra = {}) => setDoc(doc(db, 'shops', SHOP, 'members', uid), {
      uid, role, branchIds, canSeeCosts: role === 'owner', disabled: false, ...extra,
    });
    await setDoc(doc(db, 'shops', SHOP), { nameAr: 'محل', nameEn: 'Shop', ownerId: 'owner', settings: { markupPct: 25 } });
    await m('owner', 'owner');
    await m('mgr', 'manager', [B1]);
    await m('mgrCosts', 'manager', [], { canSeeCosts: true });
    await m('emp', 'employee', [B1]);
    await m('off', 'employee', [B1], { disabled: true });
    await setDoc(doc(db, 'shops', SHOP, 'locations', B1), { type: 'branch', nameAr: 'فرع ١', nameEn: 'B1', code: 'B1', active: true });
    await setDoc(doc(db, 'shops', SHOP, 'locations', B2), { type: 'branch', nameAr: 'فرع ٢', nameEn: 'B2', code: 'B2', active: true });
    await setDoc(doc(db, 'shops', SHOP, 'products', 'p1'), { nameAr: 'منتج', nameEn: 'P', unit: 'piece', price: 10, lowStock: {}, active: true });
    await setDoc(doc(db, 'shops', SHOP, 'costs', 'p1'), { avgCost: 6, avgCostUsd: 0.12 });
    await setDoc(doc(db, 'shops', SHOP, 'sales', 's1'), { locationId: B1, date: '2026-11-01', total: 10, lines: [{}], onCredit: 0 });
    await setDoc(doc(db, 'shops', SHOP, 'sales', 's2'), { locationId: B2, date: '2026-11-01', total: 10, lines: [{}], onCredit: 0 });
    await setDoc(doc(db, 'shops', SHOP, 'movements', 'm1'), { type: 'adjust', productId: 'p1', locations: [B1], qty: 1 });
  });
});

const as = (uid) => env.authenticatedContext(uid).firestore();
const sale = (uid, locationId, extra = {}) => ({
  locationId, date: '2026-11-02', by: uid, at: serverTimestamp(), lines: [{ productId: 'p1', qty: 1, price: 10 }], total: 10, onCredit: 0, ...extra,
});
const move = (uid, type, loc) => ({ type, productId: 'p1', from: loc, to: null, locations: [loc], qty: 1, by: uid, at: serverTimestamp() });

test('strangers and disabled members see nothing', async () => {
  await assertFails(getDoc(doc(as('stranger'), 'shops', SHOP)));
  await assertFails(getDoc(doc(as('off'), 'shops', SHOP, 'products', 'p1')));
  await assertSucceeds(getDoc(doc(as('off'), 'shops', SHOP, 'members', 'off'))); // own membership stays readable
});

test('costs are hidden from employees and managers without cost access', async () => {
  await assertFails(getDoc(doc(as('emp'), 'shops', SHOP, 'costs', 'p1')));
  await assertFails(getDoc(doc(as('mgr'), 'shops', SHOP, 'costs', 'p1')));
  await assertSucceeds(getDoc(doc(as('mgrCosts'), 'shops', SHOP, 'costs', 'p1')));
  await assertSucceeds(getDoc(doc(as('owner'), 'shops', SHOP, 'costs', 'p1')));
});

test('employees sell only at their own branch', async () => {
  const db = as('emp');
  await assertSucceeds(setDoc(doc(db, 'shops', SHOP, 'sales', 'new1'), sale('emp', B1)));
  await assertFails(setDoc(doc(db, 'shops', SHOP, 'sales', 'new2'), sale('emp', B2)));
  await assertFails(setDoc(doc(db, 'shops', SHOP, 'sales', 'new3'), sale('someoneElse', B1)));
});

test('credit sales need a customer', async () => {
  await assertFails(setDoc(doc(as('emp'), 'shops', SHOP, 'sales', 'c1'), sale('emp', B1, { onCredit: 5 })));
  await assertSucceeds(setDoc(doc(as('emp'), 'shops', SHOP, 'sales', 'c2'), sale('emp', B1, { onCredit: 5, customerId: 'cust1' })));
});

test('sales and movements can never be edited or deleted', async () => {
  await assertFails(updateDoc(doc(as('owner'), 'shops', SHOP, 'sales', 's1'), { total: 1 }));
  await assertFails(deleteDoc(doc(as('owner'), 'shops', SHOP, 'sales', 's1')));
  await assertFails(deleteDoc(doc(as('owner'), 'shops', SHOP, 'movements', 'm1')));
});

test('a limited member only reads sales of their locations', async () => {
  await assertSucceeds(getDoc(doc(as('emp'), 'shops', SHOP, 'sales', 's1')));
  await assertFails(getDoc(doc(as('emp'), 'shops', SHOP, 'sales', 's2')));
  await assertSucceeds(getDocs(query(collection(as('emp'), 'shops', SHOP, 'sales'), where('locationId', '==', B1))));
  await assertFails(getDocs(collection(as('emp'), 'shops', SHOP, 'sales')));
});

test('employees sell and return, but cannot adjust stock', async () => {
  const db = as('emp');
  const ok = writeBatch(db);
  ok.set(doc(collection(db, 'shops', SHOP, 'movements')), move('emp', 'sale', B1));
  ok.set(doc(db, 'shops', SHOP, 'stock', 'p1'), { qty: { [B1]: increment(-1) }, updatedAt: serverTimestamp() }, { merge: true });
  await assertSucceeds(ok.commit());

  const bad = writeBatch(db);
  bad.set(doc(collection(db, 'shops', SHOP, 'movements')), move('emp', 'adjust', B1));
  await assertFails(bad.commit());

  const otherBranch = writeBatch(db);
  otherBranch.set(doc(db, 'shops', SHOP, 'stock', 'p1'), { qty: { [B2]: increment(-1) }, updatedAt: serverTimestamp() }, { merge: true });
  await assertFails(otherBranch.commit());
});

test('a manager limited to Branch 1 cannot touch Branch 2 stock', async () => {
  const db = as('mgr');
  await assertSucceeds(setDoc(doc(collection(db, 'shops', SHOP, 'movements')), move('mgr', 'adjust', B1)));
  await assertFails(setDoc(doc(collection(db, 'shops', SHOP, 'movements')), move('mgr', 'adjust', B2)));
});

test('only the owner changes roles, and never their own', async () => {
  await assertSucceeds(updateDoc(doc(as('owner'), 'shops', SHOP, 'members', 'emp'), { role: 'manager', branchIds: [] }));
  await assertFails(updateDoc(doc(as('mgr'), 'shops', SHOP, 'members', 'emp'), { disabled: true }));
  await assertFails(updateDoc(doc(as('owner'), 'shops', SHOP, 'members', 'owner'), { role: 'manager' }));
  await assertFails(updateDoc(doc(as('owner'), 'shops', SHOP, 'members', 'emp'), { role: 'owner' }));
});

test('managers may only save the USD rate into the shop settings', async () => {
  await assertSucceeds(updateDoc(doc(as('mgr'), 'shops', SHOP), { 'settings.usdRate': 50, 'settings.rateDate': '2026-11-02', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(as('mgr'), 'shops', SHOP), { 'settings.markupPct': 90 }));
  await assertFails(updateDoc(doc(as('mgr'), 'shops', SHOP), { nameAr: 'غيره' }));
  await assertSucceeds(updateDoc(doc(as('owner'), 'shops', SHOP), { 'settings.markupPct': 30 }));
});

test('the restore window lets only the owner rewrite history', async () => {
  await assertFails(deleteDoc(doc(as('owner'), 'shops', SHOP, 'sales', 's1')));
  await updateDoc(doc(as('owner'), 'shops', SHOP), { restoreUntil: Timestamp.fromMillis(Date.now() + 600000) });
  await assertSucceeds(deleteDoc(doc(as('owner'), 'shops', SHOP, 'sales', 's1')));
  await assertFails(deleteDoc(doc(as('mgrCosts'), 'shops', SHOP, 'sales', 's2')));
});

test('cloud backups are owner-only', async () => {
  await assertSucceeds(setDoc(doc(as('owner'), 'shops', SHOP, 'backups', 'b1'), { complete: true }));
  await assertFails(getDoc(doc(as('mgrCosts'), 'shops', SHOP, 'backups', 'b1')));
});

test('a closed cash day can only be reopened by a manager', async () => {
  const id = `${B1}_2026-11-02`;
  await assertSucceeds(setDoc(doc(as('emp'), 'shops', SHOP, 'cashDays', id), { locationId: B1, date: '2026-11-02', opening: 100, closedAt: null }));
  await assertSucceeds(updateDoc(doc(as('emp'), 'shops', SHOP, 'cashDays', id), { closing: 150, closedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(as('emp'), 'shops', SHOP, 'cashDays', id), { closedAt: null }));
  await assertSucceeds(updateDoc(doc(as('mgr'), 'shops', SHOP, 'cashDays', id), { closedAt: null }));
});
