// Stock changes. Every change is a movement record plus an atomic increment on stock/{productId},
// written in one batch. Increments add up correctly on the server even when two devices
// sell the same product at once, or sync later after being offline.
import {
  db, doc, collection, query, where, orderBy, limit, writeBatch, increment,
  serverTimestamp, Timestamp, getDocsFromServer, updateDoc, setDoc, deleteDoc, deleteField,
} from './firebase.js';

// Firestore allows 500 writes per batch; each product line needs 2 (movement + stock).
const LINES_PER_BATCH = 200;

// Rounds away float noise such as 0.1 + 0.2, keeping 3 decimals for kg and litres.
export const roundQty = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

export function qtyAt(stockDoc, locId) {
  return roundQty(stockDoc?.qty?.[locId] ?? 0);
}

export function totalQty(stockDoc) {
  return roundQty(Object.values(stockDoc?.qty || {}).reduce((s, n) => s + (Number(n) || 0), 0));
}

/**
 * Adds one movement to a batch.
 * move: { type, productId, from?, to?, qty (> 0), reason?, note?, ref? }
 * `from` loses qty, `to` gains it: adjust-in uses `to`, adjust-out uses `from`, a transfer uses both.
 */
export function addMove(batch, shopId, move, uid) {
  const qty = roundQty(move.qty);
  const from = move.from || null;
  const to = move.to || null;
  batch.set(doc(collection(db, 'shops', shopId, 'movements')), {
    type: move.type,
    productId: move.productId,
    from,
    to,
    locations: [from, to].filter(Boolean),
    qty,
    reason: move.reason || null,
    note: move.note || '',
    ref: move.ref || null,
    by: uid,
    at: serverTimestamp(),
    clientAt: Timestamp.now(),
  });
  const change = {};
  if (from) change[from] = increment(-qty);
  if (to) change[to] = increment(qty);
  batch.set(doc(db, 'shops', shopId, 'stock', move.productId), { qty: change, updatedAt: serverTimestamp() }, { merge: true });
}

// Writes many movements in as few batches as possible. extra(batch) runs on the last batch.
// Returns a promise that resolves when all batches are confirmed by the server.
export function commitMoves(shopId, moves, uid, extra) {
  const commits = [];
  for (let i = 0; i < Math.max(moves.length, 1); i += LINES_PER_BATCH) {
    const batch = writeBatch(db);
    moves.slice(i, i + LINES_PER_BATCH).forEach((m) => addMove(batch, shopId, m, uid));
    if (i + LINES_PER_BATCH >= moves.length) extra?.(batch);
    commits.push(batch.commit());
  }
  return Promise.all(commits);
}

// The last movements of one product, newest first. Needs the composite index (see README).
export async function productHistory(shopId, productId, count = 30) {
  const snap = await getDocsFromServer(query(
    collection(db, 'shops', shopId, 'movements'),
    where('productId', '==', productId),
    orderBy('at', 'desc'),
    limit(count),
  ));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// True if any movement mentions this product or location. Needs internet, so nothing
// with history gets deleted based on an incomplete offline copy.
export async function hasHistory(shopId, { productId, locationId }) {
  const ref = collection(db, 'shops', shopId, 'movements');
  const q = productId
    ? query(ref, where('productId', '==', productId), limit(1))
    : query(ref, where('locations', 'array-contains', locationId), limit(1));
  const snap = await getDocsFromServer(q);
  return !snap.empty;
}

// ---------- Stock counts ----------
// stockCounts/{id}: { locationId, status: 'open' | 'done', shelves: { s1: { name, items: { productId: qty } } } }

export function startCount(shopId, locationId, uid) {
  const ref = doc(collection(db, 'shops', shopId, 'stockCounts'));
  const done = setDoc(ref, { locationId, status: 'open', shelves: {}, createdBy: uid, createdAt: serverTimestamp() });
  return { id: ref.id, done };
}

export function saveShelf(shopId, countId, shelfId, shelf, uid) {
  return updateDoc(doc(db, 'shops', shopId, 'stockCounts', countId), {
    [`shelves.${shelfId}`]: { ...shelf, by: uid, at: Timestamp.now() },
    updatedAt: serverTimestamp(),
  });
}

export function removeShelf(shopId, countId, shelfId) {
  return updateDoc(doc(db, 'shops', shopId, 'stockCounts', countId), { [`shelves.${shelfId}`]: deleteField(), updatedAt: serverTimestamp() });
}

export function cancelCount(shopId, countId) {
  return deleteDoc(doc(db, 'shops', shopId, 'stockCounts', countId));
}

// Adds up every shelf: { productId: countedQty }.
export function countTotals(count) {
  const totals = {};
  for (const shelf of Object.values(count?.shelves || {})) {
    for (const [pid, n] of Object.entries(shelf.items || {})) totals[pid] = roundQty((totals[pid] || 0) + n);
  }
  return totals;
}

// Saves the differences as 'count' movements and closes the count.
export function applyCount(shopId, count, differences, uid) {
  const moves = differences.map((d) => ({
    type: 'count',
    productId: d.productId,
    from: d.diff < 0 ? count.locationId : null,
    to: d.diff > 0 ? count.locationId : null,
    qty: Math.abs(d.diff),
    reason: 'count',
    ref: count.id,
  }));
  return commitMoves(shopId, moves, uid, (batch) => {
    batch.update(doc(db, 'shops', shopId, 'stockCounts', count.id), { status: 'done', closedAt: serverTimestamp(), closedBy: uid });
  });
}
