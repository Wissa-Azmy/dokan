// Sales: the day's sales per branch, one sale with its receipt, and returns.
import { t, localName, errorText } from './i18n.js';
import { fmtMoney, fmtNum, fmtDate, parseNum } from './format.js';
import { el, icon, selectField, openDialog, toast } from './forms.js';
import { watchCollection, watchDoc } from './sync.js';
import { where } from './firebase.js';
import { header } from './screens.js';
import { useProducts } from './products.js';
import { useLocations } from './locations.js';
import { myLocations } from './stock.js';
import { useCustomers } from './customers.js';
import { receiptDialog, receiptNode } from './receipt.js';
import { today } from './suppliers.js';
import { round2 } from './buying.js';
import { roundQty } from './movements.js';
import { saleTotals, recordReturn, SALE_METHODS } from './selling.js';

const ALL = '__all';
const filters = { loc: null, date: null };
const seesAll = (me) => me?.role === 'owner' || (me?.role === 'manager' && !me.branchIds?.length);

export function renderSales(root, ctx, shopId) {
  const me = ctx.members.get(shopId);
  const locations = useLocations(ctx, shopId);
  const customers = useCustomers(ctx, shopId) || [];
  const branches = myLocations(me, locations).filter((l) => l.type === 'branch');
  const options = [...(seesAll(me) && branches.length > 1 ? [{ value: ALL, label: t('allBranches') }] : []), ...branches.map((l) => ({ value: l.id, label: localName(l) }))];
  if (!options.some((o) => o.value === filters.loc)) filters.loc = options[0]?.value || null;
  filters.date ||= today();

  const key = `sales:${filters.loc}:${filters.date}`;
  const sales = filters.loc
    ? ctx.live(key, (set) => watchCollection(['shops', shopId, 'sales'], set,
      where('date', '==', filters.date), ...(filters.loc === ALL ? [] : [where('locationId', '==', filters.loc)])))
    : [];
  const rows = [...(sales || [])].sort((a, b) => String(b.clientAt || '').localeCompare(String(a.clientAt || '')));
  const sum = round2(rows.reduce((s, x) => s + x.total, 0));
  const custName = (id) => customers.find((c) => c.id === id)?.name;

  const locSel = el('select', { class: 'input select', 'aria-label': t('branch') }, options.map((o) => el('option', { value: o.value, selected: o.value === filters.loc }, o.label)));
  locSel.addEventListener('change', () => { filters.loc = locSel.value; ctx.rerender(); });
  const dateInput = el('input', { type: 'date', class: 'input date', value: filters.date, 'aria-label': t('date') });
  dateInput.addEventListener('change', () => { filters.date = dateInput.value || today(); ctx.rerender(); });

  root.replaceChildren(
    header(t('sales'), { back: `#/shop/${shopId}` }),
    el('main', { class: 'page' },
      el('div', { class: 'filters two' }, el('span', { class: 'select-wrap' }, locSel), dateInput),
      el('section', { class: 'card hero day-card' },
        el('span', { class: 'muted' }, t('salesCount', { n: fmtNum(rows.length) })),
        el('strong', { class: 'big-money' }, fmtMoney(sum)),
      ),
      el('div', { class: 'list' },
        !sales ? el('p', { class: 'empty' }, t('loading'))
          : !rows.length ? el('p', { class: 'empty' }, t('noSales'))
            : rows.map((s) => el('a', { class: 'card row link-row', href: `#/shop/${shopId}/sale/${s.id}` },
              el('span', { class: 'row-main' },
                el('strong', { dir: 'ltr', class: 'code' }, s.number),
                el('span', { class: 'row-sub' }, [
                  s.clientAt ? new Date(s.clientAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '',
                  t('itemsCount', { n: fmtNum(s.lines.length) }),
                  custName(s.customerId),
                ].filter(Boolean).join(' · ')),
                s.onCredit > 0 ? el('span', { class: 'row-meta' }, el('span', { class: 'badge status-credit' }, `${t('pay_credit')} ${fmtMoney(s.onCredit)}`)) : null,
              ),
              el('span', { class: 'money' }, fmtMoney(s.total)),
            )),
      ),
      el('a', { class: 'btn primary fab', href: `#/shop/${shopId}/sell` }, icon('cart'), t('sell')),
    ),
  );
}

// ---------- One sale ----------

export function renderSale(root, ctx, shopId, saleId) {
  const back = `#/shop/${shopId}/sales`;
  const sale = ctx.live(`sale:${saleId}`, (set) => watchDoc(['shops', shopId, 'sales', saleId], set));
  const products = useProducts(ctx, shopId) || [];
  const locations = useLocations(ctx, shopId) || [];
  const customers = useCustomers(ctx, shopId) || [];
  if (!sale) {
    root.replaceChildren(header(t('sale'), { back }), el('main', { class: 'page' }, el('p', { class: 'empty' }, sale === false ? t('noMatches') : t('loading'))));
    return;
  }
  const returns = ctx.live(`saleReturns:${saleId}`, (set) => watchCollection(['shops', shopId, 'returns'], set,
    where('saleId', '==', saleId), where('locationId', '==', sale.locationId)));
  const info = {
    shop: ctx.shops.get(shopId),
    location: locations.find((l) => l.id === sale.locationId),
    products,
    customer: customers.find((c) => c.id === sale.customerId),
  };
  const returned = returnedQty(returns || []);
  const canReturn = returns && sale.lines.some((l) => roundQty(l.qty - (returned[l.productId] || 0)) > 0);
  const product = (id) => products.find((p) => p.id === id);

  root.replaceChildren(
    header(sale.number, { back }),
    el('main', { class: 'page' },
      el('div', { class: 'receipt-wrap' }, receiptNode(sale, info)),
      el('div', { class: 'actions' },
        el('button', { type: 'button', class: 'btn ghost', onclick: () => receiptDialog(sale, info) }, icon('share'), t('receipt')),
        canReturn ? el('button', { type: 'button', class: 'btn primary', onclick: () => returnDialog(ctx, shopId, sale, returned, info) }, t('returnItems')) : null,
      ),
      (returns || []).length ? el('section', { class: 'section' },
        el('h2', { class: 'section-title' }, t('returnsTitle')),
        el('div', { class: 'list' }, returns.map((r) => el('div', { class: 'card row' },
          el('span', { class: 'row-main' },
            el('strong', {}, `${fmtDate(r.date)} · ${r.refundMethod === 'credit' ? t('refundToCredit') : t(`pay_${r.refundMethod}`)}`),
            el('span', { class: 'row-sub' }, r.lines.map((l) => `${product(l.productId) ? localName(product(l.productId)) : t('unknownProduct')} × ${fmtNum(l.qty, 3)}`).join(' · ')),
          ),
          el('span', { class: 'money pos' }, `−${fmtMoney(r.amount)}`),
        ))),
      ) : null,
    ),
  );
}

function returnedQty(returns) {
  const out = {};
  for (const r of returns) for (const l of r.lines) out[l.productId] = roundQty((out[l.productId] || 0) + l.qty);
  return out;
}

function returnDialog(ctx, shopId, sale, returned, info) {
  const { factor } = saleTotals(sale.lines, sale.discount);
  const product = (id) => info.products.find((p) => p.id === id);
  openDialog(t('returnItems'), (body, close) => {
    const inputs = [];
    const amountEl = el('strong', {});
    const errorBox = el('p', { class: 'form-error', role: 'alert' });
    const methods = [...(sale.customerId ? ['credit'] : []), ...SALE_METHODS];
    const method = selectField({
      name: 'method',
      label: t('refundHow'),
      value: sale.customerId && sale.onCredit > 0 ? 'credit' : 'cash',
      options: methods.map((m) => ({ value: m, label: m === 'credit' ? t('refundToCredit') : t(`pay_${m}`) })),
    });

    const readLines = () => inputs.map(({ line, input, max }) => {
      const n = parseNum(input.value);
      const qty = Number.isNaN(n) ? 0 : roundQty(n);
      input.classList.toggle('invalid', qty < 0 || qty > max);
      return { productId: line.productId, qty, price: line.price, unitRefund: round2(line.price * factor), max };
    });
    const recalc = () => {
      const lines = readLines();
      amountEl.textContent = fmtMoney(round2(lines.reduce((s, l) => s + l.qty * l.unitRefund, 0)));
      return lines;
    };

    const list = el('div', { class: 'list' });
    for (const line of sale.lines) {
      const max = roundQty(line.qty - (returned[line.productId] || 0));
      if (max <= 0) continue;
      const input = el('input', { type: 'text', inputmode: 'decimal', class: 'input num qty-input', value: '0', 'aria-label': t('qty') });
      input.addEventListener('input', recalc);
      inputs.push({ line, input, max });
      list.append(el('div', { class: 'row count-row' },
        el('span', { class: 'row-main' },
          el('strong', {}, product(line.productId) ? localName(product(line.productId)) : t('unknownProduct')),
          el('span', { class: 'muted small' }, t('canReturn', { n: fmtNum(max, 3) })),
        ),
        el('button', { type: 'button', class: 'chip', onclick: () => { input.value = String(max); recalc(); } }, t('all')),
        input,
      ));
    }

    const confirm = el('button', { type: 'button', class: 'btn primary wide' }, t('confirmReturn'));
    confirm.addEventListener('click', () => {
      const lines = recalc();
      if (lines.some((l) => l.qty < 0 || l.qty > l.max)) { errorBox.textContent = t('returnTooMany'); return; }
      const chosen = lines.filter((l) => l.qty > 0).map(({ max, ...l }) => l);
      if (!chosen.length) { errorBox.textContent = t('needLines'); return; }
      const amount = round2(chosen.reduce((s, l) => s + l.qty * l.unitRefund, 0));
      const { done } = recordReturn(shopId, {
        saleId: sale.id,
        saleNumber: sale.number,
        locationId: sale.locationId,
        date: today(),
        clientAt: new Date().toISOString(),
        customerId: sale.customerId || null,
        lines: chosen,
        amount,
        refundMethod: method.querySelector('select').value,
      }, ctx.user.uid);
      done.catch((err) => toast(errorText(err), 'error'));
      toast(t('returnSaved'));
      close();
    });

    body.append(list, method, el('div', { class: 'sum-line total' }, el('span', {}, t('refundAmount')), amountEl), errorBox, confirm);
    recalc();
  });
}
