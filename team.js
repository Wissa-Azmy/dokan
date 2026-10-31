// Team: members, roles, allowed locations, invites, and joining a shop with a code.
import { t, localName, errorText } from './i18n.js';
import { fmtDate } from './format.js';
import {
  el, icon, iconButton, textField, selectField, checkboxField, checkGroup, checkedValues, setGroupError,
  setFieldError, openDialog, confirmAction, toast, busy, copyText, focusFirst,
} from './forms.js';
import { createInvite, cancelInvite, lookupInvite, acceptInvite, updateMember, removeMember, cleanCode } from './data.js';
import { watchCollection } from './sync.js';
import { where } from './firebase.js';
import { isOwner, isManager, roleLabel } from './roles.js';
import { useLocations } from './locations.js';
import { header } from './screens.js';

export function renderTeam(root, ctx, shopId) {
  const me = ctx.members.get(shopId);
  const shop = ctx.shops.get(shopId);
  const owner = isOwner(me);
  const locations = useLocations(ctx, shopId) || [];
  const members = isManager(me) ? ctx.live(`members:${shopId}`, (set) => watchCollection(['shops', shopId, 'members'], set)) : [];
  const invites = owner ? ctx.live(`invites:${shopId}`, (set) => watchCollection(['shops', shopId, 'invites'], set, where('usedBy', '==', null))) : [];
  const locName = (id) => localName(locations.find((l) => l.id === id)) || '—';

  const memberList = el('div', { class: 'list' });
  if (!members) memberList.append(el('p', { class: 'empty' }, t('loading')));
  const order = { owner: 0, manager: 1, employee: 2 };
  for (const m of [...(members || [])].sort((a, b) => order[a.role] - order[b.role] || String(a.name).localeCompare(String(b.name)))) {
    const self = m.uid === ctx.user.uid;
    const scope = m.role === 'owner' || (m.role === 'manager' && !m.branchIds?.length) ? t('allLocations') : (m.branchIds || []).map(locName).join(' · ');
    memberList.append(
      el('div', { class: `card row ${m.disabled ? 'is-off' : ''}` },
        el('span', { class: 'row-icon' }, icon('user')),
        el('span', { class: 'row-main' },
          el('strong', {}, m.name || m.email, self ? el('span', { class: 'muted small' }, ` · ${t('you')}`) : null),
          el('span', { class: 'row-sub', dir: 'ltr' }, m.email),
          el('span', { class: 'row-meta' },
            el('span', { class: `badge role-${m.role}` }, roleLabel(m.role)),
            el('span', { class: 'muted small' }, scope),
            m.disabled ? el('span', { class: 'badge off' }, t('memberDisabled')) : null,
          ),
        ),
        owner && !self ? el('span', { class: 'row-actions' },
          iconButton('edit', t('edit'), () => memberDialog(shopId, locations, m)),
          iconButton('trash', t('removeMember'), () => remove(shopId, m), 'danger'),
        ) : null,
      ),
    );
  }

  const pending = (invites || []).filter((i) => i.expiresAt?.toMillis() > Date.now());
  const inviteList = owner && pending.length
    ? el('section', { class: 'section' },
      el('h2', { class: 'section-title' }, t('pendingInvites')),
      el('div', { class: 'list' }, pending.map((i) => el('div', { class: 'card row' },
        el('span', { class: 'row-icon' }, icon('key')),
        el('span', { class: 'row-main' },
          el('strong', { class: 'code', dir: 'ltr' }, i.code),
          el('span', { class: 'row-meta' },
            el('span', { class: `badge role-${i.role}` }, roleLabel(i.role)),
            el('span', { class: 'muted small' }, t('expires', { date: fmtDate(i.expiresAt) })),
          ),
        ),
        el('span', { class: 'row-actions' },
          iconButton('share', t('share'), () => showInvite(shop, i.code, i.expiresAt)),
          iconButton('trash', t('cancelInvite'), () => cancel(shopId, i.code), 'danger'),
        ),
      ))),
    )
    : null;

  root.replaceChildren(
    header(t('team'), { back: `#/shop/${shopId}` }),
    el('main', { class: 'page' },
      el('h2', { class: 'section-title' }, t('members')),
      memberList,
      inviteList,
      owner
        ? el('button', { type: 'button', class: 'btn primary', onclick: () => inviteDialog(shop, locations, ctx.user.uid) }, icon('plus'), t('invite'))
        : el('p', { class: 'muted small center' }, t('ownerOnlyTeam')),
    ),
  );
}

// Fields shared by the invite and edit-member dialogs.
function accessFields(locations, { role = 'employee', branchIds = [], canSeeCosts = false } = {}) {
  return [
    selectField({ name: 'role', label: t('role'), value: role, options: [{ value: 'employee', label: t('roleEmployee') }, { value: 'manager', label: t('roleManager') }] }),
    checkGroup({
      name: 'loc',
      label: t('allowedLocations'),
      values: branchIds,
      hint: t('allLocationsHint'),
      options: locations.filter((l) => l.active !== false || branchIds.includes(l.id)).map((l) => ({ value: l.id, label: `${localName(l)} · ${t(l.type)}` })),
    }),
    checkboxField({ name: 'costs', label: t('canSeeCosts'), checked: canSeeCosts }),
  ];
}

function readAccess(form) {
  const role = form.elements.role.value;
  const branchIds = checkedValues(form, 'loc');
  const error = role === 'employee' && !branchIds.length ? t('employeeNeedsBranch') : '';
  setGroupError(form, 'loc', error);
  return error ? null : { role, branchIds, canSeeCosts: form.elements.costs.checked };
}

function inviteDialog(shop, locations, uid) {
  openDialog(t('invite'), (body, close) => {
    const submit = el('button', { type: 'submit', class: 'btn primary' }, t('invite'));
    const form = el('form', { class: 'form', novalidate: true },
      accessFields(locations),
      el('p', { class: 'form-error', role: 'alert' }),
      el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn ghost', onclick: close }, t('cancel')), submit),
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const access = readAccess(form);
      if (!access) return;
      if (!navigator.onLine) { form.querySelector('.form-error').textContent = t('needOnline'); return; }
      busy(submit, async () => {
        try {
          const { code, expiresAt } = await createInvite(shop, access, uid);
          close();
          showInvite(shop, code, expiresAt);
        } catch (err) {
          form.querySelector('.form-error').textContent = errorText(err);
        }
      });
    });
    body.append(form);
  });
}

export function inviteLink(code) {
  return `${location.origin}${location.pathname}#/join/${code}`;
}

function showInvite(shop, code, expiresAt) {
  const link = inviteLink(code);
  const text = `${t('inviteShareText', { shop: localName(shop) })} ${link}\n${t('inviteCode')}: ${code}`;
  openDialog(t('inviteReady'), (body, close) => {
    body.append(
      el('div', { class: 'invite-code', dir: 'ltr' }, code),
      el('p', { class: 'muted small center' }, t('inviteOnce', { date: fmtDate(expiresAt) })),
      el('div', { class: 'invite-link', dir: 'ltr' }, link),
      el('div', { class: 'actions stack' },
        navigator.share ? el('button', { type: 'button', class: 'btn primary', onclick: () => navigator.share({ text }).catch(() => {}) }, icon('share'), t('share')) : null,
        el('button', { type: 'button', class: 'btn ghost', onclick: () => copyText(link) }, icon('copy'), t('copyLink')),
        el('button', { type: 'button', class: 'btn ghost', onclick: close }, t('done')),
      ),
    );
  });
}

function memberDialog(shopId, locations, m) {
  openDialog(m.name || m.email, (body, close) => {
    const form = el('form', { class: 'form', novalidate: true },
      accessFields(locations, m),
      checkboxField({ name: 'disabled', label: t('memberDisabled'), checked: !!m.disabled, hint: t('memberDisabledHint') }),
      el('div', { class: 'actions' },
        el('button', { type: 'button', class: 'btn ghost', onclick: close }, t('cancel')),
        el('button', { type: 'submit', class: 'btn primary' }, t('save')),
      ),
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const access = readAccess(form);
      if (!access) return;
      updateMember(shopId, m.uid, { ...access, disabled: form.elements.disabled.checked }).catch((err) => toast(errorText(err), 'error'));
      toast(t('saved'));
      close();
    });
    body.append(form);
  });
}

async function remove(shopId, m) {
  const yes = await confirmAction({ title: t('removeMember'), message: t('removeMemberMsg', { name: m.name || m.email }), confirmLabel: t('remove'), danger: true });
  if (yes) removeMember(shopId, m.uid).catch((err) => toast(errorText(err), 'error'));
}

async function cancel(shopId, code) {
  const yes = await confirmAction({ title: t('cancelInvite'), message: t('cancelInviteMsg', { code }), confirmLabel: t('cancelInvite'), danger: true });
  if (yes) cancelInvite(shopId, code).catch((err) => toast(errorText(err), 'error'));
}

// ---------- Join ----------

export function renderJoin(root, ctx, code = '') {
  const submit = el('button', { type: 'submit', class: 'btn primary' }, t('join'));
  const form = el('form', { class: 'card form', novalidate: true },
    el('p', { class: 'muted' }, t('joinSoon')),
    textField({ name: 'code', label: t('enterCode'), value: cleanCode(code), dir: 'ltr', autocomplete: 'off' }),
    el('p', { class: 'form-error', role: 'alert' }),
    el('div', { class: 'actions' }, el('a', { class: 'btn ghost', href: '#/shops' }, t('cancel')), submit),
  );
  const input = form.elements.code;
  input.setAttribute('autocapitalize', 'characters');
  input.setAttribute('spellcheck', 'false');
  input.classList.add('code-input');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const errorBox = form.querySelector('.form-error');
    errorBox.textContent = '';
    if (!input.value.trim()) return setFieldError(form, 'code', t('required'));
    setFieldError(form, 'code', '');
    if (!navigator.onLine) { errorBox.textContent = t('needOnline'); return; }
    busy(submit, async () => {
      try {
        const found = await lookupInvite(input.value, ctx.user.uid);
        if (found.error === 'alreadyMember') { toast(t('alreadyMember')); return ctx.go(`#/shop/${found.shopId}`); }
        if (found.error) { errorBox.textContent = t(found.error); return; }
        const { invite } = found;
        const shopName = localName(invite, 'shopName');
        const yes = await confirmAction({ title: t('joinTitle'), message: t('joinAs', { shop: shopName, role: roleLabel(invite.role) }), confirmLabel: t('join') });
        if (!yes) return;
        await acceptInvite(invite, ctx.user, ctx.profile?.name);
        toast(t('joinedShop'));
        ctx.go(`#/shop/${invite.shopId}`);
      } catch (err) {
        errorBox.textContent = errorText(err);
      }
    });
  });

  root.replaceChildren(header(t('joinTitle'), { back: '#/shops' }), el('main', { class: 'page' }, form));
  focusFirst(form);
}
