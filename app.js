// App start: auth state, profile and shop listeners, and hash routing.
import { isConfigured } from './config.js';
import { t, setLang, getLang, errorText } from './i18n.js';
import { el, toast } from './forms.js';
import { setDigits, getDigits } from './format.js';

const root = document.getElementById('app');

// Lets the app itself open without internet after the first visits (see sw.js).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

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
  const { renderLocations } = await import('./locations.js');
  const { renderTeam, renderJoin } = await import('./team.js');
  const { renderCategories } = await import('./categories.js');
  const { renderProducts, renderProductForm } = await import('./products.js');
  const { renderStock } = await import('./stock.js');
  const { renderCount } = await import('./count.js');
  const { renderSuppliers, renderSupplier } = await import('./suppliers.js');
  const { renderPurchases, renderPurchaseForm } = await import('./purchases.js');
  const { isCostManager } = await import('./roles.js');
  const { renderSell } = await import('./sell.js');
  const { renderSales, renderSale } = await import('./sales.js');
  const { renderCustomers, renderCustomer } = await import('./customers.js');
  const { renderRate } = await import('./rates.js');
  const { dailyRateCheck } = await import('./fx.js');
  const { renderPrices } = await import('./prices.js');
  const { renderSettings } = await import('./settings.js');
  const { renderExpenses } = await import('./expenses.js');
  const { renderCash } = await import('./cash.js');
  const { renderDashboard } = await import('./dashboard.js');
  const { renderBackup } = await import('./backup.js');

  // Listeners opened by screens for the shop being viewed; closed when leaving that shop.
  const live = new Map();
  let liveShopId = null;

  const ctx = {
    user: null,
    profile: null,
    shops: new Map(),
    members: new Map(),
    go: (path) => { if (location.hash === path) render(); else location.hash = path; },
    rerender: () => render(),
    // Returns the latest data for key (null until the first snapshot), starting the listener once.
    live: (key, startFn) => {
      if (!live.has(key)) {
        const entry = { data: null, stop: null };
        live.set(key, entry);
        entry.stop = startFn((data) => { entry.data = data; refresh(); });
      }
      return live.get(key).data;
    },
  };
  screens.initScreens(ctx);

  function stopLive() {
    for (const entry of live.values()) entry.stop?.();
    live.clear();
  }

  let stopProfile = null;
  const shopStops = new Map(); // shopId → { shop, member } unsubscribe functions

  function stopAll() {
    stopProfile?.();
    stopProfile = null;
    for (const s of shopStops.values()) { s.shop?.(); s.member?.(); }
    shopStops.clear();
    ctx.shops.clear();
    ctx.members.clear();
    stopLive();
    liveShopId = null;
  }

  function startShopWatch(id) {
    return watchShop(ctx.user.uid, id, (shop) => { shop ? ctx.shops.set(id, shop) : ctx.shops.delete(id); refresh(); });
  }

  // Keep one shop + membership listener per shop in the user's list.
  function syncShopListeners(ids) {
    for (const [id, s] of shopStops) {
      if (!ids.includes(id)) { s.shop?.(); s.member?.(); shopStops.delete(id); ctx.shops.delete(id); ctx.members.delete(id); }
    }
    for (const id of ids) {
      if (shopStops.has(id)) continue;
      const s = { shop: startShopWatch(id), member: null };
      s.member = watchMember(id, ctx.user.uid, (m) => {
        const was = ctx.members.get(id);
        m ? ctx.members.set(id, m) : ctx.members.delete(id);
        // A refused listener stops for good, so restart it when access comes back.
        if (m && !m.disabled && was?.disabled) {
          s.shop?.();
          s.shop = startShopWatch(id);
          if (liveShopId === id) stopLive();
        }
        refresh();
      });
      shopStops.set(id, s);
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
        if (first) {
          const pending = sessionStorage.getItem('dokan.pendingInvite');
          sessionStorage.removeItem('dokan.pendingInvite');
          if (pending) location.hash = `#/join/${pending}`;
          else if ((!location.hash || location.hash === '#/') && profile.lastShopId && profile.shopIds?.includes(profile.lastShopId)) {
            location.hash = `#/shop/${profile.lastShopId}`;
          }
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
  const FORM_ROUTES = ['new-shop', 'prefs', 'join'];
  const FORM_SUBS = ['product', 'purchase', 'prices', 'settings'];
  let formReady = false; // a shop form screen is drawn with all its data
  let waiting = false; // a live update arrived while someone was typing

  const typing = () => {
    const a = document.activeElement;
    return a && root.contains(a) && a.matches('input:not([type=checkbox]):not([type=radio]), textarea, select');
  };

  // Live data updates redraw list screens only, so forms being typed into are never reset.
  // A shop form still waiting for its data is redrawn until it's ready. While a field has focus,
  // the redraw waits until it loses focus, so the phone keyboard doesn't close mid-number.
  function refresh() {
    const [route, , sub] = parseRoute();
    if (FORM_ROUTES.includes(route)) return;
    if (FORM_SUBS.includes(sub) && formReady) return;
    if (typing()) { waiting = true; return; }
    render();
  }
  root.addEventListener('focusout', () => {
    setTimeout(() => { if (waiting && !typing()) { waiting = false; refresh(); } }, 0);
  });

  function render() {
    const [route, id, sub, subId] = parseRoute();
    formReady = false;
    waiting = false;
    if (!ctx.user) {
      // Keep an invite link through sign-in or sign-up.
      if (route === 'join' && id) sessionStorage.setItem('dokan.pendingInvite', id);
      return renderAuth(root);
    }
    if (!ctx.profile) return renderLoading();

    const inShop = route === 'shop' && id && (ctx.profile.shopIds || []).includes(id);
    if (liveShopId !== (inShop ? id : null)) { stopLive(); liveShopId = inShop ? id : null; }

    if (route === 'new-shop') return screens.renderNewShop(root);
    if (route === 'prefs') return screens.renderPrefs(root);
    if (route === 'join') return renderJoin(root, ctx, id || '');
    if (inShop) {
      if (ctx.profile.lastShopId !== id) saveProfileField(ctx.user.uid, 'lastShopId', id).catch(() => {});
      const me = ctx.members.get(id);
      const usable = me && !me.disabled;
      if (usable && sub === 'locations') return renderLocations(root, ctx, id);
      if (usable && sub === 'team') return renderTeam(root, ctx, id);
      if (usable && sub === 'sell') return renderSell(root, ctx, id);
      if (usable && sub === 'sales') return renderSales(root, ctx, id);
      if (usable && sub === 'sale' && subId) return renderSale(root, ctx, id, subId);
      if (usable && sub === 'customers') return renderCustomers(root, ctx, id);
      if (usable && sub === 'customer' && subId) return renderCustomer(root, ctx, id, subId);
      if (usable && sub === 'products') return renderProducts(root, ctx, id);
      if (usable && sub === 'categories') return renderCategories(root, ctx, id);
      if (usable && sub === 'stock') return renderStock(root, ctx, id);
      if (usable && sub === 'count' && ['owner', 'manager'].includes(me.role)) return renderCount(root, ctx, id);
      if (usable && sub === 'suppliers' && ['owner', 'manager'].includes(me.role)) return renderSuppliers(root, ctx, id);
      if (usable && sub === 'supplier' && subId && isCostManager(me)) return renderSupplier(root, ctx, id, subId);
      if (usable && sub === 'purchases') return renderPurchases(root, ctx, id);
      if (usable && sub === 'purchase' && subId) {
        formReady = renderPurchaseForm(root, ctx, id, subId);
        return;
      }
      if (usable && sub === 'product' && subId && ['owner', 'manager'].includes(me.role)) {
        formReady = renderProductForm(root, ctx, id, subId);
        return;
      }
      const manager = usable && ['owner', 'manager'].includes(me.role);
      if (usable && sub === 'rate' && manager) return renderRate(root, ctx, id);
      if (usable && sub === 'prices' && isCostManager(me)) {
        formReady = renderPrices(root, ctx, id);
        return;
      }
      if (usable && sub === 'settings' && me.role === 'owner') {
        formReady = renderSettings(root, ctx, id);
        return;
      }
      if (usable && sub === 'backup' && me.role === 'owner') return renderBackup(root, ctx, id);
      if (usable && sub === 'expenses' && manager) return renderExpenses(root, ctx, id);
      if (usable && sub === 'cash') return renderCash(root, ctx, id);
      if (usable && sub === 'dashboard' && manager) return renderDashboard(root, ctx, id);
      if (usable) dailyRateCheck(ctx, id);
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
