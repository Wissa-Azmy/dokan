// Barcodes & stickers: give products without a barcode a shop code, then print stickers with
// the barcode, the product name and, if wanted, the price. Also explains barcode readers.
import { t, getLang, localName, errorText } from './i18n.js';
import { fmtMoney, fmtNum, normalize, getDigits, parseNum } from './format.js';
import { el, icon, confirmAction, toast } from './forms.js';
import { isManager } from './roles.js';
import { header } from './screens.js';
import { useProducts } from './products.js';
import { setBarcodes } from './data.js';
import { barcodeSvg, newShopBarcode, isEan13, canCode128 } from './barcode.js';
import { printNode } from './receipt.js';
import { findByCode, listenForScanner } from './picker.js';

const MAX_ROWS = 100;
const MAX_STICKERS = 1000;

// Sticker sizes. Rolls print one sticker per page; the A4 sheet prints 3 × 8.
const SIZES = {
  '40x30': { w: 40, h: 30 },
  '50x30': { w: 50, h: 30 },
  '58x40': { w: 58, h: 40 },
  a4: { w: 70, h: 37, sheet: true },
};
const sizeLabel = (key) => (SIZES[key].sheet ? t('size_a4') : t('sizeRoll', { w: fmtNum(SIZES[key].w), h: fmtNum(SIZES[key].h) }));
const pageCss = (key) => (SIZES[key].sheet
  ? '@page { size: A4; margin: 0; }'
  : `@page { size: ${SIZES[key].w}mm ${SIZES[key].h}mm; margin: 0; }`);

// The printer and its stickers belong to this device.
const getSize = () => (SIZES[localStorage.getItem('dokan.stickerSize')] ? localStorage.getItem('dokan.stickerSize') : '40x30');
const getShowPrice = () => localStorage.getItem('dokan.stickerPrice') !== 'no';

export function stickerNode(p, { size, showPrice }) {
  const s = SIZES[size];
  const svg = barcodeSvg(p.barcode);
  return el('div', { class: `sticker ${s.h <= 30 ? 'small' : ''}`, style: `width:${s.w}mm;height:${s.h}mm` },
    el('div', { class: 'st-name', dir: 'auto' }, localName(p)),
    svg,
    el('div', { class: 'st-code', dir: 'ltr' }, p.barcode),
    showPrice && p.price != null ? el('div', { class: 'st-price' }, fmtMoney(p.price)) : null,
  );
}

const printable = (p) => !!p.barcode && (isEan13(p.barcode.trim()) || canCode128(p.barcode.trim()));

// Kept between live updates so the chosen copies and the search stay as they are.
let view = null;

export function renderLabels(root, ctx, shopId, preselectId) {
  const products = useProducts(ctx, shopId);
  const canEdit = isManager(ctx.members.get(shopId));
  const look = getLang() + getDigits();

  if (view && view.shopId === shopId && view.look === look && view.preselectId === preselectId && root.contains(view.page)) {
    view.update(products);
    return;
  }

  let all = products;
  const copies = new Map(); // productId → number of stickers
  let size = getSize();
  let showPrice = getShowPrice();
  let preselected = false;

  const active = () => (all || []).filter((p) => p.active !== false);
  const missing = () => active().filter((p) => !p.barcode);
  const totalCopies = () => [...copies.values()].reduce((a, b) => a + b, 0);

  // ---------- Generate ----------
  const genStatus = el('p', { class: 'muted' });
  const genBtn = el('button', { type: 'button', class: 'btn primary', onclick: () => generateAll() }, icon('barcode'), '');

  function takenCodes() {
    return new Set((all || []).flatMap((p) => [normalize(p.barcode), normalize(p.sku)]).filter(Boolean));
  }

  async function generateAll() {
    const list = missing();
    if (!list.length) return;
    const yes = await confirmAction({ title: t('generateBarcode'), message: t('generateAllMsg', { n: fmtNum(list.length) }), confirmLabel: t('generateBarcode') });
    if (!yes) return;
    const taken = takenCodes();
    setBarcodes(shopId, list.map((p) => ({ id: p.id, barcode: newShopBarcode(taken) }))).catch((err) => toast(errorText(err), 'error'));
    toast(t('barcodesGenerated', { n: fmtNum(list.length) }));
  }

  function generateOne(p) {
    setBarcodes(shopId, [{ id: p.id, barcode: newShopBarcode(takenCodes()) }]).catch((err) => toast(errorText(err), 'error'));
    toast(t('barcodesGenerated', { n: fmtNum(1) }));
  }

  // ---------- Sticker options ----------
  const sizeSelect = el('select', { class: 'input select', 'aria-label': t('stickerSize') },
    Object.keys(SIZES).map((k) => el('option', { value: k, selected: k === size }, sizeLabel(k))));
  sizeSelect.addEventListener('change', () => { size = sizeSelect.value; localStorage.setItem('dokan.stickerSize', size); drawPreview(); });
  const priceBox = el('input', { type: 'checkbox', checked: showPrice });
  priceBox.addEventListener('change', () => { showPrice = priceBox.checked; localStorage.setItem('dokan.stickerPrice', showPrice ? 'yes' : 'no'); drawPreview(); });
  const preview = el('div', { class: 'sticker-preview' });

  function drawPreview() {
    const chosen = active().find((p) => copies.get(p.id) && printable(p));
    const sample = chosen || active().find(printable);
    preview.replaceChildren(sample
      ? stickerNode(sample, { size, showPrice })
      : stickerNode({ nameAr: t('productName'), nameEn: t('productName'), barcode: newShopBarcode(new Set()), price: 125 }, { size, showPrice }));
  }

  // ---------- List ----------
  const search = el('input', { type: 'search', class: 'input', placeholder: t('searchProducts'), autocomplete: 'off', enterkeyhint: 'search' });
  const filter = el('select', { class: 'input select', 'aria-label': t('filterAll') },
    el('option', { value: '' }, t('filterAll')),
    el('option', { value: 'missing' }, t('noBarcode')),
    el('option', { value: 'chosen' }, t('filterChosen')),
  );
  const list = el('div', { class: 'list' });
  const footer = el('p', { class: 'muted small center' });
  const countEl = el('strong', {});
  const printBtn = el('button', { type: 'button', class: 'btn primary', onclick: () => print() }, icon('print'), t('print'));

  function shown() {
    const q = normalize(search.value);
    return active()
      .filter((p) => filter.value !== 'missing' || !p.barcode)
      .filter((p) => filter.value !== 'chosen' || copies.get(p.id))
      .filter((p) => !q || q.split(' ').every((w) => normalize(`${p.nameAr} ${p.nameEn} ${p.brand} ${p.barcode} ${p.sku}`).includes(w)))
      .sort((a, b) => localName(a).localeCompare(localName(b)));
  }

  function setCopies(p, n) {
    n = Math.max(0, Math.min(MAX_STICKERS, Math.round(n) || 0));
    if (n) copies.set(p.id, n); else copies.delete(p.id);
    countEl.textContent = t('stickersCount', { n: fmtNum(totalCopies()) });
  }

  function row(p) {
    const ok = printable(p);
    const input = el('input', { type: 'text', inputmode: 'numeric', class: 'input num qty-input', value: String(copies.get(p.id) || 0), 'aria-label': t('copies'), disabled: !ok });
    input.addEventListener('input', () => { const n = parseNum(input.value); setCopies(p, Number.isNaN(n) ? 0 : n); });
    input.addEventListener('change', () => { input.value = String(copies.get(p.id) || 0); drawPreview(); });
    const step = (d) => { setCopies(p, (copies.get(p.id) || 0) + d); input.value = String(copies.get(p.id) || 0); drawPreview(); };

    let sub;
    if (!p.barcode) sub = el('span', { class: 'badge low' }, t('noBarcode'));
    else if (!ok) sub = el('span', { class: 'badge low' }, t('cantDrawCode'));
    else sub = el('span', { class: 'code muted', dir: 'ltr' }, p.barcode);

    return el('div', { class: 'card row label-row' },
      el('span', { class: 'row-main' },
        el('strong', {}, localName(p)),
        el('span', { class: 'row-meta' }, sub, p.price != null ? el('span', { class: 'muted small' }, fmtMoney(p.price)) : null),
      ),
      !p.barcode && canEdit
        ? el('button', { type: 'button', class: 'btn ghost small', onclick: () => generateOne(p) }, icon('barcode'), t('generateBarcode'))
        : el('div', { class: 'stepper' },
          el('button', { type: 'button', class: 'icon-btn', 'aria-label': '−', disabled: !ok, onclick: () => step(-1) }, '−'),
          input,
          el('button', { type: 'button', class: 'icon-btn', 'aria-label': '+', disabled: !ok, onclick: () => step(1) }, '+'),
        ),
    );
  }

  function draw() {
    list.replaceChildren();
    footer.textContent = '';
    countEl.textContent = t('stickersCount', { n: fmtNum(totalCopies()) });
    const missingCount = all ? missing().length : 0;
    genStatus.textContent = !all ? t('loading') : missingCount ? t('missingBarcodes', { n: fmtNum(missingCount) }) : t('allHaveBarcodes');
    genBtn.hidden = !missingCount;
    genBtn.lastChild.textContent = t('generateAll', { n: fmtNum(missingCount) });
    if (!all) return list.append(el('p', { class: 'empty' }, t('loading')));
    if (!active().length) return list.append(el('p', { class: 'empty' }, t('noProducts')));
    const rows = shown();
    if (!rows.length) return list.append(el('p', { class: 'empty' }, t('noMatches')));
    for (const p of rows.slice(0, MAX_ROWS)) list.append(row(p));
    if (rows.length > MAX_ROWS) footer.textContent = t('showingOf', { shown: fmtNum(MAX_ROWS), total: fmtNum(rows.length) });
  }

  function oneEach() {
    for (const p of shown().slice(0, MAX_ROWS)) if (printable(p) && !copies.get(p.id)) copies.set(p.id, 1);
    draw();
    drawPreview();
  }

  function clearAll() {
    copies.clear();
    draw();
    drawPreview();
  }

  function print() {
    const total = totalCopies();
    if (!total) return toast(t('noStickersChosen'), 'error');
    if (total > MAX_STICKERS) return toast(t('tooManyStickers', { n: fmtNum(MAX_STICKERS) }), 'error');
    const sheet = el('div', { class: 'labels-sheet' });
    for (const p of active()) {
      const n = copies.get(p.id) || 0;
      if (!n || !printable(p)) continue;
      const one = stickerNode(p, { size, showPrice });
      for (let i = 0; i < n; i++) sheet.append(one.cloneNode(true));
    }
    printNode(sheet, `labels sz-${size}`, pageCss(size));
  }

  search.addEventListener('input', draw);
  filter.addEventListener('change', draw);

  // ---------- Barcode reader help and test ----------
  const testInput = el('input', { type: 'text', class: 'input', dir: 'ltr', autocomplete: 'off', enterkeyhint: 'done', placeholder: t('testReaderHint') });
  const testResult = el('p', { class: 'muted small', role: 'status' });
  testInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const code = testInput.value.trim();
    if (!code) return;
    const p = findByCode(all, code);
    testResult.textContent = p ? t('testFound', { code, name: localName(p) }) : t('testNotFound', { code });
    testInput.value = '';
  });
  const help = readerHelp(testInput, testResult);

  const page = el('main', { class: 'page labels-page' },
    canEdit ? el('section', { class: 'card form' },
      el('h2', { class: 'section-title' }, t('shopBarcodes')),
      el('p', { class: 'field-hint' }, t('shopBarcodesIntro')),
      genStatus,
      genBtn,
    ) : null,
    el('section', { class: 'card form' },
      el('h2', { class: 'section-title' }, t('stickerOptions')),
      el('label', { class: 'field' }, el('span', { class: 'field-label' }, t('stickerSize')), el('span', { class: 'select-wrap' }, sizeSelect)),
      el('label', { class: 'check' }, priceBox, el('span', { class: 'check-text' }, t('showPrice'))),
      el('span', { class: 'field-label' }, t('stickerPreview')),
      preview,
      el('p', { class: 'field-hint' }, t('printTips')),
    ),
    el('div', { class: 'filters two' },
      el('label', { class: 'search-box' }, icon('search'), search),
      el('span', { class: 'select-wrap' }, filter),
    ),
    el('p', { class: 'field-hint' }, t('scanAddsSticker')),
    el('div', { class: 'seg-group' },
      el('button', { type: 'button', class: 'btn ghost small', onclick: oneEach }, t('oneEach')),
      el('button', { type: 'button', class: 'btn ghost small', onclick: clearAll }, t('clearChosen')),
    ),
    list,
    footer,
    help,
    el('div', { class: 'print-bar' }, el('div', { class: 'cart-sum' }, countEl), printBtn),
  );
  root.replaceChildren(header(t('barcodesStickers'), { back: `#/shop/${shopId}/products` }), page);

  // A reader scan anywhere on this screen adds one sticker for that product.
  listenForScanner(page, (code) => {
    const p = findByCode(all, code);
    if (!p || !printable(p)) return toast(t('codeNotFound', { code }), 'error');
    setCopies(p, (copies.get(p.id) || 0) + 1);
    draw();
    drawPreview();
    toast(t('stickerAdded', { name: localName(p) }));
  });

  function update(next) {
    all = next;
    // Coming from a product's form: start with one sticker for it.
    if (all && preselectId && !preselected) {
      preselected = true;
      const p = all.find((x) => x.id === preselectId);
      if (p && printable(p)) { copies.set(p.id, 1); filter.value = 'chosen'; }
    }
    draw();
    drawPreview();
  }
  view = { shopId, look, page, preselectId, update };
  update(products);
}

function readerHelp(testInput, testResult) {
  const part = (title, text) => el('div', { class: 'help-part' }, el('strong', {}, title), el('p', {}, text));
  return el('details', { class: 'card help' },
    el('summary', {}, icon('help'), t('readerHelpTitle')),
    el('p', {}, t('readerIntro')),
    part(t('readerUsbTitle'), t('readerUsb')),
    part(t('readerBtTitle'), t('readerBt')),
    part(t('readerOtgTitle'), t('readerOtg')),
    part(t('readerWhereTitle'), t('readerWhere')),
    part(t('readerTroubleTitle'), t('readerTrouble')),
    part(t('readerPrinterTitle'), t('readerPrinter')),
    el('label', { class: 'field' }, el('span', { class: 'field-label' }, t('testReader')), testInput),
    testResult,
  );
}
