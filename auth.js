// Sign-in, sign-up and password reset screen.
import { auth, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, updateProfile } from './firebase.js';
import { t, errorText } from './i18n.js';
import { el, textField, setFieldError, focusFirst, busy, toast } from './forms.js';
import { langSwitch, brand } from './screens.js';
import { APP_VERSION } from './version.js';

export function renderAuth(root, mode = 'signIn') {
  const isUp = mode === 'signUp';
  const fromInvite = !!sessionStorage.getItem('dokan.pendingInvite');
  const submit = el('button', { type: 'submit', class: 'btn primary wide' }, isUp ? t('signUp') : t('signIn'));
  const form = el(
    'form',
    { class: 'card auth-card', novalidate: true },
    fromInvite ? el('p', { class: 'note' }, t('signInToJoin')) : null,
    isUp ? textField({ name: 'name', label: t('yourName'), required: true, autocomplete: 'name' }) : null,
    textField({ name: 'email', label: t('email'), type: 'email', required: true, autocomplete: 'email', dir: 'ltr' }),
    textField({ name: 'password', label: t('password'), type: 'password', required: true, autocomplete: isUp ? 'new-password' : 'current-password', dir: 'ltr' }),
    el('p', { class: 'form-error', role: 'alert' }),
    submit,
    el('div', { class: 'auth-links' },
      el('button', { type: 'button', class: 'link', onclick: () => renderAuth(root, isUp ? 'signIn' : 'signUp') }, isUp ? t('haveAccount') : t('noAccount')),
      isUp ? null : el('button', { type: 'button', class: 'link', onclick: () => reset(form) }, t('forgot')),
    ),
  );

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = form.elements.name?.value.trim();
    const email = form.elements.email.value.trim();
    const password = form.elements.password.value;
    let ok = true;
    if (isUp && !name) { setFieldError(form, 'name', t('required')); ok = false; } else if (isUp) setFieldError(form, 'name', '');
    if (!email) { setFieldError(form, 'email', t('required')); ok = false; } else setFieldError(form, 'email', '');
    if (password.length < 6) { setFieldError(form, 'password', t('passwordShort')); ok = false; } else setFieldError(form, 'password', '');
    if (!ok) return;
    form.querySelector('.form-error').textContent = '';
    busy(submit, async () => {
      try {
        if (isUp) {
          sessionStorage.setItem('dokan.pendingName', name);
          const cred = await createUserWithEmailAndPassword(auth, email, password);
          await updateProfile(cred.user, { displayName: name });
        } else {
          await signInWithEmailAndPassword(auth, email, password);
        }
      } catch (err) {
        form.querySelector('.form-error').textContent = errorText(err);
      }
    });
  });

  root.replaceChildren(
    el('div', { class: 'auth-screen' },
      el('div', { class: 'auth-top' }, el('span', { class: 'version-tag' }, `v${APP_VERSION}`), langSwitch(() => renderAuth(root, mode))),
      brand(true),
      el('p', { class: 'tagline' }, t('tagline')),
      form,
    ),
  );
  focusFirst(form);
}

async function reset(form) {
  const email = form.elements.email.value.trim();
  if (!email) return setFieldError(form, 'email', t('enterEmailFirst'));
  try {
    await sendPasswordResetEmail(auth, email);
    toast(t('resetSent'));
  } catch (err) {
    form.querySelector('.form-error').textContent = errorText(err);
  }
}
