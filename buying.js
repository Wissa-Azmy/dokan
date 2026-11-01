// Buying: suppliers, purchase invoices, landed cost, average cost and supplier balances.
// Receiving goods is a batch (works offline). Costing updates the average cost and needs
// internet, because it reads current stock and cost in a transaction.
import {
  db, doc, collection, writeBatch, runTransaction, serverTimestamp, increment, setDoc, updateDoc,
} from './firebase.js';
import { commitMoves, roundQty, totalQty } from './movements.js';

export const PAY_METHODS = ['cash', 'instapay', 'vodafone', 'card', 'bank'];

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const round4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;

// Invoice numbers that stay unique offline: kind-location-device-counter, e.g. P-B1-K7Q-0042.
// The device code and counter live together in this browser, so clearing one clears both.
export function nextNumber(shopId, kind, locCode) {
  let dev = localStorage.getItem('dokan.device');
  if (!dev) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    dev = Array.from(crypto.getRandomValues(new Uint8Array(3)), (b) => chars[b % chars.length]).join('');
    localStorage.setItem('dokan.device', dev);
  }
  const key = `dokan.seq.${shopId}.${kind}`;
  const n = Number(localStorage.getItem(key) || 0) + 1;
  localStorage.setItem(key, String(n));
  return `${kind}-${locCode}-${dev}-${String(n).padStart(4, '0')}`;
}

// Totals and landed unit cost per line. The discount and all extra costs are spread over the
// lines by value; only extras marked onInvoice are owed to the supplier.
export function invoiceTotals({ lines = [], discount = 0, extras = [] }) {
  const values = lines.map((l) => (Number(l.qty) || 0) * (Number(l.unitCost) || 0));
  const subtotal = values.reduce((s, v) => s + v, 0);
  const extrasAll = extras.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const extrasOnInvoice = extras.filter((x) => x.onInvoice).reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const spread = extrasAll - (Number(discount) || 0);
  const landed = lines.map((l, i) => {
    const share = subtotal ? values[i] / subtotal : 0;
    return l.qty ? round4((values[i] + share * spread) / l.qty) : 0;
  });
  return {
    subtotal: round2(subtotal),
    extrasAll: round2(extrasAll),
    total: round2(subtotal - (Number(discount) || 0) + extrasOnInvoice),
    landed,
  };
}

export function paymentStatus(total, paid) {
  if (paid >= total) return 'paid';
  return paid > 0 ? 'partial' : 'credit';
}

// ---------- Suppliers ----------

export function saveSupplier(shopId, id, s) {
  const data = {
    name: s.name,
    phone: s.phone || '',
    whatsapp: s.whatsapp || '',
    address: s.address || '',
    notes: s.notes || '',
    active: s.active !== false,
    updatedAt: serverTimestamp(),
  };
  if (id) return updateDoc(doc(db, 'shops', shopId, 'suppliers', id), data);
  return setDoc(doc(collection(db, 'shops', shopId, 'suppliers')), { ...data, createdAt: serverTimestamp() });
}

// kind 'payment' lowers what we owe; kind 'charge' raises it (opening balance or a correction).
export function recordSupplierEntry(shopId, { supplierId, kind, amount, method, date, note }, uid) {
  const batch = writeBatch(db);
  batch.set(doc(collection(db, 'shops', shopId, 'supplierPayments')), {
    supplierId, kind, amount: round2(amount), method: kind === 'payment' ? method : null, date, note: note || '', by: uid, at: serverTimestamp(),
  });
  batch.set(doc(db, 'shops', shopId, 'supplierAccounts', supplierId), {
    balance: increment(kind === 'payment' ? -round2(amount) : round2(amount)),
    updatedAt: serverTimestamp(),
  }, { merge: true });
  return batch.commit();
}

// ---------- Purchases ----------

// Adds the goods to stock and saves the invoice as 'received'. Works offline.
export function receivePurchase(shopId, purchase, uid) {
  const ref = doc(collection(db, 'shops', shopId, 'purchases'));
  const moves = purchase.lines.map((l) => ({
    type: 'purchase', productId: l.productId, to: purchase.locationId, qty: l.qty, reason: 'purchase', ref: ref.id,
  }));
  const done = commitMoves(shopId, moves, uid, (batch) => {
    batch.set(ref, { ...purchase, status: 'received', createdBy: uid, createdAt: serverTimestamp() });
  });
  return { id: ref.id, done };
}

// Adds prices to a receipt that an employee recorded with quantities only.
export function addPurchaseCosts(shopId, id, costs) {
  return updateDoc(doc(db, 'shops', shopId, 'purchases', id), { ...costs, costsEntered: true, updatedAt: serverTimestamp() });
}

/**
 * Updates the average cost of every product on the invoice, records cost history,
 * adds what we still owe to the supplier's balance and marks the invoice 'costed'.
 * The goods are already in stock, so the quantity before this purchase is (stock now − purchased).
 */
export function applyCosting(shopId, purchaseId, uid) {
  const ref = (...p) => doc(db, 'shops', shopId, ...p);
  return runTransaction(db, async (tx) => {
    const pSnap = await tx.get(ref('purchases', purchaseId));
    const p = pSnap.data();
    if (!p || p.status !== 'received' || !p.costsEntered) return false;

    const { landed } = invoiceTotals(p);
    const byProduct = new Map();
    p.lines.forEach((l, i) => {
      const e = byProduct.get(l.productId) || { qty: 0, value: 0 };
      e.qty = roundQty(e.qty + l.qty);
      e.value += landed[i] * l.qty;
      byProduct.set(l.productId, e);
    });
    const ids = [...byProduct.keys()];
    const costSnaps = await Promise.all(ids.map((id) => tx.get(ref('costs', id))));
    const stockSnaps = await Promise.all(ids.map((id) => tx.get(ref('stock', id))));

    ids.forEach((id, i) => {
      const e = byProduct.get(id);
      const old = costSnaps[i].exists() ? costSnaps[i].data() : null;
      const before = old?.avgCost != null ? Math.max(roundQty(totalQty(stockSnaps[i].data()) - e.qty), 0) : 0;
      const unit = e.qty ? e.value / e.qty : 0;
      const qtyAfter = before + e.qty;
      const avgCost = round4(qtyAfter ? (before * (old?.avgCost || 0) + e.value) / qtyAfter : unit);
      // Same average in dollars, used later to adjust prices when the dollar moves.
      const oldUsd = old?.avgCostUsd ?? (old?.avgCost != null ? old.avgCost / p.usdRate : 0);
      const avgCostUsd = round4(qtyAfter ? (before * oldUsd + e.value / p.usdRate) / qtyAfter : unit / p.usdRate);
      tx.set(ref('costs', id), { avgCost, avgCostUsd, lastCost: round4(unit), lastUsdRate: p.usdRate, updatedAt: serverTimestamp() });
      tx.set(ref('costs', id, 'history', purchaseId), {
        purchaseId, date: p.date, unitCost: round4(unit), usdRate: p.usdRate, avgCost, avgCostUsd, at: serverTimestamp(),
      });
    });

    tx.update(ref('purchases', purchaseId), {
      status: 'costed',
      lines: p.lines.map((l, i) => ({ ...l, landedUnitCost: landed[i] })),
      costedBy: uid,
      costedAt: serverTimestamp(),
    });
    if (p.supplierId) {
      tx.set(ref('supplierAccounts', p.supplierId), { balance: increment(round2(p.total - p.paid)), updatedAt: serverTimestamp() }, { merge: true });
    }
    return true;
  });
}
