// Products: searchable list and the add/edit form.
import { t, getLang, localName, errorText } from './i18n.js';
import { fmtMoney, fmtNum, digitsOf, normalize, optionalNum, getDigits } from './format.js';
import {
  el, icon, iconButton, textField, numberField, selectField, checkboxField, setFieldError, confirmAction, toast, focusFirst,
} from './forms.js';
import { saveProduct, deleteProduct, UNITS } from './data.js';
import { watchCollection } from './sync.js';
import { isManager } from './roles.js';
import { header } from './screens.js';
import { useCategories, categoryPath, categoryOptions } from './categories.js';
import { useLocations } from './locations.js';

const MAX_ROWS = 100;
const ARCHIVED = '__archived';

export function useProducts(ctx, shopId) {
  return ctx.live(`products:${shopId}`, (set) => watchCollection(['shops', shopId, 'products'], set));
}

const unitOptions = () => UNITS.map((u) => ({ value: u, label: t(`unit_${u}`) }));

function searchText(p, categories) {
  return normalize([p.nameAr, p.nameEn, p.brand, p.barcode, p.sku, categoryPath(categories, p.categoryId)].join(' '));
}

// ---------- List ----------

// Kept between live updates so typing in the search box is never interrupted.
let view = null;

export function renderProducts(root, ctx, shopId) {
  const products = useProducts(ctx, shopId);
  const categories = useCategories(ctx, shopId) || [];
  const canEdit = isManager(ctx.members.get(shopId));
  const look = getLang() + getDigits();

  if (view && view.shopId === shopId && view.look === look && root.contains(view.page)) {
    view.update(products, categories);
    return;
  }

  const search = el('input', { type: 'search', class: 'input', placeholder: t('searchProducts'), autocomplete: 'off', enterkeyhint: 'search' });
  const catSelect = el('select', { class: 'input select' });
  const list = el('div', { class: 'list' });
  const footer = el('p', { class: 'muted small center' });
  let current = { products, categories };

  function fillCategories() {
    const keep = catSelect.value;
    catSelect.replaceChildren(
      ...categoryOptions(current.categories, t('allCategories')).map((o) => el('option', { value: o.value }, o.label)),
      el('option', { value: ARCHIVED }, t('archivedProducts')),
    );
    catSelect.value = [...catSelect.options].some((o) => o.value === keep) ? keep : '';
  }

  function draw() {
    const all = current.products;
    list.replaceChildren();
    footer.textContent = '';
    if (!all) return list.append(el('p', { class: 'empty' }, t('loading')));
    if (!all.length) return list.append(el('p', { class: 'empty' }, t('noProducts')));

    const q = normalize(search.value);
    const cat = catSelect.value;
    const inCat = (p) => !cat || cat === ARCHIVED || p.categoryId === cat || current.categories.find((c) => c.id === p.categoryId)?.parentId === cat;
    const shown = all
      .filter((p) => (cat === ARCHIVED ? p.active === false : p.active !== false))
      .filter(inCat)
      .filter((p) => !q || q.split(' ').every((word) => searchText(p, current.categories).includes(word)))
      .sort((a, b) => localName(a).localeCompare(localName(b)));

    if (!shown.length) return list.append(el('p', { class: 'empty' }, t('noMatches')));
    for (const p of shown.slice(0, MAX_ROWS)) list.append(productRow(shopId, p, current.categories, canEdit));
    if (shown.length > MAX_ROWS) footer.textContent = t('showingOf', { shown: fmtNum(MAX_ROWS), total: fmtNum(shown.length) });
  }

  search.addEventListener('input', draw);
  catSelect.addEventListener('change', draw);
  fillCategories();
  draw();

  const page = el('main', { class: 'page' },
    el('div', { class: 'filters' },
      el('label', { class: 'search-box' }, icon('search'), search),
      el('span', { class: 'select-wrap' }, catSelect),
    ),
    list,
    footer,
    canEdit ? el('a', { class: 'btn primary fab', href: `#/shop/${shopId}/product/new` }, icon('plus'), t('addProduct')) : null,
  );
  root.replaceChildren(header(t('products'), { back: `#/shop/${shopId}` }), page);

  view = {
    shopId,
    look,
    page,
    update(nextProducts, nextCategories) {
      current = { products: nextProducts, categories: nextCategories };
      fillCategories();
      draw();
    },
  };
}

function productRow(shopId, p, categories, canEdit) {
  const path = categoryPath(categories, p.categoryId);
  const sub = [path, p.brand].filter(Boolean).join(' · ');
  return el('div', { class: `card row ${p.active === false ? 'is-off' : ''}` },
    el('span', { class: 'row-icon' }, icon('box')),
    el('span', { class: 'row-main' },
      el('strong', {}, localName(p)),
      sub ? el('span', { class: 'row-sub' }, sub) : null,
      el('span', { class: 'row-meta' },
        el('span', { class: p.price != null ? 'price' : 'muted small' }, p.price != null ? fmtMoney(p.price) : t('noPrice')),
        el('span', { class: 'muted small' }, `/ ${t(`unit_${p.unit}`)}`),
        p.barcode ? el('span', { class: 'code muted', dir: 'ltr' }, digitsOf(p.barcode)) : null,
        p.active === false ? el('span', { class: 'badge off' }, t('archived')) : null,
      ),
    ),
    canEdit ? el('span', { class: 'row-actions' },
      el('a', { class: 'icon-btn', href: `#/shop/${shopId}/product/${p.id}`, 'aria-label': t('edit'), title: t('edit') }, icon('edit')),
      iconButton('trash', t('delete'), () => remove(shopId, p), 'danger'),
    ) : null,
  );
}

async function remove(shopId, p, after) {
  const word = t('deleteWord');
  const yes = await confirmAction({
    title: t('deleteProduct'),
    message: t('deleteProductMsg', { name: localName(p), word }),
    confirmLabel: t('delete'),
    danger: true,
    typeWord: word,
  });
  if (!yes) return;
  deleteProduct(shopId, p.id).catch((err) => toast(errorText(err), 'error'));
  toast(t('deleted'));
  after?.();
}

// ---------- Form ----------

// Returns true once the form is drawn with all its data, so live updates leave it alone.
export function renderProductForm(root, ctx, shopId, productId) {
  const back = `#/shop/${shopId}/products`;
  const products = useProducts(ctx, shopId);
  const categories = useCategories(ctx, shopId);
  const locations = useLocations(ctx, shopId);
  const isNew = productId === 'new';
  const title = isNew ? t('addProduct') : t('editProduct');

  if (!products || !categories || !locations) {
    root.replaceChildren(header(title, { back }), el('main', { class: 'page' }, el('p', { class: 'empty' }, t('loading'))));
    return false;
  }
  const p = isNew ? null : products.find((x) => x.id === productId);
  if (!isNew && !p) {
    root.replaceChildren(header(title, { back }), el('main', { class: 'page' }, el('p', { class: 'empty' }, t('noMatches'))));
    return false;
  }

  const low = p?.lowStock || {};
  const locs = locations.filter((l) => l.active !== false || low[l.id] != null);
  const numText = (n) => (n != null ? String(n) : '');

  const form = el('form', { class: 'form', novalidate: true },
    el('section', { class: 'card form' },
      el('h2', { class: 'section-title' }, t('details')),
      textField({ name: 'nameAr', label: t('nameAr'), value: p?.nameAr || '', dir: 'rtl' }),
      textField({ name: 'nameEn', label: t('nameEn'), value: p?.nameEn || '', dir: 'ltr' }),
      selectField({ name: 'categoryId', label: t('category'), value: p?.categoryId || '', options: categoryOptions(categories, t('noCategory')) }),
      textField({ name: 'brand', label: t('brand'), value: p?.brand || '' }),
      selectField({ name: 'unit', label: t('unit'), value: p?.unit || 'piece', options: unitOptions() }),
      textField({ name: 'barcode', label: t('barcode'), value: p?.barcode || '', hint: t('barcodeHint'), dir: 'ltr', autocomplete: 'off' }),
      textField({ name: 'sku', label: t('sku'), value: p?.sku || '', dir: 'ltr', autocomplete: 'off' }),
    ),
    el('section', { class: 'card form' },
      el('h2', { class: 'section-title' }, t('pricingSection')),
      numberField({ name: 'price', label: t('price'), value: numText(p?.price), hint: t('priceHint') }),
      numberField({ name: 'markup', label: t('markupOverride'), value: numText(p?.markupPct), hint: t('markupProductHint') }),
    ),
    locs.length ? el('section', { class: 'card form' },
      el('h2', { class: 'section-title' }, t('lowStockTitle')),
      el('p', { class: 'field-hint' }, t('lowStockHint')),
      locs.map((l) => numberField({ name: `low_${l.id}`, label: `${localName(l)} · ${t(l.type)}`, value: numText(low[l.id]) })),
    ) : null,
    isNew ? null : el('section', { class: 'card' }, checkboxField({ name: 'active', label: t('productActive'), checked: p.active !== false, hint: t('productActiveHint') })),
    el('p', { class: 'form-error', role: 'alert' }),
    el('div', { class: 'actions sticky-actions' },
      isNew ? null : el('button', { type: 'button', class: 'btn ghost danger-text', onclick: () => remove(shopId, p, () => ctx.go(back)) }, icon('trash'), t('delete')),
      el('a', { class: 'btn ghost', href: back }, t('cancel')),
      el('button', { type: 'submit', class: 'btn primary' }, t('save')),
    ),
  );

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = form.elements;
    const nameAr = f.nameAr.value.trim();
    const nameEn = f.nameEn.value.trim();
    const barcode = f.barcode.value.trim();
    const sku = f.sku.value.trim();
    const price = optionalNum(f.price.value);
    const markupPct = optionalNum(f.markup.value);
    const others = products.filter((x) => x.id !== p?.id);
    const sameBarcode = barcode && others.find((x) => normalize(x.barcode) === normalize(barcode));
    const sameSku = sku && others.find((x) => normalize(x.sku) === normalize(sku));

    const errors = {
      nameAr: !nameAr && !nameEn ? t('required') : '',
      barcode: sameBarcode ? t('barcodeTaken', { name: localName(sameBarcode) }) : '',
      sku: sameSku ? t('skuTaken', { name: localName(sameSku) }) : '',
      price: Number.isNaN(price) ? t('invalidNumber') : '',
      markup: Number.isNaN(markupPct) ? t('invalidNumber') : '',
    };
    const lowStock = {};
    for (const l of locs) {
      const v = optionalNum(f[`low_${l.id}`].value);
      errors[`low_${l.id}`] = Number.isNaN(v) ? t('invalidNumber') : '';
      if (v != null && !Number.isNaN(v)) lowStock[l.id] = v;
    }
    for (const [name, msg] of Object.entries(errors)) setFieldError(form, name, msg);
    const firstBad = Object.keys(errors).find((k) => errors[k]);
    if (firstBad) {
      f[firstBad]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }

    const { done } = saveProduct(shopId, p?.id, {
      nameAr: nameAr || nameEn,
      nameEn: nameEn || nameAr,
      categoryId: f.categoryId.value,
      brand: f.brand.value.trim(),
      barcode,
      sku,
      unit: f.unit.value,
      price,
      markupPct,
      lowStock,
      active: isNew ? true : f.active.checked,
    });
    done.catch((err) => toast(errorText(err), 'error'));
    toast(t('saved'));
    ctx.go(back);
  });

  root.replaceChildren(header(title, { back }), el('main', { class: 'page' }, form));
  focusFirst(form);
  return true;
}
