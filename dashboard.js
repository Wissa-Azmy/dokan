// Dashboard per shop or branch: sales, gross profit, expenses, stock value, money owed both ways,
// low stock, best sellers and a 12-month chart. Reads the day totals, not every single sale.
import { t, getLang, localName, errorText } from './i18n.js';
import { fmtMoney, fmtNum } from './format.js';
import { el, icon, toast, busy } from './forms.js';
import { where } from './firebase.js';
import { watchCollection } from './sync.js';
import { isCostManager } from './roles.js';
import { header } from './screens.js';
import { useProducts } from './products.js';
import { useCategories } from './categories.js';
import { useLocations } from './locations.js';
import { useStock, stockMap, myLocations, isLow } from './stock.js';
import { useCustomers, useCustomerAccounts } from './customers.js';
import { useSuppliers, today } from './suppliers.js';
import { useCosts } from './prices.js';
import { qtyAt } from './movements.js';
import { round2 } from './buying.js';
import { salesCsv, expensesCsv, purchasesCsv, productsCsv, customersCsv, download } from './csv.js';

const ALL = '__all';
const filters = { loc: null, period: 'month' };
const seesAll = (me) => me?.role === 'owner' || (me?.role === 'manager' && !me.branchIds?.length);

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function periodRange(period) {
  const now = new Date();
  if (period === 'today') return [today(), today()];
  if (period === 'last30') return [iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29)), today()];
  if (period === 'lastMonth') {
    return [iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), iso(new Date(now.getFullYear(), now.getMonth(), 0))];
  }
  return [iso(new Date(now.getFullYear(), now.getMonth(), 1)), today()];
}

// The last 12 months, oldest first: [{ key: '2026-03', label }]
function last12Months() {
  const now = new Date();
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
    return { key: iso(d).slice(0, 7), label: new Intl.DateTimeFormat(getLang() === 'ar' ? 'ar-EG' : 'en-GB', { month: 'short' }).format(d) };
  });
}

function useAccounts(ctx, shopId) {
  return ctx.live(`supplierAccounts:${shopId}`, (set) => watchCollection(['shops', shopId, 'supplierAccounts'], set));
}

// Sums day totals; items: productId → { q, rev } after returns.
function sumStats(days) {
  const out = { sales: 0, returns: 0, count: 0, credit: 0, expenses: 0, items: new Map() };
  for (const d of days) {
    out.sales += d.sales || 0;
    out.returns += d.returns || 0;
    out.count += d.count || 0;
    out.credit += d.credit || 0;
    out.expenses += d.expenses || 0;
    for (const [pid, v] of Object.entries(d.items || {})) {
      const e = out.items.get(pid) || { q: 0, rev: 0 };
      e.q += v.q || 0;
      e.rev += v.rev || 0;
      out.items.set(pid, e);
    }
  }
  return out;
}

// Gross profit = revenue − quantity × current average cost (an estimate; see note on screen).
function grossProfit(items, costOf) {
  let gp = 0;
  let missing = 0;
  for (const [pid, v] of items) {
    const c = costOf.get(pid)?.avgCost;
    if (c == null) { if (v.q) missing += 1; gp += v.rev; continue; }
    gp += v.rev - v.q * c;
  }
  return { gp: round2(gp), missing };
}

export function renderDashboard(root, ctx, shopId) {
  const me = ctx.members.get(shopId);
  const costs = isCostManager(me);
  const locations = useLocations(ctx, shopId);
  const mine = myLocations(me, locations);
  const options = [...(seesAll(me) && mine.length > 1 ? [{ value: ALL, label: t('allLocations') }] : []), ...mine.map((l) => ({ value: l.id, label: localName(l) }))];
  if (!options.some((o) => o.value === filters.loc)) filters.loc = options[0]?.value || null;
  const back = `#/shop/${shopId}`;
  if (!filters.loc) {
    root.replaceChildren(header(t('dashboard'), { back }), el('main', { class: 'page' }, el('p', { class: 'empty' }, t('noStockLocations'))));
    return;
  }

  const months = last12Months();
  const start = `${months[0].key}-01`;
  const stats = ctx.live(`dash:${filters.loc}:${start}`, (set) => watchCollection(['shops', shopId, 'dailyStats'], set,
    ...(filters.loc === ALL ? [] : [where('locationId', '==', filters.loc)]), where('date', '>=', start)));
  const products = useProducts(ctx, shopId);
  const categories = useCategories(ctx, shopId);
  const stock = useStock(ctx, shopId);
  const customers = useCustomers(ctx, shopId);
  const custAccounts = useCustomerAccounts(ctx, shopId);
  const costList = costs ? useCosts(ctx, shopId) : [];
  const suppAccounts = costs ? useAccounts(ctx, shopId) : [];
  const suppliers = useSuppliers(ctx, shopId);

  const locSel = el('select', { class: 'input select', 'aria-label': t('location') }, options.map((o) => el('option', { value: o.value, selected: o.value === filters.loc }, o.label)));
  locSel.addEventListener('change', () => { filters.loc = locSel.value; ctx.rerender(); });
  const periodSel = el('select', { class: 'input select', 'aria-label': t('period') },
    ['today', 'month', 'lastMonth', 'last30'].map((p) => el('option', { value: p, selected: p === filters.period }, t(`period_${p}`))));
  periodSel.addEventListener('change', () => { filters.period = periodSel.value; ctx.rerender(); });
  const top = el('div', { class: 'filters two' }, el('span', { class: 'select-wrap' }, locSel), el('span', { class: 'select-wrap' }, periodSel));

  if (!stats || !products || !stock || !locations || !custAccounts || (costs && (!costList || !suppAccounts))) {
    root.replaceChildren(header(t('dashboard'), { back }), el('main', { class: 'page wide' }, top, el('p', { class: 'empty' }, t('loading'))));
    return;
  }

  const [from, to] = periodRange(filters.period);
  const locIds = filters.loc === ALL ? mine.map((l) => l.id) : [filters.loc];
  const period = sumStats(stats.filter((d) => d.date >= from && d.date <= to));
  const costOf = new Map((costList || []).map((c) => [c.id, c]));
  const netSales = round2(period.sales - period.returns);
  const { gp, missing } = grossProfit(period.items, costOf);
  const map = stockMap(stock);
  const active = products.filter((p) => p.active !== false);
  const stockValue = round2(active.reduce((s, p) => s + locIds.reduce((q, l) => q + Math.max(qtyAt(map.get(p.id), l), 0), 0) * (costOf.get(p.id)?.avgCost || 0), 0));
  const lowCount = active.filter((p) => locIds.some((l) => isLow(p, map.get(p.id), l))).length;
  const owedByCustomers = round2(custAccounts.reduce((s, a) => s + Math.max(a.balance || 0, 0), 0));
  const owedToSuppliers = round2((suppAccounts || []).reduce((s, a) => s + Math.max(a.balance || 0, 0), 0));
  const productName = (id) => localName(products.find((p) => p.id === id)) || t('unknownProduct');
  const best = [...period.items.entries()].filter(([, v]) => v.q > 0).sort((a, b) => b[1].rev - a[1].rev).slice(0, 10);

  const kpi = (label, value, opts = {}) => el(opts.href ? 'a' : 'div', { class: `card kpi ${opts.cls || ''}`, href: opts.href },
    el('span', { class: 'muted small' }, label),
    el('strong', {}, value),
    opts.sub ? el('span', { class: 'muted small' }, opts.sub) : null,
  );

  // Monthly chart: net sales, and gross profit for people who can see costs.
  const perMonth = months.map((m) => {
    const s = sumStats(stats.filter((d) => d.date.startsWith(m.key)));
    return { ...m, sales: round2(s.sales - s.returns), profit: costs ? grossProfit(s.items, costOf).gp : null };
  });

  const exportBtn = (label, make) => {
    const b = el('button', { type: 'button', class: 'btn ghost' }, icon('copy'), label);
    b.addEventListener('click', () => busy(b, async () => {
      if (!navigator.onLine) return toast(t('needOnline'), 'error');
      try {
        const [name, text] = await make();
        download(name, text);
      } catch (err) {
        toast(err.code === 'failed-precondition' ? t('indexNeeded') : errorText(err), 'error');
      }
    }));
    return b;
  };
  const locArg = filters.loc === ALL ? null : filters.loc;
  const tag = `${from}_${to}`;

  root.replaceChildren(
    header(t('dashboard'), { back }),
    el('main', { class: 'page wide' },
      top,
      el('p', { class: 'muted small' }, t('periodRange', { from, to })),
      el('div', { class: 'kpis' },
        kpi(t('netSales'), fmtMoney(netSales), { cls: 'main', sub: t('salesCount', { n: fmtNum(period.count) }) }),
        costs ? kpi(t('grossProfit'), fmtMoney(gp), { cls: gp < 0 ? 'bad' : 'good', sub: netSales ? `${fmtNum((gp / netSales) * 100, 1)}%` : '' }) : null,
        kpi(t('expenses'), fmtMoney(period.expenses), { href: `#/shop/${shopId}/expenses` }),
        costs ? kpi(t('netProfit'), fmtMoney(round2(gp - period.expenses)), { cls: gp - period.expenses < 0 ? 'bad' : 'good' }) : null,
        kpi(t('returnsTitle'), fmtMoney(period.returns)),
        kpi(t('creditGiven'), fmtMoney(period.credit)),
      ),
      el('div', { class: 'kpis' },
        costs ? kpi(t('stockValue'), fmtMoney(stockValue), { href: `#/shop/${shopId}/stock` }) : null,
        kpi(t('owedByCustomers'), fmtMoney(owedByCustomers), { href: `#/shop/${shopId}/customers` }),
        costs ? kpi(t('owedToSuppliers'), fmtMoney(owedToSuppliers), { href: `#/shop/${shopId}/suppliers` }) : null,
        kpi(t('lowStockItems'), fmtNum(lowCount), { href: `#/shop/${shopId}/stock`, cls: lowCount ? 'warn' : '' }),
      ),
      costs && missing ? el('p', { class: 'muted small' }, t('profitNoteMissing', { n: fmtNum(missing) })) : null,
      costs ? el('p', { class: 'muted small' }, t('profitNote')) : null,
      el('section', { class: 'card' },
        el('h2', { class: 'section-title' }, t('monthlyChart')),
        monthlyChart(perMonth, costs),
      ),
      el('section', { class: 'card' },
        el('h2', { class: 'section-title' }, t('bestSellers')),
        best.length
          ? el('div', { class: 'best' }, best.map(([pid, v], i) => el('div', { class: 'sum-line' },
            el('span', {}, `${fmtNum(i + 1)}. ${productName(pid)} × ${fmtNum(v.q, 3)}`),
            el('strong', {}, fmtMoney(v.rev)),
          )))
          : el('p', { class: 'muted' }, t('noSales')),
      ),
      el('section', { class: 'card form' },
        el('h2', { class: 'section-title' }, t('exportCsv')),
        el('p', { class: 'muted small' }, t('exportHint')),
        el('div', { class: 'export-grid' },
          exportBtn(t('sales'), async () => [`dokan-sales-${tag}.csv`, await salesCsv(shopId, { from, to, locId: locArg, products, locations, customers })]),
          exportBtn(t('expenses'), async () => [`dokan-expenses-${tag}.csv`, await expensesCsv(shopId, { from, to, locId: locArg, locations })]),
          costs ? exportBtn(t('purchases'), async () => [`dokan-purchases-${tag}.csv`, await purchasesCsv(shopId, { from, to, products, locations, suppliers })]) : null,
          exportBtn(t('products'), async () => [`dokan-products-${today()}.csv`, productsCsv({ products, categories, locations, stock, costs: costs ? costList : null })]),
          exportBtn(t('customers'), async () => [`dokan-customers-${today()}.csv`, customersCsv({ customers, accounts: custAccounts })]),
        ),
      ),
    ),
  );
}

// Simple bar chart in SVG: one bar per month for net sales, a thinner one for gross profit.
function monthlyChart(data, withProfit) {
  const W = 640;
  const H = 220;
  const pad = { top: 16, bottom: 28, side: 8 };
  const max = Math.max(1, ...data.map((d) => Math.max(d.sales, d.profit || 0)));
  const slot = (W - pad.side * 2) / data.length;
  const scale = (v) => (Math.max(v, 0) / max) * (H - pad.top - pad.bottom);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'chart');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', t('monthlyChart'));
  const add = (tag, attrs, text) => {
    const n = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text != null) n.textContent = text;
    svg.append(n);
    return n;
  };
  add('line', { x1: pad.side, x2: W - pad.side, y1: H - pad.bottom, y2: H - pad.bottom, class: 'axis' });
  data.forEach((d, i) => {
    const x = pad.side + i * slot;
    const bw = withProfit ? slot * 0.38 : slot * 0.6;
    const h1 = scale(d.sales);
    const bar = add('rect', { x: x + slot * (withProfit ? 0.1 : 0.2), y: H - pad.bottom - h1, width: bw, height: h1, rx: 3, class: 'bar-sales' });
    bar.append(Object.assign(document.createElementNS(ns, 'title'), { textContent: `${d.label} · ${t('netSales')}: ${fmtMoney(d.sales)}` }));
    if (withProfit) {
      const h2 = scale(d.profit);
      const pb = add('rect', { x: x + slot * 0.52, y: H - pad.bottom - h2, width: bw, height: h2, rx: 3, class: 'bar-profit' });
      pb.append(Object.assign(document.createElementNS(ns, 'title'), { textContent: `${d.label} · ${t('grossProfit')}: ${fmtMoney(d.profit)}` }));
    }
    add('text', { x: x + slot / 2, y: H - 8, 'text-anchor': 'middle', class: 'chart-label' }, d.label);
  });
  const legend = el('div', { class: 'legend' },
    el('span', {}, el('i', { class: 'sw sales' }), t('netSales')),
    withProfit ? el('span', {}, el('i', { class: 'sw profit' }), t('grossProfit')) : null,
    el('span', { class: 'muted small' }, t('chartMax', { n: fmtMoney(max) })),
  );
  return el('div', { class: 'chart-wrap' }, svg, legend);
}
