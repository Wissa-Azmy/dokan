// Customers: list with credit balances, add/edit, statement, and payments received.
import { t, localName, errorText } from './i18n.js';
import { fmtMoney, fmtDate, normalize, parseNum } from './format.js';
import { el, icon, iconButton, textField, numberField, selectField, dateField, checkboxField, setFieldError, openDialog, toast } from './forms.js';
import { watchCollection } from './sync.js';
import { where } from './firebase.js';
import { isManager } from './roles.js';
import { header } from './screens.js';
import { useLocations } from './locations.js';
import { myLocations } from './stock.js';
import { today } from './suppliers.js';
import { round2 } from './buying.js';
import { saveCustomer, recordCustomerEntry, SALE_METHODS } from './selling.js';

export function useCustomers(ctx, shopId) {
  return ctx.live(`customers:${shopId}`, (set) => watchCollection(['shops', shopId, 'customers'], set));
}

export function useCustomerAccounts(ctx, shopId) {
  return ctx.live(`customerAccounts:${shopId}`, (set) => watchCollection(['shops', shopId, 'customerAccounts'], set));
}

export const customerBalance = (accounts, id) => round2((accounts || []).find((a) => a.id === id)?.balance || 0);

// For members limited to some locations, queries must say so, or the rules refuse them.
export function scopeFilters(me) {
  const all = me?.role === 'owner' || (me?.role === 'manager' && !me.branchIds?.length);
  return all ? [] : [where('locationId', 'in', (me?.branchIds || []).slice(0, 30))];
}

// wa.me needs the international number: Egyptian 01xxxxxxxxx becomes 201xxxxxxxxx.
export function waNumber(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (!d) return '';
  return d.startsWith('0') ? `2${d}` : d;
}

let view = null;

export function renderCustomers(root, ctx, shopId) {
  const customers = useCustomers(ctx, shopId);
  const accounts = useCustomerAccounts(ctx, shopId);
  if (view && view.shopId === shopId && root.contains(view.page)) return view.update(customers, accounts);

  const search = el('input', { type: 'search', class: 'input', placeholder: t('searchCustomers'), autocomplete: 'off' });
  const owingOnly = el('input', { type: 'checkbox' });
  const list = el('div', { class: 'list' });
  let cur = { customers, accounts };

  function draw() {
    list.replaceChildren();
    if (!cur.customers) return list.append(el('p', { class: 'empty' }, t('loading')));
    const q = normalize(search.value);
    const rows = cur.customers
      .filter((c) => !q || normalize(`${c.name} ${c.phone}`).includes(q))
      .filter((c) => !owingOnly.checked || customerBalance(cur.accounts, c.id) > 0)
      .sort((a, b) => customerBalance(cur.accounts, b.id) - customerBalance(cur.accounts, a.id) || a.name.localeCompare(b.name));
    if (!rows.length) return list.append(el('p', { class: 'empty' }, cur.customers.length ? t('noMatches') : t('noCustomers')));
    for (const c of rows.slice(0, 200)) {
      const bal = customerBalance(cur.accounts, c.id);
      list.append(el('a', { class: `card row link-row ${c.active === false ? 'is-off' : ''}`, href: `#/shop/${shopId}/customer/${c.id}` },
        el('span', { class: 'row-icon' }, icon('user')),
        el('span', { class: 'row-main' },
          el('strong', {}, c.name),
          c.phone ? el('span', { class: 'row-sub', dir: 'ltr' }, c.phone) : null,
        ),
        el('span', { class: `money ${bal > 0 ? 'neg' : ''}` }, fmtMoney(bal)),
      ));
    }
  }
  search.addEventListener('input', draw);
  owingOnly.addEventListener('change', draw);
  draw();

  const page = el('main', { class: 'page' },
    el('div', { class: 'filters' },
      el('label', { class: 'search-box' }, icon('search'), search),
      el('label', { class: 'check inline' }, owingOnly, el('span', { class: 'check-text' }, t('owingOnly'))),
    ),
    list,
    el('button', { type: 'button', class: 'btn primary fab', onclick: () => customerDialog(shopId, null) }, icon('plus'), t('addCustomer')),
  );
  root.replaceChildren(header(t('customers'), { back: `#/shop/${shopId}` }), page);
  view = { shopId, page, update(c, a) { cur = { customers: c, accounts: a }; draw(); } };
}

// onSaved(id, { name, phone, notes }) is called with the new or edited customer.
export function customerDialog(shopId, c, onSaved) {
  openDialog(c ? t('editCustomer') : t('addCustomer'), (body, close) => {
    const form = el('form', { class: 'form', novalidate: true },
      textField({ name: 'name', label: t('customerName'), value: c?.name || '' }),
      textField({ name: 'phone', label: t('phone'), value: c?.phone || '', type: 'tel', dir: 'ltr' }),
      textField({ name: 'notes', label: t('notes'), value: c?.notes || '' }),
      c ? checkboxField({ name: 'active', label: t('customerActive'), checked: c.active !== false }) : null,
      el('div', { class: 'actions' },
        el('button', { type: 'button', class: 'btn ghost', onclick: close }, t('cancel')),
        el('button', { type: 'submit', class: 'btn primary' }, t('save')),
      ),
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = form.elements;
      const name = f.name.value.trim();
      setFieldError(form, 'name', name ? '' : t('required'));
      if (!name) return;
      const data = { name, phone: f.phone.value.trim(), notes: f.notes.value.trim(), active: c ? f.active.checked : true };
      const { id, done } = saveCustomer(shopId, c?.id, data);
      done.catch((err) => toast(errorText(err), 'error'));
      toast(t('saved'));
      close();
      onSaved?.(id, data);
    });
    body.append(form);
  });
}

// ---------- Statement ----------

export function renderCustomer(root, ctx, shopId, customerId) {
  const back = `#/shop/${shopId}/customers`;
  const me = ctx.members.get(shopId);
  const c = (useCustomers(ctx, shopId) || []).find((x) => x.id === customerId);
  const accounts = useCustomerAccounts(ctx, shopId);
  const scope = scopeFilters(me);
  const sales = ctx.live(`customerSales:${customerId}`, (set) => watchCollection(['shops', shopId, 'sales'], set, where('customerId', '==', customerId), ...scope));
  const entries = ctx.live(`customerEntries:${customerId}`, (set) => watchCollection(['shops', shopId, 'customerPayments'], set, where('customerId', '==', customerId), ...scope));
  const returns = ctx.live(`customerReturns:${customerId}`, (set) => watchCollection(['shops', shopId, 'returns'], set, where('customerId', '==', customerId), ...scope));
  if (!c) {
    root.replaceChildren(header(t('customers'), { back }), el('main', { class: 'page' }, el('p', { class: 'empty' }, t('loading'))));
    return;
  }
  const bal = customerBalance(accounts, customerId);
  const wa = waNumber(c.phone);

  // Only what changes the balance: credit given on sales, payments, charges, and returns put back on credit.
  const lines = [
    ...(sales || []).filter((s) => s.onCredit > 0).map((s) => ({
      date: s.date, at: s.at, title: `${t('sale')} ${s.number}`, sub: `${t('total')}: ${fmtMoney(s.total)}${s.dueDate ? ` · ${t('dueOn', { date: fmtDate(s.dueDate) })}` : ''}`,
      amount: s.onCredit, href: `#/shop/${shopId}/sale/${s.id}`,
    })),
    ...(entries || []).map((x) => ({
      date: x.date, at: x.at, title: t(`entry_${x.kind}`) + (x.method ? ` · ${t(`pay_${x.method}`)}` : ''), sub: x.note,
      amount: x.kind === 'payment' ? -x.amount : x.amount,
    })),
    ...(returns || []).filter((r) => r.refundMethod === 'credit').map((r) => ({
      date: r.date, at: r.at, title: `${t('returnTitle')} · ${r.saleNumber}`, sub: '', amount: -r.amount,
    })),
  ].sort((a, b) => String(b.date).localeCompare(String(a.date)) || (b.at?.toMillis?.() || 0) - (a.at?.toMillis?.() || 0));

  root.replaceChildren(
    header(c.name, { back }),
    el('main', { class: 'page' },
      el('section', { class: 'card hero balance-card' },
        el('span', { class: 'muted' }, bal < 0 ? t('weOweCustomer') : t('customerOwes')),
        el('strong', { class: 'big-money' }, fmtMoney(Math.abs(bal))),
        el('div', { class: 'row-meta' },
          c.phone ? el('a', { class: 'chip', href: `tel:${c.phone}`, dir: 'ltr' }, c.phone) : null,
          wa ? el('a', { class: 'chip', href: `https://wa.me/${wa}`, target: '_blank', rel: 'noopener' }, t('whatsapp')) : null,
          iconButton('edit', t('edit'), () => customerDialog(shopId, c)),
        ),
      ),
      el('div', { class: 'actions' },
        isManager(me) ? el('button', { type: 'button', class: 'btn ghost', onclick: () => entryDialog(ctx, shopId, c, 'charge') }, t('addCharge')) : null,
        el('button', { type: 'button', class: 'btn primary', onclick: () => entryDialog(ctx, shopId, c, 'payment') }, t('receivePayment')),
      ),
      el('h2', { class: 'section-title' }, t('statement')),
      el('div', { class: 'list' },
        !sales || !entries || !returns ? el('p', { class: 'empty' }, t('loading'))
          : !lines.length ? el('p', { class: 'empty' }, t('noActivity'))
            : lines.map((l) => el(l.href ? 'a' : 'div', { class: 'card row link-row', href: l.href },
              el('span', { class: 'row-main' },
                el('strong', {}, l.title),
                el('span', { class: 'row-sub' }, [fmtDate(l.date), l.sub].filter(Boolean).join(' · ')),
              ),
              el('span', { class: `money ${l.amount < 0 ? 'pos' : 'neg'}` }, `${l.amount > 0 ? '+' : '−'}${fmtMoney(Math.abs(l.amount))}`),
            )),
      ),
    ),
  );
}

function entryDialog(ctx, shopId, c, kind) {
  const me = ctx.members.get(shopId);
  const branches = myLocations(me, useLocations(ctx, shopId)).filter((l) => l.type === 'branch');
  openDialog(kind === 'payment' ? t('receivePayment') : t('addCharge'), (body, close) => {
    const form = el('form', { class: 'form', novalidate: true },
      kind === 'charge' ? el('p', { class: 'field-hint' }, t('customerChargeHint')) : null,
      numberField({ name: 'amount', label: t('amount') }),
      kind === 'payment' ? selectField({ name: 'method', label: t('method'), value: 'cash', options: SALE_METHODS.map((m) => ({ value: m, label: t(`pay_${m}`) })) }) : null,
      selectField({ name: 'loc', label: t('branch'), value: branches[0]?.id, options: branches.map((l) => ({ value: l.id, label: localName(l) })) }),
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
      if (bad || !f.loc.value) return;
      recordCustomerEntry(shopId, {
        customerId: c.id, kind, amount, method: f.method?.value, locationId: f.loc.value, date: f.date.value || today(), note: f.note.value.trim(),
      }, ctx.user.uid).catch((err) => toast(errorText(err), 'error'));
      toast(t('entrySaved'));
      close();
    });
    body.append(form);
  });
}

// Pick a customer for a sale: search, tap, or add a new one. onPick(customer | null).
export function pickCustomerDialog(ctx, shopId, onPick) {
  openDialog(t('chooseCustomer'), (body, close) => {
    const search = el('input', { type: 'search', class: 'input', placeholder: t('searchCustomers'), autocomplete: 'off' });
    const list = el('div', { class: 'results' });
    const draw = () => {
      const all = (useCustomers(ctx, shopId) || []).filter((c) => c.active !== false);
      const accounts = useCustomerAccounts(ctx, shopId);
      const q = normalize(search.value);
      const rows = all.filter((c) => !q || normalize(`${c.name} ${c.phone}`).includes(q)).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 30);
      list.replaceChildren(...rows.map((c) => el('button', { type: 'button', class: 'result', onclick: () => { close(); onPick(c); } },
        el('span', {}, c.name, c.phone ? el('span', { class: 'muted small', dir: 'ltr' }, ` · ${c.phone}`) : null),
        el('span', { class: 'muted small' }, fmtMoney(customerBalance(accounts, c.id))),
      )));
      if (!rows.length) list.append(el('p', { class: 'muted small' }, t('noMatches')));
    };
    search.addEventListener('input', draw);
    draw();
    body.append(
      el('label', { class: 'search-box' }, icon('search'), search),
      list,
      el('div', { class: 'actions' },
        el('button', { type: 'button', class: 'btn ghost', onclick: () => { close(); onPick(null); } }, t('noCustomer')),
        el('button', { type: 'button', class: 'btn primary', onclick: () => {
          close();
          customerDialog(shopId, null, (id, data) => onPick({ id, ...data }));
        } }, icon('plus'), t('addCustomer')),
      ),
    );
  });
}
