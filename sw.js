// Service worker: lets the app open without internet. App files are network-first (so a push
// shows up on the next reload) with the cached copy as the offline fallback. Firebase SDK files
// and fonts are versioned, so they're served from the cache once fetched.
// Firestore traffic and the dollar-rate APIs are never touched here.
const CACHE = 'dokan-v1';

const APP_FILES = [
  './', './index.html', './style.css', './manifest.webmanifest', './icon.svg',
  './app.js', './auth.js', './backup.js', './buying.js', './cash.js', './categories.js', './config.js', './count.js',
  './csv.js', './customers.js', './dashboard.js', './data.js', './expenses.js', './firebase.js', './format.js',
  './forms.js', './fx.js', './i18n.js', './locations.js', './movements.js', './picker.js', './prices.js',
  './pricing.js', './products.js', './purchases.js', './rates.js', './receipt.js', './roles.js', './sales.js',
  './scanner.js', './screens.js', './sell.js', './selling.js', './settings.js', './stock.js', './suppliers.js',
  './sync.js', './team.js',
];

const isLibrary = (url) =>
  (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/'))
  || url.hostname === 'fonts.googleapis.com'
  || url.hostname === 'fonts.gstatic.com'
  || (url.hostname === 'unpkg.com' && url.pathname.startsWith('/html5-qrcode@'));

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // One missing file must not stop the rest from being cached.
      .then((cache) => Promise.all(APP_FILES.map((f) => cache.add(f).catch(() => {}))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const own = url.origin === self.location.origin;
  if (!own && !isLibrary(url)) return;

  if (own) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('./index.html'))),
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok || res.type === 'opaque') caches.open(CACHE).then((c) => c.put(req, res.clone()));
      return res;
    })),
  );
});
