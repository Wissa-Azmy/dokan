// Price check: products whose price is below the suggested price after the dollar moved,
// updated in one go. Only for people who can see costs.
import { t, localName, errorText } from './i18n.js';
import { fmtMoney, fmtNum } from './format.js';
import { el, icon, toast, busy } from './forms.js';
import { db, doc, writeBatch, serverTimestamp } from './firebase.js';
import { watchCollection } from './sync.js';
import { header } from './screens.js';
import { useProducts } from './products.js';
import { useCategories } from './categories.js';
import { suggestedPrice, workedExample } from './pricing.js';

const PER_BATCH = 400;

export function useCosts(ctx, shopId) {
  return ctx.live(`costs:${shopId}`, (set) => watchCollection(['shops', shopId, 'costs'], set));
}

// The formula, explained with the shop's own numbers.
export function formulaBox(settings) {
  const x = workedExample(settings);
  return el('details', { class: 'card info-box' },
    el('summary', {}, icon('tag'), t('howPricing')),
    el('p', {}, t('formulaText')),
    el('p', { class: 'formula', dir: 'ltr' }, t('formulaShort')),
    el('ol', {},
      el('li', {}, t('exStep1', { cost: fmtMoney(x.cost), r0: fmtNum(x.r0), r1: fmtNum(x.r1, 4) })),
      el('li', {}, t('exStep2', { pass: fmtNum(x.pass), adj: fmtMoney(x.adj) })),
      el('li', {}, t('exStep3', { markup: fmtNum(x.markup), raw: fmtMoney(x.raw) })),
      el('li', {}, x.step ? t('exStep4', { step: fmtMoney(x.step), price: fmtMoney(x.price) }) : t('exStep4none', { price: fmtMoney(x.price) })),
    ),
    el('p', { class: 'muted small' }, t('formulaNote')),
  );
}

// Returns true once drawn with all its data, so ticking boxes isn't undone by live updates.
export function renderPrices(root, ctx, shopId) {
  const back = `#/shop/${shopId}`;
  const shop = ctx.shops.get(shopId);
  const settings = shop?.settings || {};
  const products = useProducts(ctx, shopId);
  const categories = useCategories(ctx, shopId);
  const costs = useCosts(ctx, shopId);
  if (!products || !categories || !costs) {
    root.replaceChildren(header(t('priceCheck'), { back }), el('main', { class: 'page' }, el('p', { class: 'empty' }, t('loading'))));
    return false;
  }
  const costOf = new Map(costs.map((c) => [c.id, c]));
  const rows = products
    .filter((p) => p.active !== false)
    .map((p) => ({ p, s: suggestedPrice(p, costOf.get(p.id), categories, settings) }))
    .filter(({ p, s }) => s && s.price > (p.price ?? 0) + 0.009)
    .sort((a, b) => (b.s.price - (b.p.price ?? 0)) / (b.p.price || 1) - (a.s.price - (a.p.price ?? 0)) / (a.p.price || 1));

  const checks = new Map();
  const applyBtn = el('button', { type: 'button', class: 'btn primary wide' });
  const countSelected = () => [...checks.values()].filter((c) => c.checked).length;
  const updateBtn = () => { const n = countSelected(); applyBtn.textContent = t('updatePrices', { n: fmtNum(n) }); applyBtn.disabled = !n; };

  const list = el('div', { class: 'list' });
  if (!rows.length) list.append(el('p', { class: 'empty' }, t('pricesOk')));
  for (const { p, s } of rows) {
    const box = el('input', { type: 'checkbox', checked: true, 'aria-label': localName(p) });
    box.addEventListener('change', updateBtn);
    checks.set(p.id, box);
    const up = p.price ? ((s.price - p.price) / p.price) * 100 : null;
    list.append(el('label', { class: 'card row price-row' },
      box,
      el('span', { class: 'row-main' },
        el('strong', {}, localName(p)),
        el('span', { class: 'row-sub' }, t('costLine', {
          cost: fmtMoney(costOf.get(p.id).avgCost),
          rate: s.buyRate ? fmtNum(s.buyRate, 2) : '—',
          markup: fmtNum(s.markup.pct),
        })),
      ),
      el('span', { class: 'price-change' },
        el('span', { class: 'muted small old' }, p.price != null ? fmtMoney(p.price) : t('noPrice')),
        el('strong', { class: 'price' }, fmtMoney(s.price)),
        up != null ? el('span', { class: 'small neg' }, `+${fmtNum(up, 1)}%`) : null,
      ),
    ));
  }
  updateBtn();

  applyBtn.addEventListener('click', () => busy(applyBtn, async () => {
    const chosen = rows.filter(({ p }) => checks.get(p.id)?.checked);
    try {
      for (let i = 0; i < chosen.length; i += PER_BATCH) {
        const batch = writeBatch(db);
        for (const { p, s } of chosen.slice(i, i + PER_BATCH)) {
          batch.update(doc(db, 'shops', shopId, 'products', p.id), { price: s.price, priceUpdatedAt: serverTimestamp() });
        }
        // Not awaited when offline: the update is queued and syncs later.
        const commit = batch.commit();
        if (navigator.onLine) await commit; else commit.catch((err) => toast(errorText(err), 'error'));
      }
      toast(t('pricesUpdated', { n: fmtNum(chosen.length) }));
      ctx.rerender();
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }));

  root.replaceChildren(
    header(t('priceCheck'), { back }),
    el('main', { class: 'page' },
      settings.usdRate
        ? el('p', { class: 'note' }, t('priceCheckIntro', { rate: fmtNum(settings.usdRate, 4) }))
        : el('a', { class: 'note', href: `#/shop/${shopId}/rate` }, t('noRateYet')),
      formulaBox(settings),
      list,
      rows.length ? el('div', { class: 'sticky-actions' }, applyBtn) : null,
    ),
  );
  return true;
}
