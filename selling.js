// Selling: sales, returns and customer payments. Each is one offline-safe batch: the record,
// its stock movements, the customer's balance and the day's totals for the dashboard.
import { db, doc, collection, writeBatch, serverTimestamp, increment, setDoc, updateDoc } from './firebase.js';
import { commitMoves } from './movements.js';
import { round2 } from './buying.js';

export const SALE_METHODS = ['cash', 'instapay', 'vodafone', 'card'];

// Sale totals. The invoice discount is shared over the lines by value, which is also
// how much each returned piece gives back.
export function saleTotals(lines, discount = 0) {
  const subtotal = round2(lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.price) || 0), 0));
  const d = Math.min(Math.max(Number(discount) || 0, 0), subtotal);
  return { subtotal, discount: round2(d), total: round2(subtotal - d), factor: subtotal ? (subtotal - d) / subtotal : 1 };
}

/**
 * Splits what the customer handed over into what's kept per method, the change to give back
 * (only from cash) and what's left on credit.
 * payments: [{ method, amount }]
 */
export function settle(total, payments) {
  const rows = payments.filter((p) => p.amount > 0).map((p) => ({ method: p.method, amount: round2(p.amount) }));
  const given = round2(rows.reduce((s, p) => s + p.amount, 0));
  let change = given > total ? round2(given - total) : 0;
  const cash = rows.find((p) => p.method === 'cash');
  if (change && (!cash || cash.amount < change)) return { error: 'tooMuchPaid' };
  if (change) cash.amount = round2(cash.amount - change);
  const kept = rows.filter((p) => p.amount > 0);
  const paid = round2(kept.reduce((s, p) => s + p.amount, 0));
  return { payments: kept, paid, change, onCredit: round2(total - paid) };
}

const statsRef = (shopId, locId, date) => doc(db, 'shops', shopId, 'dailyStats', `${locId}_${date}`);

// Adds to the day's totals for one location. All numbers are increments, so devices never overwrite each other.
function addStats(batch, shopId, locId, date, { sales = 0, count = 0, returns = 0, credit = 0, pay = {}, collected = {}, items = [] }) {
  const inc = (n) => increment(round2(n));
  const data = { locationId: locId, date, updatedAt: serverTimestamp() };
  if (sales) data.sales = inc(sales);
  if (count) data.count = increment(count);
  if (returns) data.returns = inc(returns);
  if (credit) data.credit = inc(credit);
  if (Object.keys(pay).length) data.pay = Object.fromEntries(Object.entries(pay).map(([m, a]) => [m, inc(a)]));
  if (Object.keys(collected).length) data.collected = Object.fromEntries(Object.entries(collected).map(([m, a]) => [m, inc(a)]));
  if (items.length) {
    data.items = {};
    for (const i of items) data.items[i.productId] = { q: increment(i.qty), rev: inc(i.rev) };
  }
  batch.set(statsRef(shopId, locId, date), data, { merge: true });
}

const byMethod = (payments, sign = 1) => {
  const out = {};
  for (const p of payments) out[p.method] = (out[p.method] || 0) + sign * p.amount;
  return out;
};

// sale: { number, locationId, date, customerId, lines: [{ productId, qty, price }], subtotal, discount, total,
//         payments, paid, change, onCredit, dueDate, note }
export function recordSale(shopId, sale, uid) {
  const ref = doc(collection(db, 'shops', shopId, 'sales'));
  const moves = sale.lines.map((l) => ({ type: 'sale', productId: l.productId, from: sale.locationId, qty: l.qty, reason: 'sale', ref: ref.id }));
  const { factor } = saleTotals(sale.lines, sale.discount);
  const done = commitMoves(shopId, moves, uid, (batch) => {
    batch.set(ref, { ...sale, by: uid, at: serverTimestamp() });
    if (sale.onCredit > 0 && sale.customerId) {
      batch.set(doc(db, 'shops', shopId, 'customerAccounts', sale.customerId), { balance: increment(sale.onCredit), updatedAt: serverTimestamp() }, { merge: true });
    }
    addStats(batch, shopId, sale.locationId, sale.date, {
      sales: sale.total,
      count: 1,
      credit: sale.onCredit,
      pay: byMethod(sale.payments),
      items: sale.lines.map((l) => ({ productId: l.productId, qty: l.qty, rev: l.qty * l.price * factor })),
    });
  });
  return { id: ref.id, done };
}

// ret: { saleId, saleNumber, locationId, date, customerId, lines: [{ productId, qty, price, unitRefund }], amount,
//        refundMethod ('cash' | … | 'credit' = taken off the customer's balance), note }
export function recordReturn(shopId, ret, uid) {
  const ref = doc(collection(db, 'shops', shopId, 'returns'));
  const moves = ret.lines.map((l) => ({ type: 'return', productId: l.productId, to: ret.locationId, qty: l.qty, reason: 'return', ref: ref.id }));
  const done = commitMoves(shopId, moves, uid, (batch) => {
    batch.set(ref, { ...ret, by: uid, at: serverTimestamp() });
    if (ret.refundMethod === 'credit' && ret.customerId) {
      batch.set(doc(db, 'shops', shopId, 'customerAccounts', ret.customerId), { balance: increment(-ret.amount), updatedAt: serverTimestamp() }, { merge: true });
    }
    addStats(batch, shopId, ret.locationId, ret.date, {
      returns: ret.amount,
      credit: ret.refundMethod === 'credit' ? -ret.amount : 0,
      pay: ret.refundMethod === 'credit' ? {} : { [ret.refundMethod]: -ret.amount },
      items: ret.lines.map((l) => ({ productId: l.productId, qty: -l.qty, rev: -l.qty * l.unitRefund })),
    });
  });
  return { id: ref.id, done };
}

// ---------- Customers ----------

export function saveCustomer(shopId, id, c) {
  const data = { name: c.name, phone: c.phone || '', notes: c.notes || '', active: c.active !== false, updatedAt: serverTimestamp() };
  if (id) return { id, done: updateDoc(doc(db, 'shops', shopId, 'customers', id), data) };
  const ref = doc(collection(db, 'shops', shopId, 'customers'));
  return { id: ref.id, done: setDoc(ref, { ...data, createdAt: serverTimestamp() }) };
}

// kind 'payment': the customer pays off credit at a branch. kind 'charge': opening balance or correction.
export function recordCustomerEntry(shopId, { customerId, kind, amount, method, locationId, date, note }, uid) {
  const batch = writeBatch(db);
  const a = round2(amount);
  batch.set(doc(collection(db, 'shops', shopId, 'customerPayments')), {
    customerId, kind, amount: a, method: kind === 'payment' ? method : null, locationId, date, note: note || '', by: uid, at: serverTimestamp(),
  });
  batch.set(doc(db, 'shops', shopId, 'customerAccounts', customerId), { balance: increment(kind === 'payment' ? -a : a), updatedAt: serverTimestamp() }, { merge: true });
  if (kind === 'payment') addStats(batch, shopId, locationId, date, { collected: { [method]: a } });
  return batch.commit();
}
