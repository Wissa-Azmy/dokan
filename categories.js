// Categories and subcategories (two levels), each with an optional markup override.
import { t, localName, errorText } from './i18n.js';
import { fmtNum, optionalNum } from './format.js';
import { el, icon, iconButton, textField, numberField, selectField, setFieldError, openDialog, confirmAction, toast } from './forms.js';
import { saveCategory, deleteCategory } from './data.js';
import { watchCollection } from './sync.js';
import { isManager } from './roles.js';
import { header } from './screens.js';
import { useProducts } from './products.js';

const byName = (a, b) => localName(a).localeCompare(localName(b));

export function useCategories(ctx, shopId) {
  return ctx.live(`categories:${shopId}`, (set) => watchCollection(['shops', shopId, 'categories'], set));
}

// "Parent › Sub" for a category id, or '' if none.
export function categoryPath(categories, id) {
  const cat = (categories || []).find((c) => c.id === id);
  if (!cat) return '';
  const parent = cat.parentId && categories.find((c) => c.id === cat.parentId);
  return parent ? `${localName(parent)} › ${localName(cat)}` : localName(cat);
}

// Options for a real <select>: each main category followed by its subcategories.
export function categoryOptions(categories, emptyLabel) {
  const list = categories || [];
  const opts = [{ value: '', label: emptyLabel }];
  for (const main of list.filter((c) => !c.parentId).sort(byName)) {
    opts.push({ value: main.id, label: localName(main) });
    for (const sub of list.filter((c) => c.parentId === main.id).sort(byName)) {
      opts.push({ value: sub.id, label: `— ${localName(sub)}` });
    }
  }
  return opts;
}

export function renderCategories(root, ctx, shopId) {
  const me = ctx.members.get(shopId);
  const canEdit = isManager(me);
  const categories = useCategories(ctx, shopId);
  const products = useProducts(ctx, shopId) || [];
  const countIn = (id) => products.filter((p) => p.categoryId === id).length;

  const list = el('div', { class: 'list' });
  if (!categories) list.append(el('p', { class: 'empty' }, t('loading')));
  else if (!categories.length) list.append(el('p', { class: 'empty' }, t('noCategories')));

  const row = (cat, isSub) => el('div', { class: `card row ${isSub ? 'sub' : ''}` },
    el('span', { class: 'row-icon' }, icon('tag')),
    el('span', { class: 'row-main' },
      el('strong', {}, localName(cat)),
      el('span', { class: 'row-meta' },
        el('span', { class: 'muted small' }, t('productCount', { n: fmtNum(countIn(cat.id)) })),
        cat.markupPct != null ? el('span', { class: 'badge' }, t('markupBadge', { n: fmtNum(cat.markupPct) })) : null,
      ),
    ),
    canEdit ? el('span', { class: 'row-actions' },
      isSub ? null : iconButton('plus', t('addSubcategory'), () => editDialog(shopId, categories, null, cat.id)),
      iconButton('edit', t('edit'), () => editDialog(shopId, categories, cat)),
      iconButton('trash', t('delete'), () => remove(shopId, categories, cat, countIn(cat.id)), 'danger'),
    ) : null,
  );

  for (const main of (categories || []).filter((c) => !c.parentId).sort(byName)) {
    const subs = categories.filter((c) => c.parentId === main.id).sort(byName);
    list.append(el('div', { class: 'group' }, row(main, false), subs.map((s) => row(s, true))));
  }

  root.replaceChildren(
    header(t('categories'), { back: `#/shop/${shopId}` }),
    el('main', { class: 'page' },
      list,
      canEdit ? el('button', { type: 'button', class: 'btn primary', onclick: () => editDialog(shopId, categories || [], null) }, icon('plus'), t('addCategory')) : null,
    ),
  );
}

function editDialog(shopId, categories, cat, parentId = null) {
  const isNew = !cat;
  const hasSubs = cat && categories.some((c) => c.parentId === cat.id);
  const title = isNew ? (parentId ? t('addSubcategory') : t('addCategory')) : t('editCategory');
  openDialog(title, (body, close) => {
    const parents = categories.filter((c) => !c.parentId && c.id !== cat?.id).sort(byName);
    const form = el('form', { class: 'form', novalidate: true },
      textField({ name: 'nameAr', label: t('nameAr'), value: cat?.nameAr || '', dir: 'rtl' }),
      textField({ name: 'nameEn', label: t('nameEn'), value: cat?.nameEn || '', dir: 'ltr' }),
      hasSubs ? null : selectField({
        name: 'parentId',
        label: t('parentCategory'),
        value: cat?.parentId || parentId || '',
        options: [{ value: '', label: t('noParent') }, ...parents.map((p) => ({ value: p.id, label: localName(p) }))],
      }),
      numberField({ name: 'markup', label: t('markupOverride'), value: cat?.markupPct != null ? String(cat.markupPct) : '', hint: t('markupCategoryHint') }),
      el('div', { class: 'actions' },
        el('button', { type: 'button', class: 'btn ghost', onclick: close }, t('cancel')),
        el('button', { type: 'submit', class: 'btn primary' }, t('save')),
      ),
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = form.elements;
      const nameAr = f.nameAr.value.trim();
      const nameEn = f.nameEn.value.trim();
      const markupPct = optionalNum(f.markup.value);
      setFieldError(form, 'nameAr', !nameAr && !nameEn ? t('required') : '');
      setFieldError(form, 'markup', Number.isNaN(markupPct) ? t('invalidNumber') : '');
      if ((!nameAr && !nameEn) || Number.isNaN(markupPct)) return;
      saveCategory(shopId, cat?.id, {
        nameAr: nameAr || nameEn,
        nameEn: nameEn || nameAr,
        parentId: hasSubs ? null : f.parentId.value,
        markupPct,
      }).catch((err) => toast(errorText(err), 'error'));
      toast(t('saved'));
      close();
    });
    body.append(form);
  });
}

async function remove(shopId, categories, cat, productCount) {
  if (categories.some((c) => c.parentId === cat.id)) return toast(t('categoryHasSubs'), 'error');
  if (productCount) return toast(t('categoryHasProducts', { n: fmtNum(productCount) }), 'error');
  const yes = await confirmAction({ title: t('deleteCategory'), message: t('deleteCategoryMsg', { name: localName(cat) }), confirmLabel: t('delete'), danger: true });
  if (!yes) return;
  deleteCategory(shopId, cat.id).catch((err) => toast(errorText(err), 'error'));
  toast(t('deleted'));
}
