// App start: auth state, profile and shop listeners, and hash routing.
import { isConfigured } from './config.js';
import { t, setLang, getLang, errorText } from './i18n.js';
import { el, toast } from './forms.js';
import { setDigits, getDigits } from './format.js';

const root = document.getElementById('app');

if (!isConfigured) {
  root.replaceChildren(el('main', { class: 'page' }, el('div', { class: 'card hero' }, el('h2', {}, t('appName')), el('p', {}, t('notConfigured')))));
} else {
  start();
}

async function start() {
  const { auth, onAuthStateChanged } = await import('./firebase.js');
  const { watchProfile, watchShop, watchMember, saveProfileField } = await import('./sync.js');
  const { renderAuth } = await import('./auth.js');
  const screens = await import('./screens.js');

  const ctx = {
    user: null,
    profile: null,
    shops: new Map(),
    members: new Map(),
    go: (path) => { if (location.hash === path) render(); else location.hash = path; },
    rerender: () => render(),
  };
  screens.initScreens(ctx);

  let stopProfile = null;
  const shopStops = new Map();

  function stopAll() {
    stopProfile?.();
    stopProfile = null;
    for (const stops of shopStops.values()) stops.forEach((s) => s());
    shopStops.clear();
    ctx.shops.clear();
    ctx.members.clear();
  }

  // Keep one shop + membership listener per shop in the user's list.
  function syncShopListeners(ids) {
    for (const [id, stops] of shopStops) {
      if (!ids.includes(id)) { stops.forEach((s) => s()); shopStops.delete(id); ctx.shops.delete(id); ctx.members.delete(id); }
    }
    for (const id of ids) {
      if (shopStops.has(id)) continue;
      shopStops.set(id, [
        watchShop(ctx.user.uid, id, (shop) => { shop ? ctx.shops.set(id, shop) : ctx.shops.delete(id); refresh(); }),
        watchMember(id, ctx.user.uid, (m) => { m ? ctx.members.set(id, m) : ctx.members.delete(id); refresh(); }),
      ]);
    }
  }

  onAuthStateChanged(auth, (user) => {
    stopAll();
    ctx.user = user;
    ctx.profile = null;
    if (!user) return render();
    renderLoading();
    stopProfile = watchProfile(
      user,
      (profile) => {
        const first = !ctx.profile;
        ctx.profile = profile;
        // The cloud wins: apply the saved language and digits to this device.
        if (profile.lang && profile.lang !== getLang()) setLang(profile.lang);
        if (profile.digits && profile.digits !== getDigits()) setDigits(profile.digits);
        syncShopListeners(profile.shopIds || []);
        if (first && (!location.hash || location.hash === '#/') && profile.lastShopId && profile.shopIds?.includes(profile.lastShopId)) {
          location.hash = `#/shop/${profile.lastShopId}`;
        }
        first ? render() : refresh();
      },
      (err) => toast(errorText(err), 'error'),
    );
  });

  window.addEventListener('hashchange', render);

  function renderLoading() {
    root.replaceChildren(el('div', { class: 'splash' }, screens.brand(true), el('p', { class: 'muted' }, t('loading'))));
  }

  const parseRoute = () => (location.hash || '#/shops').split('/').slice(1);

  // Live data updates redraw list screens only, so forms being typed into are never reset.
  function refresh() {
    const [route] = parseRoute();
    if (route !== 'new-shop' && route !== 'prefs') render();
  }

  function render() {
    if (!ctx.user) return renderAuth(root);
    if (!ctx.profile) return renderLoading();
    const [route, id] = parseRoute();
    if (route === 'new-shop') return screens.renderNewShop(root);
    if (route === 'prefs') return screens.renderPrefs(root);
    if (route === 'shop' && id && (ctx.profile.shopIds || []).includes(id)) {
      if (ctx.profile.lastShopId !== id) saveProfileField(ctx.user.uid, 'lastShopId', id).catch(() => {});
      return screens.renderShopHome(root, id);
    }
    return screens.renderShops(root);
  }

  // Offline banner.
  const banner = document.getElementById('offline');
  const updateOnline = () => { banner.hidden = navigator.onLine; banner.textContent = t('offline'); };
  window.addEventListener('online', updateOnline);
  window.addEventListener('offline', updateOnline);
  updateOnline();
}
