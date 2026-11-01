// Suppliers: list, add/edit, and each supplier's statement with payments.
import { t, errorText } from './i18n.js';
import { fmtMoney, fmtDate, normalize, parseNum } from './format.js';
import {
  el, icon, iconButton, textField, numberField, selectField, dateField, checkboxField, setFieldError, openDialog, toast,
} from './forms.js';
import { watchCollection } from './sync.js';
import { where } from './firebase.js';
import { isManager, isCostManager } from './roles.js';
import { header } from './screens.js';
import { saveSupplier, recordSupplierEntry, PAY_METHODS, round2 } from './buying.js';

export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function useSuppliers(ctx, shopId) {
  return ctx.live(`suppliers:${shopId}`, (set) => watchCollection(['shops', shopId, 'suppliers'], set));
}

function useAccounts(ctx, shopId) {
  return ctx.live(`supplierAccounts:${shopId}`, (set) => watchCollection(['shops', shopId, 'supplierAccounts'], set));
}

const balanceOf = (accounts, id) => round2((accounts || []).find((a) => a.id === id)?.balance || 0);

// wa.me needs the international number: Egyptian 01xxxxxxxxx becomes 201xxxxxxxxx.
function waLink(number) {
  const digits = String(number || '').replace(/\D/g, '');
  if (!digits) return null;
  return `https://wa.me/${digits.startsWith('0') ? `2${digits}` : digits}`;
}

let view = null;

export function renderSuppliers(root, ctx, shopId) {
  const me = ctx.members.get(shopId);
  const suppliers = useSuppliers(ctx, shopId);
  const costs = isCostManager(me);
  const accounts = costs ? useAccounts(ctx, shopId) : [];

  if (view && view.shopId === shopId && root.contains(view.page)) return view.update(suppliers, accounts);

  const search = el('input', { type: 'search', class: 'input', placeholder: t('searchSuppliers'), autocomplete: 'off' });
  const list = el('div', { class: 'list' });
  let cur = { suppliers, accounts };

  function draw() {
    list.replaceChildren();
    if (!cur.suppliers) return list.append(el('p', { class: 'empty' }, t('loading')));
    const q = normalize(search.value);
    const rows = cur.suppliers
      .filter((s) => !q || normalize(`${s.name} ${s.phone} ${s.whatsapp}`).includes(q))
      .sort((a, b) => Number(b.active !== false) - Number(a.active !== false) || a.name.localeCompare(b.name));
    if (!rows.length) return list.append(el('p', { class: 'empty' }, cur.suppliers.length ? t('noMatches') : t('noSuppliers')));
    for (const s of rows) {
      const bal = balanceOf(cur.accounts, s.id);
      list.append(el('div', { class: `card row ${s.active === false ? 'is-off' : ''}` },
        el(costs ? 'a' : 'span', { class: 'row-main link-row', href: costs ? `#/shop/${shopId}/supplier/${s.id}` : null },
          el('strong', {}, s.name),
          s.phone ? el('span', { class: 'row-sub', dir: 'ltr' }, s.phone) : null,
        ),
        costs ? el('span', { class: `money ${bal > 0 ? 'neg' : ''}` }, fmtMoney(bal)) : null,
        el('span', { class: 'row-actions' },
          isManager(me) ? iconButton('edit', t('edit'), () => supplierDialog(shopId, s)) : null,
        ),
      ));
    }
  }
  search.addEventListener('input', draw);
  draw();

  const page = el('main', { class: 'page' },
    el('label', { class: 'search-box' }, icon('search'), search),
    list,
    isManager(me) ? el('button', { type: 'button', class: 'btn primary', onclick: () => supplierDialog(shopId, null) }, icon('plus'), t('addSupplier')) : null,
  );
  root.replaceChildren(header(t('suppliers'), { back: `#/shop/${shopId}` }), page);
  view = { shopId, page, update(s, a) { cur = { suppliers: s, accounts: a }; draw(); } };
}

export function supplierDialog(shopId, s, onSaved) {
  openDialog(s ? t('editSupplier') : t('addSupplier'), (body, close) => {
    const form = el('form', { class: 'form', novalidate: true },
      textField({ name: 'name', label: t('supplierName'), value: s?.name || '' }),
      textField({ name: 'phone', label: t('phone'), value: s?.phone || '', type: 'tel', dir: 'ltr' }),
      textField({ name: 'whatsapp', label: t('whatsapp'), value: s?.whatsapp || '', type: 'tel', dir: 'ltr' }),
      textField({ name: 'address', label: t('address'), value: s?.address || '' }),
      textField({ name: 'notes', label: t('notes'), value: s?.notes || '' }),
      s ? checkboxField({ name: 'active', label: t('supplierActive'), checked: s.active !== false }) : null,
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
      saveSupplier(shopId, s?.id, {
        name, phone: f.phone.value.trim(), whatsapp: f.whatsapp.value.trim(), address: f.address.value.trim(), notes: f.notes.value.trim(),
        active: s ? f.active.checked : true,
      }).catch((err) => toast(errorText(err), 'error'));
      toast(t('saved'));
      close();
      onSaved?.();
    });
    body.append(form);
  });
}

// ---------- Statement ----------

export function renderSupplier(root, ctx, shopId, supplierId) {
  const back = `#/shop/${shopId}/suppliers`;
  const s = (useSuppliers(ctx, shopId) || []).find((x) => x.id === supplierId);
  const accounts = useAccounts(ctx, shopId);
  const purchases = ctx.live(`supplierPurchases:${supplierId}`, (set) => watchCollection(['shops', shopId, 'purchases'], set, where('supplierId', '==', supplierId)));
  const entries = ctx.live(`supplierEntries:${supplierId}`, (set) => watchCollection(['shops', shopId, 'supplierPayments'], set, where('supplierId', '==', supplierId)));
  if (!s) {
    root.replaceChildren(header(t('suppliers'), { back }), el('main', { class: 'page' }, el('p', { class: 'empty' }, t('loading'))));
    return;
  }
  const bal = balanceOf(accounts, supplierId);
  const wa = waLink(s.whatsapp || s.phone);

  // Costed invoices add what we didn't pay; payments lower it; charges raise it.
  const lines = [
    ...(purchases || []).filter((p) => p.status === 'costed').map((p) => ({
      date: p.date, at: p.createdAt, title: `${t('purchase')} ${p.number}`, sub: `${t('total')}: ${fmtMoney(p.total)} · ${t('paid')}: ${fmtMoney(p.paid)}`,
      amount: round2(p.total - p.paid), href: `#/shop/${shopId}/purchase/${p.id}`,
    })),
    ...(entries || []).map((x) => ({
      date: x.date, at: x.at, title: t(`entry_${x.kind}`) + (x.method ? ` · ${t(`pay_${x.method}`)}` : ''), sub: x.note,
      amount: x.kind === 'payment' ? -x.amount : x.amount,
    })),
  ].sort((a, b) => String(b.date).localeCompare(String(a.date)) || (b.at?.toMillis?.() || 0) - (a.at?.toMillis?.() || 0));

  root.replaceChildren(
    header(s.name, { back }),
    el('main', { class: 'page' },
      el('section', { class: 'card hero balance-card' },
        el('span', { class: 'muted' }, bal < 0 ? t('theyOwe') : t('weOwe')),
        el('strong', { class: 'big-money' }, fmtMoney(Math.abs(bal))),
        el('div', { class: 'row-meta' },
          s.phone ? el('a', { class: 'chip', href: `tel:${s.phone}`, dir: 'ltr' }, s.phone) : null,
          wa ? el('a', { class: 'chip', href: wa, target: '_blank', rel: 'noopener' }, t('whatsapp')) : null,
        ),
      ),
      el('div', { class: 'actions' },
        el('button', { type: 'button', class: 'btn ghost', onclick: () => entryDialog(ctx, shopId, s, 'charge') }, t('addCharge')),
        el('button', { type: 'button', class: 'btn primary', onclick: () => entryDialog(ctx, shopId, s, 'payment') }, t('recordPayment')),
      ),
      el('h2', { class: 'section-title' }, t('statement')),
      el('div', { class: 'list' },
        !purchases || !entries ? el('p', { class: 'empty' }, t('loading'))
          : !lines.length ? el('p', { class: 'empty' }, t('noActivity'))
            : lines.map((l) => el(l.href ? 'a' : 'div', { class: 'card row link-row', href: l.href },
              el('span', { class: 'row-main' },
                el('strong', {}, l.title),
                el('span', { class: 'row-sub' }, [fmtDate(l.date), l.sub].filter(Boolean).join(' · ')),
              ),
              el('span', { class: `money ${l.amount < 0 ? 'pos' : ''}` }, `${l.amount > 0 ? '+' : l.amount < 0 ? '−' : ''}${fmtMoney(Math.abs(l.amount))}`),
            )),
      ),
    ),
  );
}

function entryDialog(ctx, shopId, s, kind) {
  openDialog(kind === 'payment' ? t('recordPayment') : t('addCharge'), (body, close) => {
    const form = el('form', { class: 'form', novalidate: true },
      kind === 'charge' ? el('p', { class: 'field-hint' }, t('chargeHint')) : null,
      numberField({ name: 'amount', label: t('amount') }),
      kind === 'payment' ? selectField({ name: 'method', label: t('method'), value: 'cash', options: PAY_METHODS.map((m) => ({ value: m, label: t(`pay_${m}`) })) }) : null,
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
      recordSupplierEntry(shopId, {
        supplierId: s.id, kind, amount, method: f.method?.value, date: f.date.value || today(), note: f.note.value.trim(),
      }, ctx.user.uid).catch((err) => toast(errorText(err), 'error'));
      toast(t('entrySaved'));
      close();
    });
    body.append(form);
  });
}

export const supplierName = (suppliers, id) => (suppliers || []).find((s) => s.id === id)?.name || t('noSupplier');
