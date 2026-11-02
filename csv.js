// CSV export. Files start with a byte-order mark so Excel shows Arabic correctly; numbers use
// Western digits and a dot so spreadsheets read them as numbers.
import { t, localName } from './i18n.js';
import { el } from './forms.js';
import { db, collection, query, where, getDocsFromServer } from './firebase.js';
import { categoryPath } from './categories.js';
import { qtyAt, totalQty } from './movements.js';

const cell = (v) => {
  const s = v == null ? '' : typeof v === 'number' ? String(Math.round(v * 10000) / 10000) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(rows) {
  return "\uFEFF" + rows.map((r) => r.map(cell).join(',')).join('\r\n');
}

export function download(filename, text, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// Reads every document matching the filters from the server (exports need internet).
async function readAll(shopId, name, filters) {
  const snap = await getDocsFromServer(query(collection(db, 'shops', shopId, name), ...filters));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

const rangeFilters = (from, to, locId) => [
  ...(locId ? [where('locationId', '==', locId)] : []),
  where('date', '>=', from),
  where('date', '<=', to),
];

// One row per sold line.
export async function salesCsv(shopId, { from, to, locId, products, locations, customers }) {
  const sales = await readAll(shopId, 'sales', rangeFilters(from, to, locId));
  const name = (list, id) => localName((list || []).find((x) => x.id === id)) || (list || []).find((x) => x.id === id)?.name || '';
  const rows = [[t('date'), t('sale'), t('branch'), t('customer'), t('products'), t('qty'), t('price'), t('lineTotal'), t('total'), t('discount'), t('paidNow'), t('pay_credit'), t('method')]];
  for (const s of sales.sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
    const methods = s.payments.map((p) => `${t(`pay_${p.method}`)} ${p.amount}`).join(' + ');
    for (const l of s.lines) {
      rows.push([s.date, s.number, name(locations, s.locationId), name(customers, s.customerId), name(products, l.productId), l.qty, l.price, l.qty * l.price, s.total, s.discount, s.paid, s.onCredit, methods]);
    }
  }
  return toCsv(rows);
}

export async function expensesCsv(shopId, { from, to, locId, locations }) {
  const list = await readAll(shopId, 'expenses', rangeFilters(from, to, locId));
  const rows = [[t('date'), t('location'), t('expenseType'), t('amount'), t('method'), t('note')]];
  for (const e of list.sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
    rows.push([e.date, localName((locations || []).find((l) => l.id === e.locationId)), t(`exp_${e.type}`), e.amount, t(`pay_${e.method}`), e.note]);
  }
  return toCsv(rows);
}

export async function purchasesCsv(shopId, { from, to, products, locations, suppliers }) {
  const list = await readAll(shopId, 'purchases', [where('date', '>=', from), where('date', '<=', to)]);
  const rows = [[t('date'), t('purchase'), t('supplier'), t('receivingLocation'), t('products'), t('qty'), t('unitCost'), t('landedCostShort'), t('total'), t('paid'), t('usdRate')]];
  for (const p of list.filter((x) => x.status === 'costed').sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
    for (const l of p.lines) {
      rows.push([
        p.date, p.number, (suppliers || []).find((s) => s.id === p.supplierId)?.name || '',
        localName((locations || []).find((x) => x.id === p.locationId)),
        localName((products || []).find((x) => x.id === l.productId)),
        l.qty, l.unitCost, l.landedUnitCost, p.total, p.paid, p.usdRate,
      ]);
    }
  }
  return toCsv(rows);
}

// Products with stock per location, and average cost when allowed.
export function productsCsv({ products, categories, locations, stock, costs }) {
  const stockOf = new Map((stock || []).map((s) => [s.id, s]));
  const costOf = new Map((costs || []).map((c) => [c.id, c]));
  const locs = locations || [];
  const rows = [[
    t('nameAr'), t('nameEn'), t('category'), t('brand'), t('barcode'), t('sku'), t('unit'), t('price'),
    ...(costs ? [t('avgCost')] : []), ...locs.map((l) => localName(l)), t('totalQty'),
  ]];
  for (const p of products || []) {
    const s = stockOf.get(p.id);
    rows.push([
      p.nameAr, p.nameEn, categoryPath(categories, p.categoryId), p.brand, p.barcode, p.sku, t(`unit_${p.unit}`), p.price,
      ...(costs ? [costOf.get(p.id)?.avgCost ?? ''] : []), ...locs.map((l) => qtyAt(s, l.id)), totalQty(s),
    ]);
  }
  return toCsv(rows);
}

export function customersCsv({ customers, accounts }) {
  const bal = (id) => (accounts || []).find((a) => a.id === id)?.balance || 0;
  return toCsv([[t('customerName'), t('phone'), t('customerOwes')], ...(customers || []).map((c) => [c.name, c.phone, bal(c.id)])]);
}
