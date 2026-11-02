// The shop home card: today at a glance. Today's sales against yesterday, cash taken, low stock,
// what customers owe, the dollar rate and its move, and invoices waiting for prices.
import { t, getLang } from './i18n.js';
import { fmtMoney, fmtNum } from './format.js';
import { el } from './forms.js';
import { where, orderBy, limit } from './firebase.js';
import { watchCollection } from './sync.js';
import { isManager, isCostManager } from './roles.js';
import { useProducts } from './products.js';
import { useStock, stockMap, myLocations, isLow } from './stock.js';
import { useLocations } from './locations.js';
import { useCustomerAccounts, scopeFilters } from './customers.js';
import { today } from './suppliers.js';
import { round2 } from './buying.js';

function yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const sum = (days, fn) => round2(days.reduce((s, d) => s + fn(d), 0));
const net = (d) => (d.sales || 0) - (d.returns || 0);
const cashTaken = (d) => (d.pay?.cash || 0) + (d.collected?.cash || 0) - (d.paidOut?.cash || 0);

function changeBadge(now, before) {
  if (!before) return null;
  const pct = ((now - before) / Math.abs(before)) * 100;
  if (Math.abs(pct) < 0.05) return null;
  return el('span', { class: `small ${pct > 0 ? 'pos' : 'neg'}` }, `${pct > 0 ? '▲' : '▼'} ${fmtNum(Math.abs(pct), 1)}%`);
}

const stat = (label, value, { href, sub, cls = '' } = {}) => el(href ? 'a' : 'div', { class: `home-stat ${cls}`, href },
  el('span', { class: 'muted small' }, label),
  el('strong', {}, value),
  sub || null,
);

export function homeSummary(ctx, shopId) {
  const me = ctx.members.get(shopId);
  const shop = ctx.shops.get(shopId);
  const manager = isManager(me);
  const costs = isCostManager(me);
  const day = today();
  const prev = yesterday();

  const days = ctx.live(`home:${shopId}:${prev}`, (set) => watchCollection(['shops', shopId, 'dailyStats'], set, where('date', '>=', prev), ...scopeFilters(me)));
  const products = useProducts(ctx, shopId);
  const stock = useStock(ctx, shopId);
  const locations = useLocations(ctx, shopId);
  const accounts = useCustomerAccounts(ctx, shopId);
  const rates = ctx.live(`homeRates:${shopId}`, (set) => watchCollection(['shops', shopId, 'fxRates'], set, orderBy('date', 'desc'), limit(2)));
  const waiting = costs
    ? ctx.live(`purchasesPending:${shopId}`, (set) => watchCollection(['shops', shopId, 'purchases'], set, where('status', '==', 'received')))
    : [];

  const todays = (days || []).filter((d) => d.date === day);
  const before = (days || []).filter((d) => d.date === prev);
  const salesToday = sum(todays, net);
  const count = todays.reduce((s, d) => s + (d.count || 0), 0);

  const mine = myLocations(me, locations).map((l) => l.id);
  const map = stockMap(stock);
  const low = (products || []).filter((p) => p.active !== false && mine.some((l) => isLow(p, map.get(p.id), l))).length;
  const owed = round2((accounts || []).reduce((s, a) => s + Math.max(a.balance || 0, 0), 0));

  const rate = shop?.settings?.usdRate;
  const prevRate = (rates || []).find((r) => r.date !== shop?.settings?.rateDate)?.rate;
  const time = new Intl.DateTimeFormat(getLang() === 'ar' ? 'ar-EG' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  const loading = !days || !products || !stock || !accounts;

  return el('div', { class: 'home-summary' },
    el('p', { class: 'muted small' }, time),
    el('div', { class: 'home-today' },
      el('span', { class: 'muted small' }, t('todaySales')),
      el('strong', { class: 'big-money' }, loading ? '…' : fmtMoney(salesToday)),
      el('span', { class: 'row-meta' },
        el('span', { class: 'muted small' }, t('salesCount', { n: fmtNum(count) })),
        loading ? null : changeBadge(salesToday, sum(before, net)),
        loading || !before.length ? null : el('span', { class: 'muted small' }, t('vsYesterday', { n: fmtMoney(sum(before, net)) })),
      ),
    ),
    el('div', { class: 'home-stats' },
      stat(t('cashToday'), loading ? '…' : fmtMoney(sum(todays, cashTaken)), { href: `#/shop/${shopId}/cash` }),
      stat(t('lowStockItems'), loading ? '…' : fmtNum(low), { href: `#/shop/${shopId}/stock`, cls: low ? 'warn' : '' }),
      stat(t('owedByCustomers'), loading ? '…' : fmtMoney(owed), { href: `#/shop/${shopId}/customers` }),
      rate ? stat(t('usdRateTitle'), `${fmtNum(rate, 2)} ${t('egp')}`, { href: manager ? `#/shop/${shopId}/rate` : null, sub: prevRate ? changeBadge(rate, prevRate) : null }) : null,
      costs && waiting?.length ? stat(t('waitingCosts'), fmtNum(waiting.length), { href: `#/shop/${shopId}/purchases`, cls: 'warn' }) : null,
    ),
  );
}
