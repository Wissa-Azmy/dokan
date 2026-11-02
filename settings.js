// Shop settings (owner): name, pricing, receipt. Every field saves on its own as soon as it changes,
// so two devices editing different fields never overwrite each other.
import { t, errorText } from './i18n.js';
import { optionalNum } from './format.js';
import { el, icon, textField, numberField, selectField, checkboxField, setFieldError, toast } from './forms.js';
import { saveShopSetting, saveShopField } from './sync.js';
import { header } from './screens.js';
import { formulaBox } from './prices.js';
import { DEFAULT_SETTINGS } from './data.js';

export function renderSettings(root, ctx, shopId) {
  const shop = ctx.shops.get(shopId);
  if (!shop) {
    root.replaceChildren(header(t('shopSettings'), { back: `#/shop/${shopId}` }), el('main', { class: 'page' }, el('p', { class: 'empty' }, t('loading'))));
    return false;
  }
  // Missing settings show the defaults but are never written unless the owner changes them.
  const s = { ...DEFAULT_SETTINGS, ...(shop.settings || {}) };
  const saved = (p) => p.then(() => toast(t('saved'))).catch((err) => toast(errorText(err), 'error'));

  const form = el('form', { class: 'form', novalidate: true },
    el('section', { class: 'card form' },
      el('h2', { class: 'section-title' }, t('details')),
      textField({ name: 'nameAr', label: t('shopNameAr'), value: shop.nameAr || '', dir: 'rtl' }),
      textField({ name: 'nameEn', label: t('shopNameEn'), value: shop.nameEn || '', dir: 'ltr' }),
    ),
    el('section', { class: 'card form' },
      el('h2', { class: 'section-title' }, t('pricingSection')),
      numberField({ name: 'markupPct', label: t('shopMarkup'), value: String(s.markupPct ?? ''), hint: t('shopMarkupHint') }),
      numberField({ name: 'roundStep', label: t('roundStep'), value: String(s.roundStep ?? ''), hint: t('roundStepHint') }),
      numberField({ name: 'passThroughPct', label: t('passThrough'), value: String(s.passThroughPct ?? ''), hint: t('passThroughHint') }),
      selectField({ name: 'rateMode', label: t('rateMode'), value: s.rateMode || 'auto', options: [
        { value: 'auto', label: t('rateModeAuto') }, { value: 'manual', label: t('rateModeManual') },
      ] }),
      el('a', { class: 'btn ghost', href: `#/shop/${shopId}/rate` }, icon('globe'), t('usdRateTitle')),
    ),
    el('section', { class: 'card form' },
      el('h2', { class: 'section-title' }, t('receipt')),
      textField({ name: 'receiptFooter', label: t('receiptFooter'), value: s.receiptFooter || '', hint: t('receiptFooterHint') }),
    ),
    el('section', { class: 'card form' },
      el('h2', { class: 'section-title' }, t('homeCard')),
      checkboxField({ name: 'hideHomeMoney', label: t('hideHomeMoney'), checked: !!s.hideHomeMoney, hint: t('hideHomeMoneyHint') }),
    ),
  );
  const f = form.elements;
  form.addEventListener('submit', (e) => e.preventDefault());

  for (const key of ['nameAr', 'nameEn']) {
    f[key].addEventListener('change', () => {
      const v = f[key].value.trim();
      if (key === 'nameAr' && !v) return setFieldError(form, key, t('required'));
      setFieldError(form, key, '');
      saved(saveShopField(shopId, key, v));
    });
  }
  const limits = { markupPct: 1000, roundStep: 1000, passThroughPct: 100 };
  for (const [key, max] of Object.entries(limits)) {
    f[key].addEventListener('change', () => {
      const n = optionalNum(f[key].value);
      const bad = n == null || Number.isNaN(n) || n > max;
      setFieldError(form, key, bad ? t('rangeError', { max }) : '');
      if (!bad) saved(saveShopSetting(shopId, key, n));
    });
  }
  f.rateMode.addEventListener('change', () => saved(saveShopSetting(shopId, 'rateMode', f.rateMode.value)));
  f.receiptFooter.addEventListener('change', () => saved(saveShopSetting(shopId, 'receiptFooter', f.receiptFooter.value.trim())));
  f.hideHomeMoney.addEventListener('change', () => saved(saveShopSetting(shopId, 'hideHomeMoney', f.hideHomeMoney.checked)));

  root.replaceChildren(
    header(t('shopSettings'), { back: `#/shop/${shopId}` }),
    el('main', { class: 'page' },
      form,
      formulaBox(s),
      el('section', { class: 'card form danger-zone' },
        el('h2', { class: 'section-title' }, t('backupTitle')),
        el('p', { class: 'muted small' }, t('backupIntro')),
        el('a', { class: 'btn ghost', href: `#/shop/${shopId}/backup` }, icon('copy'), t('openBackup')),
      ),
    ),
  );
  return true;
}
