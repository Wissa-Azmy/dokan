// Stock count: count a location shelf by shelf, then save the differences as adjustments.
import { t, getLang, localName, errorText } from './i18n.js';
import { fmtNum, fmtDate, normalize, parseNum, getDigits } from './format.js';
import { el, icon, iconButton, openDialog, confirmAction, toast, isTouch } from './forms.js';
import { watchCollection } from './sync.js';
import { where } from './firebase.js';
import { header } from './screens.js';
import { useProducts } from './products.js';
import { useLocations } from './locations.js';
import { useStock, stockMap, myLocations } from './stock.js';
import { startCount, saveShelf, removeShelf, cancelCount, countTotals, applyCount, qtyAt, roundQty } from './movements.js';

const MAX_RESULTS = 8;

function useOpenCounts(ctx, shopId) {
  return ctx.live(`counts:${shopId}`, (set) => watchCollection(['shops', shopId, 'stockCounts'], set, where('status', '==', 'open')));
}

// Kept between live updates so the shelf being counted is never reset.
let view = null;

export function renderCount(root, ctx, shopId) {
  const me = ctx.members.get(shopId);
  const data = {
    products: useProducts(ctx, shopId),
    stock: useStock(ctx, shopId),
    locations: useLocations(ctx, shopId),
    counts: useOpenCounts(ctx, shopId),
  };
  const look = getLang() + getDigits();
  if (view && view.shopId === shopId && view.look === look && root.contains(view.page)) {
    view.update(data);
    return;
  }

  let cur = data;
  const state = { locId: null, shelfId: null, items: new Map() }; // items: productId → input element
  const productById = (id) => (cur.products || []).find((p) => p.id === id);
  const activeCount = () => (cur.counts || []).find((c) => c.locationId === state.locId);

  // ----- Top: pick the location -----
  const locSelect = el('select', { class: 'input select' });
  const status = el('div', { class: 'count-status' });
  const top = el('section', { class: 'card form' },
    el('label', { class: 'field' }, el('span', { class: 'field-label' }, t('countLocation')), el('span', { class: 'select-wrap' }, locSelect)),
    el('p', { class: 'field-hint' }, t('countHint')),
    status,
  );
  locSelect.addEventListener('change', () => { state.locId = locSelect.value; resetEditor(); drawAll(); });

  // ----- Editor: one shelf -----
  const shelfName = el('input', { class: 'input', autocomplete: 'off' });
  const search = el('input', { type: 'search', class: 'input', placeholder: t('addToShelf'), autocomplete: 'off', enterkeyhint: 'done' });
  const results = el('div', { class: 'results' });
  const itemsBox = el('div', { class: 'list' });
  const editor = el('section', { class: 'card form' },
    el('label', { class: 'field' }, el('span', { class: 'field-label' }, t('shelfName')), shelfName),
    el('label', { class: 'search-box' }, icon('search'), search),
    results,
    itemsBox,
    el('div', { class: 'actions' },
      el('button', { type: 'button', class: 'btn ghost', onclick: () => resetEditor() }, t('newShelf')),
      el('button', { type: 'button', class: 'btn primary', onclick: () => save() }, t('saveShelf')),
    ),
  );

  const shelvesBox = el('section', { class: 'section' });
  const bottom = el('div', { class: 'actions' },
    el('button', { type: 'button', class: 'btn ghost danger-text', onclick: () => cancel() }, t('cancelCount')),
    el('button', { type: 'button', class: 'btn primary', onclick: () => finish() }, t('finishCount')),
  );

  function addItem(p, bump = false) {
    let input = state.items.get(p.id);
    if (input) {
      if (bump) input.value = fmtPlain(roundQty((parseNum(input.value) || 0) + 1));
    } else {
      input = el('input', { type: 'text', inputmode: 'decimal', class: 'input num count-input', value: bump ? '1' : '', autocomplete: 'off', 'aria-label': localName(p) });
      state.items.set(p.id, input);
      drawItems();
    }
    search.value = '';
    results.replaceChildren();
    if (!isTouch()) input.focus();
  }

  const fmtPlain = (n) => String(n);

  function drawItems() {
    itemsBox.replaceChildren();
    for (const [pid, input] of state.items) {
      const p = productById(pid);
      itemsBox.append(el('div', { class: 'row count-row' },
        el('span', { class: 'row-main' },
          el('strong', {}, p ? localName(p) : t('unknownProduct')),
          p ? el('span', { class: 'muted small' }, t(`unit_${p.unit}`)) : null,
        ),
        input,
        iconButton('trash', t('delete'), () => { state.items.delete(pid); drawItems(); }, 'danger'),
      ));
    }
  }

  function drawResults() {
    results.replaceChildren();
    const q = normalize(search.value);
    if (!q) return;
    const found = (cur.products || [])
      .filter((p) => p.active !== false)
      .filter((p) => q.split(' ').every((w) => normalize(`${p.nameAr} ${p.nameEn} ${p.brand} ${p.barcode} ${p.sku}`).includes(w)))
      .slice(0, MAX_RESULTS);
    if (!found.length) return results.append(el('p', { class: 'muted small' }, t('noMatches')));
    for (const p of found) {
      results.append(el('button', { type: 'button', class: 'result', onclick: () => addItem(p) },
        el('span', {}, localName(p)),
        p.barcode ? el('span', { class: 'code muted', dir: 'ltr' }, p.barcode) : null,
      ));
    }
  }
  search.addEventListener('input', drawResults);
  // Barcode scanners type the code and press Enter: an exact match adds one piece.
  search.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const code = normalize(search.value);
    const exact = (cur.products || []).find((p) => code && (normalize(p.barcode) === code || normalize(p.sku) === code));
    if (exact) addItem(exact, true);
  });

  function resetEditor() {
    state.shelfId = null;
    state.items = new Map();
    const n = Object.keys(activeCount()?.shelves || {}).length + 1;
    shelfName.value = t('shelfDefault', { n: fmtNum(n) });
    search.value = '';
    results.replaceChildren();
    drawItems();
  }

  function loadShelf(id, shelf) {
    state.shelfId = id;
    state.items = new Map();
    shelfName.value = shelf.name;
    for (const [pid, n] of Object.entries(shelf.items || {})) {
      state.items.set(pid, el('input', { type: 'text', inputmode: 'decimal', class: 'input num count-input', value: fmtPlain(n), autocomplete: 'off' }));
    }
    drawItems();
    editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function readItems() {
    const items = {};
    for (const [pid, input] of state.items) {
      const n = parseNum(input.value);
      const bad = Number.isNaN(n) || n < 0;
      input.classList.toggle('invalid', bad);
      if (bad) return null;
      items[pid] = roundQty(n);
    }
    return items;
  }

  function save() {
    const count = activeCount();
    if (!count) return;
    const items = readItems();
    if (!items) return toast(t('invalidNumber'), 'error');
    if (!Object.keys(items).length) return toast(t('emptyShelf'), 'error');
    const id = state.shelfId || `s${Date.now().toString(36)}`;
    const name = shelfName.value.trim() || t('shelfDefault', { n: fmtNum(Object.keys(count.shelves || {}).length + 1) });
    saveShelf(shopId, count.id, id, { name, items }, ctx.user.uid).catch((err) => toast(errorText(err), 'error'));
    toast(t('shelfSaved'));
    // Show it straight away; the live update confirms it.
    count.shelves = { ...(count.shelves || {}), [id]: { name, items } };
    resetEditor();
    drawShelves();
  }

  function drawStatus() {
    status.replaceChildren();
    const count = activeCount();
    if (count) {
      status.append(el('p', { class: 'note' }, t('countOpenSince', { date: fmtDate(count.createdAt || new Date()) })));
    } else if (state.locId) {
      status.append(el('button', { type: 'button', class: 'btn primary wide', onclick: () => {
        const { done } = startCount(shopId, state.locId, ctx.user.uid);
        done.catch((err) => toast(errorText(err), 'error'));
      } }, icon('plus'), t('startCount')));
    }
  }

  function drawShelves() {
    const count = activeCount();
    shelvesBox.replaceChildren();
    const shelves = Object.entries(count?.shelves || {});
    if (!shelves.length) return;
    shelvesBox.append(
      el('h2', { class: 'section-title' }, t('shelves')),
      el('div', { class: 'list' }, shelves.map(([id, s]) => el('div', { class: 'card row' },
        el('span', { class: 'row-main' },
          el('strong', {}, s.name),
          el('span', { class: 'muted small' }, t('shelfItems', { n: fmtNum(Object.keys(s.items || {}).length) })),
        ),
        el('span', { class: 'row-actions' },
          iconButton('edit', t('edit'), () => loadShelf(id, s)),
          iconButton('trash', t('delete'), async () => {
            const yes = await confirmAction({ title: t('delete'), message: t('removeShelfMsg', { name: s.name }), confirmLabel: t('delete'), danger: true });
            if (!yes) return;
            removeShelf(shopId, count.id, id).catch((err) => toast(errorText(err), 'error'));
            delete count.shelves[id];
            if (state.shelfId === id) resetEditor();
            drawShelves();
          }, 'danger'),
        ),
      ))),
    );
  }

  async function cancel() {
    const count = activeCount();
    if (!count) return;
    const yes = await confirmAction({ title: t('cancelCount'), message: t('cancelCountMsg'), confirmLabel: t('cancelCount'), danger: true });
    if (yes) cancelCount(shopId, count.id).catch((err) => toast(errorText(err), 'error'));
  }

  function finish() {
    const count = activeCount();
    if (!count) return;
    if (state.items.size) return toast(t('saveShelfFirst'), 'error');
    const totals = countTotals(count);
    const map = stockMap(cur.stock);
    const diffs = Object.entries(totals)
      .map(([productId, counted]) => {
        const onHand = qtyAt(map.get(productId), count.locationId);
        return { productId, onHand, counted, diff: roundQty(counted - onHand) };
      })
      .filter((d) => d.diff !== 0);

    openDialog(t('reviewCount'), (body, close) => {
      if (!diffs.length) body.append(el('p', {}, t('noDifferences')));
      else {
        body.append(
          el('p', { class: 'note' }, t('countWarning')),
          el('div', { class: 'diff-table' },
            el('div', { class: 'diff-line head' }, el('span', {}, ''), el('span', {}, t('onHand')), el('span', {}, t('counted')), el('span', {}, t('difference'))),
            diffs.map((d) => el('div', { class: 'diff-line' },
              el('span', {}, localName(productById(d.productId)) || t('unknownProduct')),
              el('span', {}, fmtNum(d.onHand, 3)),
              el('span', {}, fmtNum(d.counted, 3)),
              el('strong', { class: d.diff < 0 ? 'neg' : 'pos' }, `${d.diff > 0 ? '+' : ''}${fmtNum(d.diff, 3)}`),
            )),
          ),
        );
      }
      body.append(el('div', { class: 'actions' },
        el('button', { type: 'button', class: 'btn ghost', onclick: close }, t('cancel')),
        el('button', { type: 'button', class: 'btn primary', onclick: () => {
          applyCount(shopId, count, diffs, ctx.user.uid).catch((err) => toast(errorText(err), 'error'));
          toast(t('countApplied'));
          close();
          ctx.go(`#/shop/${shopId}/stock`);
        } }, diffs.length ? t('applyCount') : t('finishCount')),
      ));
    });
  }

  function fillLocations() {
    const mine = myLocations(me, cur.locations);
    const openIds = new Set((cur.counts || []).map((c) => c.locationId));
    locSelect.replaceChildren(...mine.map((l) => el('option', { value: l.id }, `${localName(l)}${openIds.has(l.id) ? ` · ${t('continueCount')}` : ''}`)));
    if (!state.locId || !mine.some((l) => l.id === state.locId)) state.locId = mine[0]?.id || null;
    locSelect.value = state.locId || '';
  }

  function drawAll() {
    const ready = !!(cur.products && cur.stock && cur.locations && cur.counts);
    loading.hidden = ready;
    top.hidden = !ready;
    const open = ready && !!activeCount();
    editor.hidden = !open;
    bottom.hidden = !open;
    if (!ready) return;
    fillLocations();
    drawStatus();
    if (open && !shelfName.value) resetEditor();
    drawShelves();
  }

  const loading = el('p', { class: 'empty' }, t('loading'));
  const page = el('main', { class: 'page' }, loading, top, editor, shelvesBox, bottom);
  root.replaceChildren(header(t('stockCount'), { back: `#/shop/${shopId}/stock` }), page);

  view = {
    shopId,
    look,
    page,
    update(next) {
      const before = activeCount()?.id;
      cur = next;
      if (activeCount()?.id !== before) { shelfName.value = ''; state.items = new Map(); state.shelfId = null; }
      drawAll();
    },
  };
  view.update(data);
}
