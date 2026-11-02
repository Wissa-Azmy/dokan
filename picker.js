// Product search box: type to see matches, tap one to pick it. A barcode scanner (which types
// the code and presses Enter) picks the exact barcode or SKU match straight away.
import { t, localName } from './i18n.js';
import { normalize } from './format.js';
import { el, icon } from './forms.js';

const MAX_RESULTS = 8;

const haystack = (p) => normalize(`${p.nameAr} ${p.nameEn} ${p.brand} ${p.barcode} ${p.sku}`);

export function findByCode(products, code) {
  const c = normalize(code);
  return c ? (products || []).find((p) => p.active !== false && (normalize(p.barcode) === c || normalize(p.sku) === c)) : null;
}

// getProducts() returns the current product list; onPick(product, { scanned }) is called on a pick.
export function productPicker({ getProducts, onPick, placeholder = t('addToShelf') }) {
  const input = el('input', { type: 'search', class: 'input', placeholder, autocomplete: 'off', enterkeyhint: 'done' });
  const results = el('div', { class: 'results' });

  const clear = () => { input.value = ''; results.replaceChildren(); };

  function draw() {
    results.replaceChildren();
    const q = normalize(input.value);
    if (!q) return;
    const found = (getProducts() || [])
      .filter((p) => p.active !== false && q.split(' ').every((w) => haystack(p).includes(w)))
      .slice(0, MAX_RESULTS);
    if (!found.length) return results.append(el('p', { class: 'muted small' }, t('noMatches')));
    for (const p of found) {
      results.append(el('button', { type: 'button', class: 'result', onclick: () => { clear(); onPick(p, { scanned: false }); } },
        el('span', {}, localName(p)),
        p.barcode ? el('span', { class: 'code muted', dir: 'ltr' }, p.barcode) : null,
      ));
    }
  }

  input.addEventListener('input', draw);
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const exact = findByCode(getProducts(), input.value);
    if (exact) { clear(); onPick(exact, { scanned: true }); }
  });

  return { element: el('div', { class: 'picker' }, el('label', { class: 'search-box' }, icon('search'), input), results), clear };
}

// Catches a barcode reader even when no field has focus: readers type much faster than people
// and end with Enter. Stops by itself once `page` leaves the screen.
const SCAN_KEY_GAP = 60; // ms; people type slower than this
export function listenForScanner(page, onCode) {
  let buffer = '';
  let lastAt = 0;
  function onKey(e) {
    if (!document.contains(page)) { document.removeEventListener('keydown', onKey, true); return; }
    const target = e.target;
    if (target.closest?.('input, textarea, select, [contenteditable]') || document.querySelector('dialog[open]')) return;
    const now = Date.now();
    if (now - lastAt > SCAN_KEY_GAP) buffer = '';
    lastAt = now;
    if (e.key === 'Enter') {
      if (buffer.length >= 4) { e.preventDefault(); onCode(buffer); }
      buffer = '';
    } else if (e.key.length === 1) {
      buffer += e.key;
    }
  }
  document.addEventListener('keydown', onKey, true);
}
