// Stock per location: list with low-stock warnings, per-product details, adjustments and transfers.
import { t, getLang, localName, errorText } from './i18n.js';
import { fmtNum, fmtDate, normalize, parseNum, getDigits } from './format.js';
import {
  el, icon, textField, numberField, selectField, setFieldError, openDialog, confirmAction, toast,
} from './forms.js';
import { watchCollection } from './sync.js';
import { isManager, canUseLocation } from './roles.js';
import { header } from './screens.js';
import { useProducts } from './products.js';
import { useLocations } from './locations.js';
import { commitMoves, productHistory, qtyAt, roundQty } from './movements.js';

const ALL = '__all';
const MAX_ROWS = 100;
export const REASONS = ['opening', 'damaged', 'lost', 'expired', 'found', 'correction', 'other'];

export function useStock(ctx, shopId) {
  return ctx.live(`stock:${shopId}`, (set) => watchCollection(['shops', shopId, 'stock'], set));
}

// Map productId → stock doc, for quick lookups.
export function stockMap(stock) {
  return new Map((stock || []).map((s) => [s.id, s]));
}

export function isLow(product, stockDoc, locId) {
  const level = product.lowStock?.[locId];
  return level != null && qtyAt(stockDoc, locId) <= level;
}

// Locations this member may see, active first.
export function myLocations(me, locations) {
  return (locations || []).filter((l) => canUseLocation(me, l.id) && l.active !== false);
}

const seesAll = (me) => me?.role === 'owner' || (me?.role === 'manager' && !me.branchIds?.length);

let view = null;
let chosenLoc = null;

export function renderStock(root, ctx, shopId) {
  const me = ctx.members.get(shopId);
  const products = useProducts(ctx, shopId);
  const stock = useStock(ctx, shopId);
  const locations = useLocations(ctx, shopId);
  const look = getLang() + getDigits();
  const data = { products, stock, locations };

  if (view && view.shopId === shopId && view.look === look && root.contains(view.page)) {
    view.update(data);
    return;
  }

  const locSelect = el('select', { class: 'input select' });
  const search = el('input', { type: 'search', class: 'input', placeholder: t('searchProducts'), autocomplete: 'off', enterkeyhint: 'search' });
  const lowBox = el('input', { type: 'checkbox' });
  const list = el('div', { class: 'list' });
  const footer = el('p', { class: 'muted small center' });
  let cur = data;

  function fillLocations() {
    const mine = myLocations(me, cur.locations);
    const opts = mine.map((l) => ({ value: l.id, label: `${localName(l)} · ${t(l.type)}` }));
    if (seesAll(me) && mine.length > 1) opts.unshift({ value: ALL, label: t('allLocationsTotal') });
    locSelect.replaceChildren(...opts.map((o) => el('option', { value: o.value }, o.label)));
    const keep = chosenLoc && opts.some((o) => o.value === chosenLoc) ? chosenLoc : opts[0]?.value || '';
    locSelect.value = keep;
    chosenLoc = keep;
  }

  function draw() {
    list.replaceChildren();
    footer.textContent = '';
    if (!cur.products || !cur.stock || !cur.locations) return list.append(el('p', { class: 'empty' }, t('loading')));
    const mine = myLocations(me, cur.locations);
    if (!mine.length) return list.append(el('p', { class: 'empty' }, t('noStockLocations')));
    const loc = locSelect.value;
    const map = stockMap(cur.stock);
    const q = normalize(search.value);
    const qtyFor = (p) => (loc === ALL ? roundQty(mine.reduce((s, l) => s + qtyAt(map.get(p.id), l.id), 0)) : qtyAt(map.get(p.id), loc));
    const lowFor = (p) => (loc === ALL ? mine.some((l) => isLow(p, map.get(p.id), l.id)) : isLow(p, map.get(p.id), loc));

    const rows = cur.products
      .filter((p) => p.active !== false)
      .filter((p) => !q || q.split(' ').every((w) => normalize(`${p.nameAr} ${p.nameEn} ${p.brand} ${p.barcode} ${p.sku}`).includes(w)))
      .filter((p) => !lowBox.checked || lowFor(p))
      .sort((a, b) => Number(lowFor(b)) - Number(lowFor(a)) || localName(a).localeCompare(localName(b)));

    if (!cur.products.length) return list.append(el('p', { class: 'empty' }, t('noProducts')));
    if (!rows.length) return list.append(el('p', { class: 'empty' }, t('noMatches')));
    for (const p of rows.slice(0, MAX_ROWS)) {
      const n = qtyFor(p);
      const low = lowFor(p);
      list.append(el('button', { type: 'button', class: `card row tap ${low ? 'is-low' : ''}`, onclick: () => productDialog(ctx, shopId, p) },
        el('span', { class: 'row-main' },
          el('strong', {}, localName(p)),
          el('span', { class: 'row-meta' },
            el('span', { class: 'muted small' }, t(`unit_${p.unit}`)),
            n < 0 ? el('span', { class: 'badge off' }, t('negativeBadge')) : low ? el('span', { class: 'badge low' }, t('lowBadge')) : null,
          ),
        ),
        el('span', { class: `qty ${n < 0 ? 'neg' : ''}` }, fmtNum(n, 3)),
      ));
    }
    if (rows.length > MAX_ROWS) footer.textContent = t('showingOf', { shown: fmtNum(MAX_ROWS), total: fmtNum(rows.length) });
  }

  locSelect.addEventListener('change', () => { chosenLoc = locSelect.value; draw(); });
  search.addEventListener('input', draw);
  lowBox.addEventListener('change', draw);
  fillLocations();
  draw();

  const page = el('main', { class: 'page' },
    el('div', { class: 'filters' },
      el('span', { class: 'select-wrap' }, locSelect),
      el('label', { class: 'search-box' }, icon('search'), search),
      el('label', { class: 'check inline' }, lowBox, el('span', { class: 'check-text' }, t('lowOnly'))),
    ),
    list,
    footer,
    isManager(me) ? el('a', { class: 'btn ghost', href: `#/shop/${shopId}/count` }, icon('box'), t('stockCount')) : null,
  );
  root.replaceChildren(header(t('stock'), { back: `#/shop/${shopId}` }), page);

  view = { shopId, look, page, update(next) { cur = next; fillLocations(); draw(); } };
}

// ---------- Product details ----------

function productDialog(ctx, shopId, p) {
  const me = ctx.members.get(shopId);
  const mine = myLocations(me, useLocations(ctx, shopId));
  const stockDoc = stockMap(useStock(ctx, shopId)).get(p.id);
  const locName = (id) => localName((useLocations(ctx, shopId) || []).find((l) => l.id === id)) || '—';

  openDialog(localName(p), (body, close) => {
    body.append(
      el('div', { class: 'qty-table' }, mine.map((l) => el('div', { class: `qty-line ${isLow(p, stockDoc, l.id) ? 'is-low' : ''}` },
        el('span', {}, localName(l)),
        el('strong', { class: qtyAt(stockDoc, l.id) < 0 ? 'neg' : '' }, `${fmtNum(qtyAt(stockDoc, l.id), 3)} ${t(`unit_${p.unit}`)}`),
      ))),
      isManager(me)
        ? el('div', { class: 'actions' },
          mine.length > 1 ? el('button', { type: 'button', class: 'btn ghost', onclick: () => { close(); transferDialog(ctx, shopId, p); } }, t('transfer')) : null,
          el('button', { type: 'button', class: 'btn primary', onclick: () => { close(); adjustDialog(ctx, shopId, p); } }, t('adjust')),
        )
        : el('p', { class: 'muted small' }, t('manageStockOnly')),
      el('h3', { class: 'section-title' }, t('history')),
    );
    const historyBox = el('div', { class: 'history' }, el('p', { class: 'muted small' }, t('loading')));
    body.append(historyBox);

    productHistory(shopId, p.id).then((moves) => {
      historyBox.replaceChildren();
      if (!moves.length) return historyBox.append(el('p', { class: 'muted small' }, t('noHistory')));
      for (const m of moves) {
        const arrow = getLang() === 'ar' ? '←' : '→';
        const where_ = m.type === 'transfer' ? `${locName(m.from)} ${arrow} ${locName(m.to)}` : locName(m.to || m.from);
        const sign = m.type === 'transfer' ? '' : m.to ? '+' : '−';
        historyBox.append(el('div', { class: 'history-line' },
          el('span', { class: 'history-main' },
            el('strong', {}, t(`move_${m.type}`) + (m.reason && m.reason !== m.type ? ` · ${t(`reason_${m.reason}`)}` : '')),
            el('span', { class: 'muted small' }, `${where_} · ${fmtDate(m.at || m.clientAt)}${m.note ? ` · ${m.note}` : ''}`),
          ),
          el('span', { class: `qty small ${sign === '−' ? 'neg' : ''}` }, `${sign}${fmtNum(m.qty, 3)}`),
        ));
      }
    }).catch((err) => {
      historyBox.replaceChildren(el('p', { class: 'form-error' }, err.code === 'failed-precondition' ? t('historyIndex') : errorText(err)));
    });
  });
}

const locOptions = (locs) => locs.map((l) => ({ value: l.id, label: `${localName(l)} · ${t(l.type)}` }));

function adjustDialog(ctx, shopId, p) {
  const me = ctx.members.get(shopId);
  const mine = myLocations(me, useLocations(ctx, shopId));
  const start = chosenLoc && mine.some((l) => l.id === chosenLoc) ? chosenLoc : mine[0]?.id;

  openDialog(`${t('adjust')} · ${localName(p)}`, (body, close) => {
    const onHand = el('p', { class: 'muted small' });
    const form = el('form', { class: 'form', novalidate: true },
      selectField({ name: 'loc', label: t('location'), value: start, options: locOptions(mine) }),
      onHand,
      selectField({ name: 'dir', label: t('direction'), value: 'add', options: [
        { value: 'add', label: t('dirAdd') }, { value: 'remove', label: t('dirRemove') }, { value: 'set', label: t('dirSet') },
      ] }),
      numberField({ name: 'qty', label: t('qty') }),
      selectField({ name: 'reason', label: t('reason'), value: 'opening', options: REASONS.map((r) => ({ value: r, label: t(`reason_${r}`) })) }),
      textField({ name: 'note', label: t('note') }),
      el('div', { class: 'actions' },
        el('button', { type: 'button', class: 'btn ghost', onclick: close }, t('cancel')),
        el('button', { type: 'submit', class: 'btn primary' }, t('save')),
      ),
    );
    const f = form.elements;
    // Read the latest stock each time, in case it changed while the dialog was open.
    const current = () => qtyAt(stockMap(useStock(ctx, shopId)).get(p.id), f.loc.value);
    const showOnHand = () => { onHand.textContent = `${t('onHand')}: ${fmtNum(current(), 3)} ${t(`unit_${p.unit}`)}`; };
    const qtyLabel = () => { form.querySelector('[name=qty]').closest('.field').querySelector('.field-label').textContent = f.dir.value === 'set' ? t('newQty') : t('qty'); };
    f.loc.addEventListener('change', showOnHand);
    f.dir.addEventListener('change', qtyLabel);
    showOnHand();

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const n = parseNum(f.qty.value);
      const dir = f.dir.value;
      const bad = Number.isNaN(n) || n < 0 || (dir !== 'set' && n === 0);
      setFieldError(form, 'qty', bad ? t('qtyPositive') : '');
      if (bad) return;
      const delta = dir === 'add' ? n : dir === 'remove' ? -n : roundQty(n - current());
      if (delta === 0) return setFieldError(form, 'qty', t('noChange'));
      const loc = f.loc.value;
      commitMoves(shopId, [{
        type: 'adjust',
        productId: p.id,
        from: delta < 0 ? loc : null,
        to: delta > 0 ? loc : null,
        qty: Math.abs(delta),
        reason: f.reason.value,
        note: f.note.value.trim(),
      }], ctx.user.uid).catch((err) => toast(errorText(err), 'error'));
      toast(t('stockSaved'));
      close();
    });
    body.append(form);
  });
}

function transferDialog(ctx, shopId, p) {
  const me = ctx.members.get(shopId);
  const mine = myLocations(me, useLocations(ctx, shopId));
  const from = chosenLoc && mine.some((l) => l.id === chosenLoc) ? chosenLoc : mine[0]?.id;
  const to = mine.find((l) => l.id !== from)?.id;

  openDialog(`${t('transfer')} · ${localName(p)}`, (body, close) => {
    const onHand = el('p', { class: 'muted small' });
    const form = el('form', { class: 'form', novalidate: true },
      selectField({ name: 'from', label: t('fromLoc'), value: from, options: locOptions(mine) }),
      onHand,
      selectField({ name: 'to', label: t('toLoc'), value: to, options: locOptions(mine) }),
      numberField({ name: 'qty', label: t('qty') }),
      textField({ name: 'note', label: t('note') }),
      el('p', { class: 'form-error', role: 'alert' }),
      el('div', { class: 'actions' },
        el('button', { type: 'button', class: 'btn ghost', onclick: close }, t('cancel')),
        el('button', { type: 'submit', class: 'btn primary' }, t('transfer')),
      ),
    );
    const f = form.elements;
    const available = () => qtyAt(stockMap(useStock(ctx, shopId)).get(p.id), f.from.value);
    const showOnHand = () => { onHand.textContent = `${t('onHand')}: ${fmtNum(available(), 3)} ${t(`unit_${p.unit}`)}`; };
    f.from.addEventListener('change', showOnHand);
    showOnHand();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const n = parseNum(f.qty.value);
      const bad = Number.isNaN(n) || n <= 0;
      setFieldError(form, 'qty', bad ? t('qtyPositive') : '');
      form.querySelector('.form-error').textContent = f.from.value === f.to.value ? t('sameLocation') : '';
      if (bad || f.from.value === f.to.value) return;
      if (n > available()) {
        const fromName = localName(mine.find((l) => l.id === f.from.value));
        const yes = await confirmAction({ title: t('transfer'), message: t('moreThanAvailable', { loc: fromName, n: fmtNum(available(), 3) }), confirmLabel: t('continueAnyway') });
        if (!yes) return;
      }
      commitMoves(shopId, [{ type: 'transfer', productId: p.id, from: f.from.value, to: f.to.value, qty: n, reason: 'transfer', note: f.note.value.trim() }], ctx.user.uid)
        .catch((err) => toast(errorText(err), 'error'));
      toast(t('stockSaved'));
      close();
    });
    body.append(form);
  });
}
