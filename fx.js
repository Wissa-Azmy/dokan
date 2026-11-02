// USD → EGP rate: fetched once a day from free sources (with a fallback), kept as history in
// fxRates/{date}, and copied into the shop's settings so every screen uses the same rate.
import { db, doc, writeBatch, serverTimestamp } from './firebase.js';
import { isManager } from './roles.js';
import { today } from './suppliers.js';

const SOURCES = [
  { name: 'open.er-api.com', url: 'https://open.er-api.com/v6/latest/USD', pick: (d) => d?.rates?.EGP },
  { name: 'currency-api (jsDelivr)', url: 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json', pick: (d) => d?.usd?.egp },
];

const round4 = (n) => Math.round(n * 10000) / 10000;

export async function fetchUsdEgp() {
  for (const s of SOURCES) {
    try {
      const res = await fetch(s.url, { cache: 'no-store' });
      if (!res.ok) continue;
      const rate = Number(s.pick(await res.json()));
      if (rate > 1 && rate < 10000) return { rate: round4(rate), source: s.name };
    } catch {
      // try the next source
    }
  }
  throw Object.assign(new Error('No rate source answered'), { code: 'fx-unavailable' });
}

// Saves today's rate in the history and in the shop's settings, field by field.
export function saveRate(shopId, { rate, source, manual }, uid) {
  const date = today();
  const batch = writeBatch(db);
  batch.set(doc(db, 'shops', shopId, 'fxRates', date), { date, rate, source, manual: !!manual, by: uid, at: serverTimestamp() });
  batch.update(doc(db, 'shops', shopId), {
    'settings.usdRate': rate,
    'settings.rateDate': date,
    'settings.rateSource': source,
    'settings.rateManual': !!manual,
    updatedAt: serverTimestamp(),
  });
  return batch.commit();
}

// Runs when an owner or manager opens a shop: fetches the rate if today's isn't saved yet.
const checked = new Set();
export async function dailyRateCheck(ctx, shopId) {
  if (checked.has(shopId) || !navigator.onLine) return;
  const shop = ctx.shops.get(shopId);
  const me = ctx.members.get(shopId);
  if (!shop || !isManager(me)) return;
  checked.add(shopId);
  const s = shop.settings || {};
  if (s.rateMode === 'manual' || s.rateDate === today()) return;
  try {
    const { rate, source } = await fetchUsdEgp();
    await saveRate(shopId, { rate, source, manual: false }, ctx.user.uid);
  } catch {
    checked.delete(shopId); // try again next time the shop opens
  }
}
