// Branches (selling points) and warehouses (storage only).
import { t, localName, errorText } from './i18n.js';
import { digitsOf } from './format.js';
import { el, icon, iconButton, textField, selectField, checkboxField, setFieldError, openDialog, confirmAction, toast } from './forms.js';
import { addLocation, updateLocation, deleteLocation } from './data.js';
import { watchCollection } from './sync.js';
import { isManager, isOwner, canUseLocation } from './roles.js';
import { header } from './screens.js';

// Live list of a shop's locations, branches first then by code.
export function useLocations(ctx, shopId) {
  const list = ctx.live(`locations:${shopId}`, (set) => watchCollection(['shops', shopId, 'locations'], set));
  if (!list) return null;
  return [...list].sort((a, b) => (a.type === b.type ? String(a.code).localeCompare(String(b.code)) : a.type === 'branch' ? -1 : 1));
}

export function renderLocations(root, ctx, shopId) {
  const me = ctx.members.get(shopId);
  const locations = useLocations(ctx, shopId);
  const canEdit = isManager(me);
  const visible = (locations || []).filter((l) => canUseLocation(me, l.id));

  const list = el('div', { class: 'list' });
  if (!locations) list.append(el('p', { class: 'empty' }, t('loading')));
  else if (!visible.length) list.append(el('p', { class: 'empty' }, t('noLocationsYet')));
  for (const loc of visible) {
    list.append(
      el('div', { class: `card row ${loc.active === false ? 'is-off' : ''}` },
        el('span', { class: `row-icon ${loc.type}` }, icon(loc.type === 'branch' ? 'store' : 'pin')),
        el('span', { class: 'row-main' },
          el('strong', {}, localName(loc)),
          el('span', { class: 'row-meta' },
            el('span', { class: 'badge' }, t(loc.type)),
            el('span', { class: 'code', dir: 'ltr' }, digitsOf(loc.code)),
            loc.active === false ? el('span', { class: 'badge off' }, t('inactive')) : null,
          ),
        ),
        canEdit ? el('span', { class: 'row-actions' },
          iconButton('edit', t('edit'), () => editDialog(shopId, locations, loc)),
          isOwner(me) ? iconButton('trash', t('delete'), () => remove(shopId, locations, loc), 'danger') : null,
        ) : null,
      ),
    );
  }

  root.replaceChildren(
    header(t('branches'), { back: `#/shop/${shopId}` }),
    el('main', { class: 'page' },
      list,
      canEdit ? el('button', { type: 'button', class: 'btn primary', onclick: () => editDialog(shopId, locations || [], null) }, icon('plus'), t('addLocation')) : null,
    ),
  );
}

function nextCode(locations, type) {
  const prefix = type === 'branch' ? 'B' : 'W';
  const used = new Set(locations.map((l) => String(l.code).toUpperCase()));
  let n = 1;
  while (used.has(prefix + n)) n += 1;
  return prefix + n;
}

const activeBranches = (locations, exceptId) => locations.filter((l) => l.type === 'branch' && l.active !== false && l.id !== exceptId);

function editDialog(shopId, locations, loc) {
  const isNew = !loc;
  openDialog(isNew ? t('addLocation') : t('edit'), (body, close) => {
    const type = loc?.type || 'branch';
    const form = el('form', { class: 'form', novalidate: true },
      selectField({ name: 'type', label: t('locType'), value: type, options: [{ value: 'branch', label: t('branch') }, { value: 'warehouse', label: t('warehouse') }] }),
      textField({ name: 'nameAr', label: t('nameAr'), value: loc?.nameAr || '', dir: 'rtl' }),
      textField({ name: 'nameEn', label: t('nameEn'), value: loc?.nameEn || '', dir: 'ltr' }),
      textField({ name: 'code', label: t('code'), value: loc?.code || nextCode(locations, type), hint: t('codeHint'), dir: 'ltr', autocomplete: 'off' }),
      isNew ? null : checkboxField({ name: 'active', label: t('active'), checked: loc.active !== false, hint: t('activeHint') }),
      el('p', { class: 'form-error', role: 'alert' }),
      el('div', { class: 'actions' },
        el('button', { type: 'button', class: 'btn ghost', onclick: close }, t('cancel')),
        el('button', { type: 'submit', class: 'btn primary' }, t('save')),
      ),
    );
    // Suggest a matching code when a new location changes type.
    form.elements.type.addEventListener('change', (e) => {
      if (isNew) form.elements.code.value = nextCode(locations, e.target.value);
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = form.elements;
      const nameAr = f.nameAr.value.trim();
      const nameEn = f.nameEn.value.trim();
      const code = f.code.value.trim().toUpperCase();
      const newType = f.type.value;
      const active = isNew ? true : f.active.checked;
      let ok = true;
      setFieldError(form, 'nameAr', !nameAr && !nameEn ? t('required') : '');
      if (!nameAr && !nameEn) ok = false;
      let codeError = '';
      if (!/^[A-Z0-9]{1,4}$/.test(code)) codeError = t('codeInvalid');
      else if (locations.some((l) => l.id !== loc?.id && String(l.code).toUpperCase() === code)) codeError = t('codeTaken');
      setFieldError(form, 'code', codeError);
      if (codeError) ok = false;
      const wasActiveBranch = loc && loc.type === 'branch' && loc.active !== false;
      if (wasActiveBranch && (!active || newType !== 'branch') && !activeBranches(locations, loc.id).length) {
        form.querySelector('.form-error').textContent = t('lastBranch');
        ok = false;
      }
      if (!ok) return;
      const data = { type: newType, nameAr: nameAr || nameEn, nameEn: nameEn || nameAr, code };
      // Saved offline too; the listener shows the change straight away.
      const done = isNew ? addLocation(shopId, data).done : updateLocation(shopId, loc.id, { ...data, active });
      done.catch((err) => toast(errorText(err), 'error'));
      toast(t('saved'));
      close();
    });
    body.append(form);
  });
}

async function remove(shopId, locations, loc) {
  if (loc.type === 'branch' && loc.active !== false && !activeBranches(locations, loc.id).length) {
    return toast(t('lastBranch'), 'error');
  }
  const word = t('deleteWord');
  const yes = await confirmAction({
    title: t('deleteLocation'),
    message: t('deleteLocationMsg', { name: localName(loc), word }),
    confirmLabel: t('delete'),
    danger: true,
    typeWord: word,
  });
  if (!yes) return;
  deleteLocation(shopId, loc.id).catch((err) => toast(errorText(err), 'error'));
  toast(t('deleted'));
}
