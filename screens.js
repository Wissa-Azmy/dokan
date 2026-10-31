// Screens for step 1: header, shop list, new shop, shop home and preferences.
import { t, getLang, setLang, localName, errorText } from './i18n.js';
import { setDigits, getDigits, digitsOf } from './format.js';
import { el, icon, iconButton, textField, selectField, setFieldError, focusFirst, busy, toast } from './forms.js';
import { createShop } from './data.js';
import { saveProfileField } from './sync.js';
import { roleLabel } from './roles.js';
import { auth, signOut } from './firebase.js';

let ctx = null; // { user, profile, shops: Map, go(path) }

export function initScreens(context) {
  ctx = context;
}

export function brand(big = false) {
  return el('div', { class: big ? 'brand big' : 'brand' }, el('span', { class: 'brand-mark' }, icon('store')), el('span', { class: 'brand-name' }, t('appName')));
}

// Toggles Arabic/English. When signed in, saves only the lang field to the cloud.
export function langSwitch(rerender) {
  const next = getLang() === 'ar' ? 'en' : 'ar';
  return el('button', {
    type: 'button',
    class: 'chip',
    onclick: () => {
      setLang(next);
      if (ctx?.user) saveProfileField(ctx.user.uid, 'lang', next).catch(() => {});
      rerender();
    },
  }, icon('globe'), next === 'ar' ? 'عربي' : 'English');
}

const tile = (href, iconName, label) => el('a', { class: 'card tile', href }, el('span', { class: 'tile-icon' }, icon(iconName)), el('span', { class: 'tile-label' }, label), el('span', { class: 'tile-go flip' }, icon('chevron')));

export function header(title, { back } = {}) {
  return el('header', { class: 'topbar' },
    back ? iconButton('back', t('myShops'), () => ctx.go(back), 'flip') : brand(),
    el('h1', { class: 'topbar-title' }, title || ''),
    el('div', { class: 'topbar-actions' },
      langSwitch(() => ctx.rerender()),
      iconButton('user', t('preferences'), () => ctx.go('#/prefs')),
    ),
  );
}

export function renderShops(root) {
  const list = el('div', { class: 'shop-list' });
  const ids = ctx.profile?.shopIds || [];
  if (!ids.length) list.append(el('p', { class: 'empty' }, t('noShops')));
  for (const id of ids) {
    const shop = ctx.shops.get(id);
    const member = ctx.members.get(id);
    list.append(
      el('a', { class: 'card shop-card', href: `#/shop/${id}` },
        el('span', { class: 'shop-icon' }, icon('store')),
        el('span', { class: 'shop-text' },
          el('strong', {}, shop ? localName(shop) : member?.disabled ? t('memberDisabled') : t('loading')),
          member ? el('span', { class: `badge role-${member.role}` }, member.disabled ? t('memberDisabled') : roleLabel(member.role)) : null,
        ),
      ),
    );
  }
  root.replaceChildren(
    header(t('myShops')),
    el('main', { class: 'page' },
      list,
      el('div', { class: 'actions stack' },
        el('a', { class: 'btn primary', href: '#/new-shop' }, icon('plus'), t('createShop')),
        el('button', { type: 'button', class: 'btn ghost', onclick: () => ctx.go('#/join') }, icon('key'), t('joinShop')),
      ),
    ),
  );
}

export function renderNewShop(root) {
  const submit = el('button', { type: 'submit', class: 'btn primary' }, t('create'));
  const form = el('form', { class: 'card form', novalidate: true },
    textField({ name: 'nameAr', label: t('shopNameAr'), required: true, dir: 'rtl' }),
    textField({ name: 'nameEn', label: t('shopNameEn'), dir: 'ltr' }),
    textField({ name: 'branch', label: t('firstBranch'), value: t('mainBranch'), hint: t('firstBranchHint') }),
    el('p', { class: 'form-error', role: 'alert' }),
    el('div', { class: 'actions' }, el('a', { class: 'btn ghost', href: '#/shops' }, t('cancel')), submit),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const nameAr = form.elements.nameAr.value.trim();
    const nameEn = form.elements.nameEn.value.trim();
    const branchName = form.elements.branch.value.trim() || t('mainBranch');
    if (!nameAr && !nameEn) return setFieldError(form, 'nameAr', t('required'));
    setFieldError(form, 'nameAr', '');
    busy(submit, async () => {
      const { id, done } = createShop({ nameAr: nameAr || nameEn, nameEn: nameEn || nameAr, branchName }, ctx.user, ctx.profile?.name);
      done.catch((err) => toast(errorText(err), 'error'));
      toast(t('shopCreated'));
      ctx.go(`#/shop/${id}`);
    });
  });
  root.replaceChildren(header(t('createShop'), { back: '#/shops' }), el('main', { class: 'page' }, form));
  focusFirst(form);
}

export function renderShopHome(root, shopId) {
  const shop = ctx.shops.get(shopId);
  const member = ctx.members.get(shopId);
  const disabled = member?.disabled === true;
  const manager = !disabled && (member?.role === 'owner' || member?.role === 'manager');
  root.replaceChildren(
    header(shop ? localName(shop) : t('loading'), { back: '#/shops' }),
    el('main', { class: 'page' },
      el('section', { class: 'card hero' },
        el('h2', {}, shop ? localName(shop) : ''),
        member ? el('span', { class: `badge role-${member.role}` }, roleLabel(member.role)) : null,
        el('p', { class: disabled ? 'form-error' : 'muted' }, disabled ? t('accessDisabled') : t('comingNext')),
      ),
      disabled || !member ? null : el('nav', { class: 'tiles' },
        tile(`#/shop/${shopId}/locations`, 'store', manager ? t('branches') : t('yourLocations')),
        manager ? tile(`#/shop/${shopId}/team`, 'team', t('team')) : null,
      ),
      el('a', { class: 'btn ghost', href: '#/shops' }, t('switchShop')),
    ),
  );
}

export function renderPrefs(root) {
  const p = ctx.profile || {};
  const form = el('form', { class: 'card form', novalidate: true },
    textField({ name: 'name', label: t('yourName'), value: p.name || '' }),
    selectField({ name: 'lang', label: t('language'), value: getLang(), options: [{ value: 'ar', label: 'العربية' }, { value: 'en', label: 'English' }] }),
    selectField({ name: 'digits', label: t('digits'), value: getDigits(), options: [{ value: 'latn', label: t('digitsLatn') }, { value: 'arab', label: t('digitsArab') }] }),
    el('p', { class: 'muted small', dir: 'ltr' }, ctx.user.email),
  );
  // Each field saves on its own.
  form.elements.name.addEventListener('change', (e) => save('name', e.target.value.trim()));
  form.elements.lang.addEventListener('change', (e) => { setLang(e.target.value); save('lang', e.target.value); ctx.rerender(); });
  form.elements.digits.addEventListener('change', (e) => { setDigits(e.target.value); save('digits', e.target.value); ctx.rerender(); });

  root.replaceChildren(
    header(t('preferences'), { back: '#/shops' }),
    el('main', { class: 'page' },
      form,
      el('p', { class: 'muted small center' }, digitsOf('1234567890')),
      el('button', { type: 'button', class: 'btn ghost danger-text', onclick: () => signOut(auth) }, icon('logout'), t('signOut')),
    ),
  );
}

function save(field, value) {
  saveProfileField(ctx.user.uid, field, value).then(() => toast(t('saved'))).catch((err) => toast(errorText(err), 'error'));
}
