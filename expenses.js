// Expenses per branch: rent, salaries, electricity… Each one also updates the day totals,
// so the dashboard and the cash drawer include it.
import { t, localName, errorText } from './i18n.js';
import { fmtMoney, fmtDate, parseNum } from './format.js';
import { el, icon, iconButton, textField, numberField, selectField, dateField, setFieldError, openDialog, confirmAction, toast } from './forms.js';
import { db, doc, collection, writeBatch, serverTimestamp, where } from './firebase.js';
import { watchCollection } from './sync.js';
import { isOwner } from './roles.js';
import { header } from './screens.js';
import { useLocations } from './locations.js';
import { myLocations } from './stock.js';
import { today } from './suppliers.js';
import { PAY_METHODS, round2 } from './buying.js';
import { addStats } from './selling.js';

export const EXPENSE_TYPES = ['rent', 'salaries', 'electricity', 'water', 'internet', 'transport', 'maintenance', 'supplies', 'taxes', 'other'];
const ALL = '__all';

export function recordExpense(shopId, e, uid) {
  const batch = writeBatch(db);
  batch.set(doc(collection(db, 'shops', shopId, 'expenses')), { ...e, amount: round2(e.amount), by: uid, at: serverTimestamp() });
  addStats(batch, shopId, e.locationId, e.date, { expenses: e.amount, paidOut: { [e.method]: e.amount } });
  return batch.commit();
}

// Deleting takes the amount back out of the day totals.
function deleteExpense(shopId, e) {
  const batch = writeBatch(db);
  batch.delete(doc(db, 'shops', shopId, 'expenses', e.id));
  addStats(batch, shopId, e.locationId, e.date, { expenses: -e.amount, paidOut: { [e.method]: -e.amount } });
  return batch.commit();
}

export const monthNow = () => today().slice(0, 7);
export const monthRange = (m) => [`${m}-01`, `${m}-31`];

const filters = { loc: null, month: null };
const seesAll = (me) => me?.role === 'owner' || (me?.role === 'manager' && !me.branchIds?.length);

export function renderExpenses(root, ctx, shopId) {
  const me = ctx.members.get(shopId);
  const locations = useLocations(ctx, shopId);
  const branches = myLocations(me, locations);
  const options = [...(seesAll(me) && branches.length > 1 ? [{ value: ALL, label: t('allLocations') }] : []), ...branches.map((l) => ({ value: l.id, label: localName(l) }))];
  if (!options.some((o) => o.value === filters.loc)) filters.loc = options[0]?.value || null;
  filters.month ||= monthNow();
  const [from, to] = monthRange(filters.month);

  const list = filters.loc
    ? ctx.live(`expenses:${filters.loc}:${filters.month}`, (set) => watchCollection(['shops', shopId, 'expenses'], set,
      ...(filters.loc === ALL ? [] : [where('locationId', '==', filters.loc)]), where('date', '>=', from), where('date', '<=', to)))
    : [];
  const rows = [...(list || [])].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const total = round2(rows.reduce((s, x) => s + x.amount, 0));
  const byType = EXPENSE_TYPES.map((k) => ({ k, sum: round2(rows.filter((x) => x.type === k).reduce((s, x) => s + x.amount, 0)) })).filter((x) => x.sum);
  const locName = (id) => localName((locations || []).find((l) => l.id === id));

  const locSel = el('select', { class: 'input select', 'aria-label': t('location') }, options.map((o) => el('option', { value: o.value, selected: o.value === filters.loc }, o.label)));
  locSel.addEventListener('change', () => { filters.loc = locSel.value; ctx.rerender(); });
  const monthInput = el('input', { type: 'month', class: 'input date', value: filters.month, 'aria-label': t('month') });
  monthInput.addEventListener('change', () => { filters.month = monthInput.value || monthNow(); ctx.rerender(); });

  root.replaceChildren(
    header(t('expenses'), { back: `#/shop/${shopId}` }),
    el('main', { class: 'page' },
      el('div', { class: 'filters two' }, el('span', { class: 'select-wrap' }, locSel), monthInput),
      el('section', { class: 'card hero balance-card' },
        el('span', { class: 'muted' }, t('expensesTotal')),
        el('strong', { class: 'big-money' }, fmtMoney(total)),
        byType.length ? el('div', { class: 'row-meta' }, byType.map((x) => el('span', { class: 'badge' }, `${t(`exp_${x.k}`)} ${fmtMoney(x.sum)}`))) : null,
      ),
      el('div', { class: 'list' },
        !list ? el('p', { class: 'empty' }, t('loading'))
          : !rows.length ? el('p', { class: 'empty' }, t('noExpenses'))
            : rows.map((x) => el('div', { class: 'card row' },
              el('span', { class: 'row-main' },
                el('strong', {}, t(`exp_${x.type}`)),
                el('span', { class: 'row-sub' }, [fmtDate(x.date), locName(x.locationId), t(`pay_${x.method}`), x.note].filter(Boolean).join(' · ')),
              ),
              el('span', { class: 'money' }, fmtMoney(x.amount)),
              isOwner(me) ? el('span', { class: 'row-actions' }, iconButton('trash', t('delete'), async () => {
                const yes = await confirmAction({ title: t('deleteExpense'), message: t('deleteExpenseMsg', { amount: fmtMoney(x.amount) }), confirmLabel: t('delete'), danger: true });
                if (yes) deleteExpense(shopId, x).catch((err) => toast(errorText(err), 'error'));
              }, 'danger')) : null,
            )),
      ),
      branches.length ? el('button', { type: 'button', class: 'btn primary fab', onclick: () => expenseDialog(ctx, shopId, branches) }, icon('plus'), t('addExpense')) : null,
    ),
  );
}

function expenseDialog(ctx, shopId, branches) {
  openDialog(t('addExpense'), (body, close) => {
    const start = filters.loc && filters.loc !== ALL ? filters.loc : branches[0]?.id;
    const form = el('form', { class: 'form', novalidate: true },
      selectField({ name: 'loc', label: t('location'), value: start, options: branches.map((l) => ({ value: l.id, label: localName(l) })) }),
      selectField({ name: 'type', label: t('expenseType'), value: 'rent', options: EXPENSE_TYPES.map((k) => ({ value: k, label: t(`exp_${k}`) })) }),
      numberField({ name: 'amount', label: t('amount') }),
      selectField({ name: 'method', label: t('method'), value: 'cash', options: PAY_METHODS.map((m) => ({ value: m, label: t(`pay_${m}`) })) }),
      dateField({ name: 'date', label: t('date'), value: today() }),
      textField({ name: 'note', label: t('note') }),
      el('div', { class: 'actions' },
        el('button', { type: 'button', class: 'btn ghost', onclick: close }, t('cancel')),
        el('button', { type: 'submit', class: 'btn primary' }, t('save')),
      ),
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = form.elements;
      const amount = parseNum(f.amount.value);
      const bad = Number.isNaN(amount) || amount <= 0;
      setFieldError(form, 'amount', bad ? t('amountPositive') : '');
      if (bad) return;
      recordExpense(shopId, {
        locationId: f.loc.value, type: f.type.value, amount, method: f.method.value, date: f.date.value || today(), note: f.note.value.trim(),
      }, ctx.user.uid).catch((err) => toast(errorText(err), 'error'));
      toast(t('saved'));
      close();
    });
    body.append(form);
  });
}
