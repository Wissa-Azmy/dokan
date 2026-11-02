// Loading view (spinner, live status, shimmer skeleton) and the "new version available" check.
// Only depends on i18n and forms, so it can show before the rest of the app has loaded.
import { t } from './i18n.js';
import { el, icon } from './forms.js';
import { APP_VERSION } from './version.js';

const SLOW_MS = 12000;
const UPDATE_CHECK_EVERY = 60000;

let statusKey = 'loadStarting';
let slowTimer = null;

export function setLoadStatus(key) {
  statusKey = key;
  const box = document.querySelector('.loading-status');
  if (box) box.textContent = t(key);
}

// Draws the loading view, or just updates its status if it's already showing.
// retry() runs when "Try again" is tapped.
export function renderLoadingView(root, { retry } = {}) {
  if (!navigator.onLine) statusKey = 'loadOffline';
  const existing = root.querySelector('.loading-view');
  if (existing) {
    existing.retry = retry;
    setLoadStatus(statusKey);
    return;
  }
  const slow = el('div', { class: 'loading-slow', hidden: true },
    el('p', {}, t('loadSlow')),
    el('button', { type: 'button', class: 'btn primary', onclick: () => {
      slow.hidden = true;
      setLoadStatus('loadRetrying');
      startSlowTimer();
      (view.retry || (() => location.reload()))();
    } }, t('tryAgain')),
  );
  const card = () => el('div', { class: 'card sk-card' },
    el('span', { class: 'sk sk-icon' }),
    el('span', { class: 'sk-lines' }, el('span', { class: 'sk sk-line w70' }), el('span', { class: 'sk sk-line w40' })),
  );
  const view = el('div', { class: 'loading-view', role: 'status', 'aria-live': 'polite' },
    el('div', { class: 'brand big' }, el('span', { class: 'brand-mark' }, icon('store')), el('span', { class: 'brand-name' }, t('appName'))),
    el('div', { class: 'loading-line' }, el('span', { class: 'spinner', 'aria-hidden': 'true' }), el('span', { class: 'loading-status' }, t(statusKey))),
    el('div', { class: 'skeleton' }, card(), card(), card()),
    slow,
    el('span', { class: 'version-tag' }, `v${APP_VERSION}`),
  );
  view.retry = retry;
  root.replaceChildren(view);

  function startSlowTimer() {
    clearTimeout(slowTimer);
    slowTimer = setTimeout(() => { if (view.isConnected) slow.hidden = false; }, SLOW_MS);
  }
  startSlowTimer();
}

// Shown if the app's own files fail to load (e.g. the connection dropped mid-load).
export function renderLoadError(root, err) {
  console.error(err);
  root.replaceChildren(el('div', { class: 'loading-view' },
    el('div', { class: 'brand big' }, el('span', { class: 'brand-mark' }, icon('store')), el('span', { class: 'brand-name' }, t('appName'))),
    el('p', { class: 'form-error center' }, t('loadFailed')),
    el('button', { type: 'button', class: 'btn primary', onclick: () => location.reload() }, t('tryAgain')),
    el('span', { class: 'version-tag' }, `v${APP_VERSION}`),
  ));
}

// ---------- New version check ----------

let lastCheck = 0;

async function checkForUpdate() {
  if (!navigator.onLine || Date.now() - lastCheck < UPDATE_CHECK_EVERY) return;
  lastCheck = Date.now();
  try {
    const res = await fetch(`./version.js?check=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const latest = (await res.text()).match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/)?.[1];
    if (latest && latest !== APP_VERSION) showUpdateBanner(latest);
  } catch {
    // Offline or blocked: try again next time.
  }
}

function showUpdateBanner(latest) {
  if (document.getElementById('update-banner')) return;
  const banner = el('div', { id: 'update-banner', class: 'update-banner', role: 'status' },
    el('span', {}, t('newVersion', { v: latest })),
    el('button', { type: 'button', class: 'btn primary', onclick: async () => {
      // Let the offline worker fetch the new files too, then reload.
      try { await (await navigator.serviceWorker?.getRegistration())?.update(); } catch { /* ignore */ }
      location.reload();
    } }, t('reload')),
  );
  document.body.append(banner);
}

export function startUpdateChecks() {
  checkForUpdate();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForUpdate(); });
  window.addEventListener('online', checkForUpdate);
}
