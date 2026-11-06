// Dokan usage dashboard: how many people signed up, how many shops exist, and how active each
// shop is. Separate from the shop app; same Firebase project and the same sign-in.
// Only accounts listed in admins/{uid} (added by hand in the Firebase console) can load data.
// Everything is read with count/sum queries, which cost one read per 1,000 documents counted.
import { firebaseConfig, isConfigured } from '../config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js';
import {
  getFirestore, collection, doc, getDoc, getDocs, query, where, orderBy, limit, Timestamp,
  getCountFromServer, getAggregateFromServer, sum,
} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js';

const root = document.getElementById('app');
const WEEKS = 12;
const PARALLEL_SHOPS = 4;
const DAY = 864e5;

// ---------- Small helpers ----------

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

const numFmt = new Intl.NumberFormat('en-US');
const moneyFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const fmt = (n) => (n == null ? '—' : numFmt.format(n));
const money = (n) => (n == null ? '—' : `EGP ${moneyFmt.format(n)}`);
const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtDate = (d) => (d ? dateFmt.format(d) : '—');
const since = (days) => Timestamp.fromMillis(Date.now() - days * DAY);
const toDate = (ts) => (ts?.toDate ? ts.toDate() : null);
// dailyStats dates are the shop's local day, written as YYYY-MM-DD.
const dayString = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function ago(d) {
  if (!d) return 'never';
  const days = Math.floor((Date.now() - d.getTime()) / DAY);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return fmtDate(d);
}

function errorText(err) {
  if (err?.code === 'permission-denied') return 'Firestore refused the read. Publish the updated firestore.rules (they include the admin rules) and check your admins/{uid} document.';
  if (err?.code === 'failed-precondition') return `Firestore needs an index for this: ${err.message}`;
  if (err?.code === 'unavailable') return 'No connection to Firestore. Check your internet and refresh.';
  return err?.message || String(err);
}

// Runs fn over items, at most n at a time.
async function pool(items, n, fn) {
  let i = 0;
  const worker = async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
}

// ---------- Firebase ----------

if (!isConfigured) {
  root.replaceChildren(el('main', { class: 'page' }, el('p', { class: 'card' }, 'config.js has no Firebase settings yet.')));
  throw new Error('not configured');
}
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const count = async (q) => (await getCountFromServer(q)).data().count;

// ---------- Screens ----------

function topbar(user) {
  return el('header', { class: 'topbar' },
    el('div', { class: 'brand' }, el('img', { src: '../icon.svg', alt: '', width: 28, height: 28 }), el('strong', {}, 'Dokan'), el('span', { class: 'muted' }, 'Usage')),
    user ? el('div', { class: 'top-actions' },
      el('span', { class: 'muted small hide-sm' }, user.email),
      el('a', { class: 'btn ghost small', href: '../' }, 'Open the app'),
      el('button', { type: 'button', class: 'btn ghost small', onclick: () => signOut(auth) }, 'Sign out'),
    ) : null,
  );
}

function renderSignIn(message = '') {
  const email = el('input', { class: 'input', type: 'email', autocomplete: 'username', required: true, dir: 'ltr' });
  const password = el('input', { class: 'input', type: 'password', autocomplete: 'current-password', required: true, dir: 'ltr' });
  const error = el('p', { class: 'error', role: 'alert' }, message);
  const button = el('button', { class: 'btn primary' }, 'Sign in');
  const form = el('form', { class: 'card form narrow' },
    el('h1', {}, 'Usage dashboard'),
    el('p', { class: 'muted' }, 'Sign in with your Dokan account. Only admin accounts can see the data.'),
    el('label', { class: 'field' }, el('span', {}, 'Email'), email),
    el('label', { class: 'field' }, el('span', {}, 'Password'), password),
    error,
    button,
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    button.disabled = true;
    error.textContent = '';
    try {
      await signInWithEmailAndPassword(auth, email.value.trim(), password.value);
    } catch (err) {
      error.textContent = err?.code === 'auth/invalid-credential' ? 'Wrong email or password.' : errorText(err);
      button.disabled = false;
    }
  });
  root.replaceChildren(topbar(null), el('main', { class: 'page' }, form));
}

function renderNotAdmin(user) {
  const uid = el('code', { class: 'uid' }, user.uid);
  root.replaceChildren(topbar(user), el('main', { class: 'page' },
    el('section', { class: 'card form narrow' },
      el('h1', {}, 'Not an admin account'),
      el('p', {}, `${user.email} can't see the usage data yet. To allow it, in the Firebase console:`),
      el('ol', {},
        el('li', {}, 'Open Firestore Database → Data.'),
        el('li', {}, 'Start a collection named ', el('code', {}, 'admins'), '.'),
        el('li', {}, 'Use this account\'s UID as the document ID: ', uid, ' ', el('button', { type: 'button', class: 'btn ghost small', onclick: () => navigator.clipboard?.writeText(user.uid) }, 'Copy')),
        el('li', {}, 'Add any field, for example ', el('code', {}, 'note'), ' = ', el('code', {}, 'me'), ', and save.'),
        el('li', {}, 'Make sure the latest firestore.rules are published, then refresh this page.'),
      ),
    ),
  ));
}

// ---------- Dashboard ----------

const state = { shops: [], sort: 'activity', dir: -1, search: '', status: '' };

async function renderDashboard(user) {
  const updated = el('span', { class: 'muted small' }, 'Loading…');
  const refresh = el('button', { type: 'button', class: 'btn ghost small', onclick: () => renderDashboard(user) }, 'Refresh');
  const kpis = el('section', { class: 'kpis' });
  const charts = el('section', { class: 'charts' });
  const shopsBox = el('section', { class: 'card' });
  const usersBox = el('section', { class: 'card' });
  const errors = el('div', {});

  root.replaceChildren(topbar(user), el('main', { class: 'page wide' },
    el('div', { class: 'title-row' }, el('h1', {}, 'App usage'), el('div', { class: 'title-actions' }, updated, refresh)),
    errors,
    kpis,
    charts,
    shopsBox,
    usersBox,
  ));

  const fail = (where) => (err) => {
    console.error(where, err);
    errors.append(el('p', { class: 'card error' }, `${where}: ${errorText(err)}`));
  };

  kpis.replaceChildren(...['Registered users', 'Shops', 'Active shops (7 days)', 'Products', 'Stock movements', 'Sales (30 days)'].map((l) => kpi(l, '…')));
  shopsBox.replaceChildren(el('h2', {}, 'Shops'), el('p', { class: 'muted' }, 'Loading shops…'));
  usersBox.replaceChildren(el('h2', {}, 'Latest sign-ups'), el('p', { class: 'muted' }, 'Loading…'));

  const usersCol = collection(db, 'users');
  const shopsCol = collection(db, 'shops');

  // Totals and growth.
  const growth = loadGrowth(usersCol, shopsCol).catch(fail('Sign-ups'));
  // Shops and their activity.
  const shopsDone = loadShops(shopsCol, shopsBox, (done, total) => { updated.textContent = `Counting shop activity… ${done}/${total}`; })
    .catch(fail('Shops'));
  loadLatestUsers(usersCol, usersBox).catch(fail('Latest sign-ups'));

  const [g] = await Promise.all([growth, shopsDone]);
  drawKpis(kpis, g);
  if (g) drawCharts(charts, g);
  updated.textContent = `Updated ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

function kpi(label, value, sub) {
  return el('div', { class: 'card kpi' },
    el('span', { class: 'muted small' }, label),
    el('strong', {}, value),
    sub ? el('span', { class: 'muted small' }, sub) : null,
  );
}

async function loadGrowth(usersCol, shopsCol) {
  const [users, users7, users30, shops, shops7, shops30] = await Promise.all([
    count(usersCol),
    count(query(usersCol, where('createdAt', '>=', since(7)))),
    count(query(usersCol, where('createdAt', '>=', since(30)))),
    count(shopsCol),
    count(query(shopsCol, where('createdAt', '>=', since(7)))),
    count(query(shopsCol, where('createdAt', '>=', since(30)))),
  ]);
  // Sign-ups and new shops per week, oldest first; weeks end today.
  const weeks = [];
  for (let i = WEEKS - 1; i >= 0; i--) {
    const end = Date.now() - i * 7 * DAY;
    weeks.push({ start: new Date(end - 7 * DAY), end: new Date(end) });
  }
  const between = (col, w) => count(query(col,
    where('createdAt', '>=', Timestamp.fromDate(w.start)), where('createdAt', '<', Timestamp.fromDate(w.end))));
  const [userWeeks, shopWeeks] = await Promise.all([
    Promise.all(weeks.map((w) => between(usersCol, w))),
    Promise.all(weeks.map((w) => between(shopsCol, w))),
  ]);
  return { users, users7, users30, shops, shops7, shops30, weeks, userWeeks, shopWeeks };
}

function drawKpis(box, g) {
  const s = state.shops.filter((x) => x.stats);
  const total = (k) => s.reduce((a, x) => a + (x.stats[k] || 0), 0);
  const active = s.filter((x) => x.status === 'active').length;
  const inShops = new Set(s.flatMap((x) => x.memberIds)).size;
  box.replaceChildren(
    kpi('Registered users', g ? fmt(g.users) : '—', g ? `+${fmt(g.users7)} this week · +${fmt(g.users30)} in 30 days` : null),
    kpi('Users in a shop', fmt(inShops), g && g.users ? `${Math.round((inShops / g.users) * 100)}% of registered users` : null),
    kpi('Shops', g ? fmt(g.shops) : fmt(state.shops.length), g ? `+${fmt(g.shops7)} this week · +${fmt(g.shops30)} in 30 days` : null),
    kpi('Active shops (7 days)', fmt(active), s.length ? `${Math.round((active / s.length) * 100)}% of shops` : null),
    kpi('Products', fmt(total('products')), `${fmt(total('customers'))} customers`),
    kpi('Stock movements', fmt(total('movements')), `${fmt(total('moves7'))} in the last 7 days`),
    kpi('Sales (30 days)', fmt(total('sales30')), `${money(total('revenue30'))} net · ${fmt(total('sales'))} all time`),
  );
}

function barChart(title, values, weeks, total) {
  const max = Math.max(1, ...values);
  return el('div', { class: 'card chart' },
    el('div', { class: 'chart-head' }, el('h2', {}, title), el('span', { class: 'muted small' }, `${fmt(values.reduce((a, b) => a + b, 0))} in ${WEEKS} weeks · ${fmt(total)} total`)),
    el('div', { class: 'bars', role: 'img', 'aria-label': `${title} per week: ${values.join(', ')}` },
      values.map((v, i) => el('div', { class: 'bar-col', title: `${fmtDate(weeks[i].start)} – ${fmtDate(weeks[i].end)}: ${v}` },
        el('span', { class: 'bar-val' }, v ? fmt(v) : ''),
        el('span', { class: 'bar', style: `height:${Math.max(v ? 4 : 1, (v / max) * 100)}%` }),
      )),
    ),
    el('div', { class: 'bar-axis muted small' }, el('span', {}, fmtDate(weeks[0].start)), el('span', {}, 'this week')),
  );
}

function drawCharts(box, g) {
  box.replaceChildren(
    barChart('Sign-ups per week', g.userWeeks, g.weeks, g.users),
    barChart('New shops per week', g.shopWeeks, g.weeks, g.shops),
  );
}

// ---------- Shops ----------

async function loadShops(shopsCol, box, progress) {
  const snap = await getDocs(shopsCol);
  const owners = new Map();
  state.shops = snap.docs.map((d) => {
    const s = d.data();
    return { id: d.id, name: s.nameEn || s.nameAr || d.id, nameAr: s.nameAr, ownerId: s.ownerId, created: toDate(s.createdAt), stats: null, memberIds: [], status: 'loading' };
  });
  drawShops(box);

  let done = 0;
  progress(0, state.shops.length);
  await pool(state.shops, PARALLEL_SHOPS, async (shop) => {
    try {
      if (shop.ownerId && !owners.has(shop.ownerId)) {
        owners.set(shop.ownerId, getDoc(doc(db, 'users', shop.ownerId)).then((u) => u.data()?.email || '').catch(() => ''));
      }
      const [stats, ownerEmail] = await Promise.all([shopStats(shop.id), owners.get(shop.ownerId) || '']);
      Object.assign(shop, stats, { ownerEmail });
    } catch (err) {
      shop.error = errorText(err);
      shop.status = 'error';
    }
    progress(++done, state.shops.length);
    drawShops(box);
  });
}

async function shopStats(shopId) {
  const sub = (name) => collection(db, 'shops', shopId, name);
  const latest = (name) => getDocs(query(sub(name), orderBy('at', 'desc'), limit(1))).then((s) => toDate(s.docs[0]?.data().at));
  const from30 = dayString(new Date(Date.now() - 29 * DAY));
  const [members, locations, products, customers, movements, moves7, sales, sales30, money30, lastMove, lastSale] = await Promise.all([
    getDocs(sub('members')),
    count(sub('locations')),
    count(sub('products')),
    count(sub('customers')),
    count(sub('movements')),
    count(query(sub('movements'), where('at', '>=', since(7)))),
    count(sub('sales')),
    count(query(sub('sales'), where('at', '>=', since(30)))),
    getAggregateFromServer(query(sub('dailyStats'), where('date', '>=', from30)), { s: sum('sales'), r: sum('returns') }).then((a) => a.data()),
    latest('movements'),
    latest('sales'),
  ]);
  const lastActivity = [lastMove, lastSale].filter(Boolean).sort((a, b) => b - a)[0] || null;
  const days = lastActivity ? (Date.now() - lastActivity.getTime()) / DAY : Infinity;
  let status = 'new';
  if (lastActivity) status = days <= 7 ? 'active' : days <= 30 ? 'quiet' : 'inactive';
  const active = members.docs.filter((m) => m.data().disabled !== true);
  return {
    memberIds: active.map((m) => m.id),
    lastActivity,
    status,
    stats: {
      members: active.length,
      locations,
      products,
      customers,
      movements,
      moves7,
      sales,
      sales30,
      revenue30: (money30.s || 0) - (money30.r || 0),
    },
  };
}

const STATUS = {
  active: ['Active', 'Activity in the last 7 days'],
  quiet: ['Quiet', 'Last activity 8–30 days ago'],
  inactive: ['Inactive', 'No activity for over 30 days'],
  new: ['Not started', 'No stock movements or sales yet'],
  loading: ['…', 'Counting'],
  error: ['Error', ''],
};
const STATUS_ORDER = { active: 0, quiet: 1, inactive: 2, new: 3, loading: 4, error: 5 };

const COLUMNS = [
  { key: 'name', label: 'Shop', value: (s) => s.name.toLowerCase() },
  { key: 'activity', label: 'Last activity', value: (s) => s.lastActivity?.getTime() ?? -1 },
  { key: 'members', label: 'Team', num: true },
  { key: 'locations', label: 'Branches', num: true },
  { key: 'products', label: 'Products', num: true },
  { key: 'movements', label: 'Movements', num: true, sub: (s) => `${fmt(s.stats.moves7)} in 7 d` },
  { key: 'sales', label: 'Sales', num: true, sub: (s) => `${fmt(s.stats.sales30)} in 30 d` },
  { key: 'revenue30', label: 'Net sales 30 d', num: true, show: (s) => money(s.stats.revenue30) },
  { key: 'created', label: 'Created', value: (s) => s.created?.getTime() ?? 0 },
];

function sortValue(col, s) {
  if (col.value) return col.value(s);
  return s.stats ? s.stats[col.key] ?? 0 : -1;
}

function visibleShops() {
  const q = state.search.trim().toLowerCase();
  const col = COLUMNS.find((c) => c.key === state.sort) || COLUMNS[1];
  return state.shops
    .filter((s) => !state.status || s.status === state.status)
    .filter((s) => !q || `${s.name} ${s.nameAr || ''} ${s.ownerEmail || ''}`.toLowerCase().includes(q))
    .sort((a, b) => {
      const x = sortValue(col, a);
      const y = sortValue(col, b);
      return (x < y ? -1 : x > y ? 1 : 0) * state.dir;
    });
}

let shopsUi = null;
function drawShops(box) {
  if (!shopsUi || !box.contains(shopsUi.table)) {
    const search = el('input', { class: 'input', type: 'search', placeholder: 'Search shop or owner email', value: state.search });
    search.addEventListener('input', () => { state.search = search.value; drawShops(box); });
    const status = el('select', { class: 'input' },
      el('option', { value: '' }, 'All statuses'),
      ['active', 'quiet', 'inactive', 'new'].map((k) => el('option', { value: k, selected: state.status === k }, STATUS[k][0])),
    );
    status.addEventListener('change', () => { state.status = status.value; drawShops(box); });
    const table = el('table', { class: 'shops' });
    const summary = el('p', { class: 'muted small' });
    shopsUi = { table, summary };
    box.replaceChildren(
      el('div', { class: 'chart-head' }, el('h2', {}, 'Shops'), el('button', { type: 'button', class: 'btn ghost small', onclick: exportCsv }, 'Export CSV')),
      el('div', { class: 'filters' }, search, status),
      summary,
      el('div', { class: 'table-wrap' }, table),
      el('p', { class: 'muted small' }, 'Active: activity in the last 7 days. Quiet: 8–30 days. Inactive: over 30 days. Not started: no stock movements or sales yet. Activity means a stock movement (purchase, sale, adjustment, transfer, count) or a sale.'),
    );
  }
  const { table, summary } = shopsUi;
  const rows = visibleShops();
  const counts = state.shops.reduce((a, s) => ({ ...a, [s.status]: (a[s.status] || 0) + 1 }), {});
  summary.textContent = `${fmt(rows.length)} of ${fmt(state.shops.length)} shops · ${['active', 'quiet', 'inactive', 'new'].map((k) => `${fmt(counts[k] || 0)} ${STATUS[k][0].toLowerCase()}`).join(' · ')}`;

  const head = el('tr', {}, COLUMNS.map((c) => {
    const on = state.sort === c.key;
    return el('th', { class: c.num ? 'num' : '', 'aria-sort': on ? (state.dir > 0 ? 'ascending' : 'descending') : null },
      el('button', { type: 'button', class: 'sort', onclick: () => {
        if (state.sort === c.key) state.dir = -state.dir; else { state.sort = c.key; state.dir = c.key === 'name' ? 1 : -1; }
        drawShops(box);
      } }, c.label, on ? (state.dir > 0 ? ' ▲' : ' ▼') : ''));
  }));

  const body = rows.map((s) => el('tr', {},
    COLUMNS.map((c) => {
      if (c.key === 'name') {
        return el('td', {},
          el('strong', {}, s.name),
          s.nameAr && s.nameAr !== s.name ? el('span', { class: 'muted small ar', dir: 'rtl' }, ` ${s.nameAr}`) : null,
          el('div', { class: 'muted small' }, s.ownerEmail || ''),
          s.error ? el('div', { class: 'error small' }, s.error) : null,
        );
      }
      if (c.key === 'activity') {
        return el('td', {}, el('span', { class: `status ${s.status}`, title: STATUS[s.status][1] }, STATUS[s.status][0]), el('div', { class: 'muted small' }, s.stats ? ago(s.lastActivity) : ''));
      }
      if (c.key === 'created') return el('td', { class: 'muted small' }, fmtDate(s.created));
      if (!s.stats) return el('td', { class: 'num muted' }, '…');
      return el('td', { class: 'num' },
        c.show ? c.show(s) : fmt(s.stats[c.key]),
        c.sub ? el('div', { class: 'muted small' }, c.sub(s)) : null,
      );
    }),
  ));
  table.replaceChildren(el('thead', {}, head), el('tbody', {}, body.length ? body : el('tr', {}, el('td', { colspan: COLUMNS.length, class: 'muted' }, state.shops.length ? 'No shops match.' : 'No shops yet.'))));
}

function exportCsv() {
  const cell = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ['Shop', 'Arabic name', 'Owner', 'Status', 'Last activity', 'Team', 'Branches', 'Products', 'Customers', 'Movements', 'Movements 7 days', 'Sales', 'Sales 30 days', 'Net sales 30 days (EGP)', 'Created'];
  const iso = (d) => (d ? d.toISOString().slice(0, 10) : '');
  const lines = visibleShops().map((s) => [
    s.name, s.nameAr, s.ownerEmail, STATUS[s.status][0], iso(s.lastActivity),
    s.stats?.members, s.stats?.locations, s.stats?.products, s.stats?.customers, s.stats?.movements, s.stats?.moves7,
    s.stats?.sales, s.stats?.sales30, s.stats ? Math.round(s.stats.revenue30 * 100) / 100 : '', iso(s.created),
  ].map(cell).join(','));
  const blob = new Blob(['\uFEFF', [head.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `dokan-shops-${dayString(new Date())}.csv` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- Latest users ----------

async function loadLatestUsers(usersCol, box) {
  const snap = await getDocs(query(usersCol, orderBy('createdAt', 'desc'), limit(15)));
  const rows = snap.docs.map((d) => {
    const u = d.data();
    const shops = Array.isArray(u.shopIds) ? u.shopIds.length : 0;
    return el('tr', {},
      el('td', {}, el('strong', {}, u.name || '—'), el('div', { class: 'muted small' }, u.email || d.id)),
      el('td', { class: 'num' }, fmt(shops)),
      el('td', {}, u.lang === 'en' ? 'English' : 'Arabic'),
      el('td', { class: 'muted small' }, fmtDate(toDate(u.createdAt))),
    );
  });
  box.replaceChildren(
    el('h2', {}, 'Latest sign-ups'),
    el('div', { class: 'table-wrap' }, el('table', { class: 'shops' },
      el('thead', {}, el('tr', {}, el('th', {}, 'User'), el('th', { class: 'num' }, 'Shops'), el('th', {}, 'Language'), el('th', {}, 'Signed up'))),
      el('tbody', {}, rows.length ? rows : el('tr', {}, el('td', { colspan: 4, class: 'muted' }, 'No users yet.'))),
    )),
  );
}

// ---------- Start ----------

onAuthStateChanged(auth, async (user) => {
  if (!user) return renderSignIn();
  root.replaceChildren(topbar(user), el('main', { class: 'page' }, el('p', { class: 'boot' }, 'Checking access…')));
  try {
    const me = await getDoc(doc(db, 'admins', user.uid));
    if (!me.exists()) return renderNotAdmin(user);
  } catch (err) {
    if (err?.code === 'permission-denied') return renderNotAdmin(user);
    root.replaceChildren(topbar(user), el('main', { class: 'page' }, el('p', { class: 'card error' }, errorText(err))));
    return;
  }
  renderDashboard(user);
});
