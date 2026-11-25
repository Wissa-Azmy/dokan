// "Install app" button. Chrome and Edge (computer and Android) offer their own install window,
// which the button opens; Safari and other browsers have no such window, so the button explains
// the steps for that device instead. Hidden once the app runs installed.
import { t } from './i18n.js';
import { el, icon, openDialog, toast } from './forms.js';

let promptEvent = null;
const waiting = new Set(); // buttons to show once the browser says it can install

// Must be listened for from the first moment, so this module is imported by app.js at start.
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  promptEvent = e;
  for (const b of waiting) b.hidden = false;
});
window.addEventListener('appinstalled', () => {
  promptEvent = null;
  for (const b of waiting) b.remove();
  waiting.clear();
  toast(t('appInstalled'));
});

const installed = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const ua = navigator.userAgent;
const isIos = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isSafari = /Safari/.test(ua) && !/Chrome|CriOS|Edg|FxiOS|Firefox|OPR/.test(ua);
const isFirefox = /Firefox|FxiOS/.test(ua);

// Which steps to show when the browser has no install window of its own.
function manualSteps() {
  if (isIos) return t('installIos');
  if (isSafari) return t('installMacSafari');
  if (isFirefox) return t('installFirefox');
  return t('installChromium');
}

function explain() {
  openDialog(t('installApp'), (body, close) => {
    body.append(
      el('p', { class: 'confirm-text' }, manualSteps()),
      el('p', { class: 'muted small' }, t('installWhy')),
      el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn primary', onclick: close }, t('done'))),
    );
  });
}

async function install() {
  if (!promptEvent) return explain();
  const e = promptEvent;
  promptEvent = null;
  e.prompt();
  await e.userChoice.catch(() => null);
}

// A full-width button, or null when the app is already installed.
// On Chrome/Edge it waits hidden until the browser confirms the app can be installed.
export function installButton() {
  if (installed()) return null;
  const b = el('button', { type: 'button', class: 'btn ghost', onclick: install }, icon('download'), t('installApp'));
  const chromium = !isIos && !isSafari && !isFirefox;
  if (chromium && !promptEvent) {
    // Chrome/Edge: shown when the install window is ready. If it never comes (already
    // installed in another profile, or blocked), the button stays hidden.
    b.hidden = true;
    waiting.add(b);
  }
  return b;
}
