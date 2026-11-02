// Cash drawer per branch per day: open with the cash in the drawer, see what should be there,
// and close with the counted cash. cashDays/{locationId}_{date}.
import { t, localName, errorText } from './i18n.js';
import { fmtMoney, fmtDate, parseNum } from './format.js';
import { el, icon, numberField, textField, setFieldError, confirmAction, toast } from './forms.js';
import { db, doc, setDoc, updateDoc, serverTimestamp, deleteField, getDocsFromServer, query, collection, where, orderBy, limit } from './firebase.js';
import { watchDoc } from './sync.js';
import { isManager } from './roles.js';
import { header } from './screens.js';
import { useLocations } from './locations.js';
import { myLocations } from './stock.js';
import { today } from './suppliers.js';
import { round2 } from './buying.js';

const filters = { loc: null, date: null };
const cashDayId = (loc, date) => `${loc}_${date}`;
// Typed amounts survive live redraws (new sales keep arriving while you count the drawer).
const draft = new Map();
const lastClosingCache = new Map();
const keep = (field, key) => {
  const input = field.querySelector('input');
  if (draft.has(key)) input.value = draft.get(key);
  input.addEventListener('input', () => draft.set(key, input.value));
  return field;
};

// Cash that should be in the drawer: opening + cash kept from sales (refunds included)
// + cash collected from customers − cash paid out for expenses.
export function expectedCash(day, stats) {
  const s = stats || {};
  return round2((day?.opening || 0) + (s.pay?.cash || 0) + (s.collected?.cash || 0) - (s.paidOut?.cash || 0));
}

async function lastClosing(shopId, locId) {
  if (lastClosingCache.has(locId)) return lastClosingCache.get(locId);
  try {
    const snap = await getDocsFromServer(query(collection(db, 'shops', shopId, 'cashDays'), where('locationId', '==', locId), orderBy('date', 'desc'), limit(1)));
    const n = snap.docs[0]?.data()?.closing ?? null;
    lastClosingCache.set(locId, n);
    return n;
  } catch {
    return null;
  }
}

export function renderCash(root, ctx, shopId) {
  const me = ctx.members.get(shopId);
  const branches = myLocations(me, useLocations(ctx, shopId)).filter((l) => l.type === 'branch');
  if (!branches.some((l) => l.id === filters.loc)) filters.loc = branches[0]?.id || null;
  filters.date ||= today();
  const back = `#/shop/${shopId}`;
  if (!filters.loc) {
    root.replaceChildren(header(t('cashDay'), { back }), el('main', { class: 'page' }, el('p', { class: 'empty' }, t('noStockLocations'))));
    return;
  }
  const id = cashDayId(filters.loc, filters.date);
  const day = ctx.live(`cashDay:${id}`, (set) => watchDoc(['shops', shopId, 'cashDays', id], set));
  const stats = ctx.live(`stats:${id}`, (set) => watchDoc(['shops', shopId, 'dailyStats', id], set));

  const locSel = el('select', { class: 'input select', 'aria-label': t('branch') }, branches.map((l) => el('option', { value: l.id, selected: l.id === filters.loc }, localName(l))));
  locSel.addEventListener('change', () => { filters.loc = locSel.value; ctx.rerender(); });
  const dateInput = el('input', { type: 'date', class: 'input date', value: filters.date, 'aria-label': t('date') });
  dateInput.addEventListener('change', () => { filters.date = dateInput.value || today(); ctx.rerender(); });
  const top = el('div', { class: 'filters two' }, el('span', { class: 'select-wrap' }, locSel), dateInput);

  if (day === null || stats === null) {
    root.replaceChildren(header(t('cashDay'), { back }), el('main', { class: 'page' }, top, el('p', { class: 'empty' }, t('loading'))));
    return;
  }
  const s = stats || {};
  const line = (label, n, cls = '') => el('div', { class: `sum-line ${cls}` }, el('span', {}, label), el('span', {}, fmtMoney(n)));
  const breakdown = (d) => el('section', { class: 'card form' },
    line(t('openingCash'), d?.opening || 0),
    line(t('cashSales'), s.pay?.cash || 0),
    line(t('cashCollected'), s.collected?.cash || 0),
    line(t('cashPaidOut'), -(s.paidOut?.cash || 0)),
    el('div', { class: 'sum-line total' }, el('span', {}, t('expectedCash')), el('strong', {}, fmtMoney(expectedCash(d, s)))),
  );

  let body;
  if (!day) {
    // Not opened yet: start with what's in the drawer, suggested from the last closing.
    const opening = keep(numberField({ name: 'opening', label: t('openingCash') }), `${id}:opening`);
    const form = el('form', { class: 'card form', novalidate: true },
      el('p', { class: 'muted' }, t('cashNotOpen', { date: fmtDate(filters.date) })),
      opening,
      el('button', { type: 'submit', class: 'btn primary' }, icon('plus'), t('openDay')),
    );
    lastClosing(shopId, filters.loc).then((n) => { if (n != null && !opening.querySelector('input').value) opening.querySelector('input').value = String(n); });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const n = parseNum(form.elements.opening.value);
      const bad = Number.isNaN(n) || n < 0;
      setFieldError(form, 'opening', bad ? t('invalidNumber') : '');
      if (bad) return;
      setDoc(doc(db, 'shops', shopId, 'cashDays', id), {
        locationId: filters.loc, date: filters.date, opening: round2(n), openedBy: ctx.user.uid, openedAt: serverTimestamp(), closedAt: null,
      }).catch((err) => toast(errorText(err), 'error'));
      draft.delete(`${id}:opening`);
      toast(t('dayOpened'));
    });
    body = [form, breakdown(null)];
  } else if (!day.closedAt) {
    const form = el('form', { class: 'card form', novalidate: true },
      keep(numberField({ name: 'closing', label: t('countedCash') }), `${id}:closing`),
      keep(textField({ name: 'note', label: t('note') }), `${id}:note`),
      el('button', { type: 'submit', class: 'btn primary' }, t('closeDay')),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const n = parseNum(form.elements.closing.value);
      const bad = Number.isNaN(n) || n < 0;
      setFieldError(form, 'closing', bad ? t('invalidNumber') : '');
      if (bad) return;
      const expected = expectedCash(day, s);
      const diff = round2(n - expected);
      const yes = await confirmAction({ title: t('closeDay'), message: t('closeDayMsg', { counted: fmtMoney(n), expected: fmtMoney(expected), diff: fmtMoney(diff) }), confirmLabel: t('closeDay') });
      if (!yes) return;
      updateDoc(doc(db, 'shops', shopId, 'cashDays', id), {
        closing: round2(n), expected, difference: diff, note: form.elements.note.value.trim(), closedBy: ctx.user.uid, closedAt: serverTimestamp(),
      }).catch((err) => toast(errorText(err), 'error'));
      draft.delete(`${id}:closing`);
      draft.delete(`${id}:note`);
      lastClosingCache.set(filters.loc, round2(n));
      toast(t('dayClosed'));
    });
    body = [breakdown(day), form];
  } else {
    const diff = day.difference || 0;
    body = [
      breakdown(day),
      el('section', { class: 'card form' },
        line(t('countedCash'), day.closing, 'total'),
        el('div', { class: `sum-line ${diff < 0 ? 'credit' : diff > 0 ? 'change' : ''}` },
          el('span', {}, diff < 0 ? t('cashShort') : diff > 0 ? t('cashOver') : t('cashMatches')), el('strong', {}, fmtMoney(Math.abs(diff)))),
        day.note ? el('p', { class: 'muted' }, day.note) : null,
        el('span', { class: 'badge status-paid' }, t('dayIsClosed')),
      ),
      isManager(me) ? el('button', { type: 'button', class: 'btn ghost', onclick: async () => {
        const yes = await confirmAction({ title: t('reopenDay'), message: t('reopenDayMsg'), confirmLabel: t('reopenDay') });
        if (yes) updateDoc(doc(db, 'shops', shopId, 'cashDays', id), { closedAt: null, closing: deleteField(), expected: deleteField(), difference: deleteField() }).catch((err) => toast(errorText(err), 'error'));
      } }, t('reopenDay')) : null,
    ];
  }

  root.replaceChildren(header(t('cashDay'), { back }), el('main', { class: 'page' }, top, ...body));
}
