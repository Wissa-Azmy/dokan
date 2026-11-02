// USD rate screen: today's rate, fetch now, type it by hand (owner), and the history.
import { t, errorText } from './i18n.js';
import { fmtNum, fmtDate, parseNum } from './format.js';
import { el, icon, numberField, setFieldError, openDialog, toast, busy } from './forms.js';
import { watchCollection } from './sync.js';
import { orderBy, limit } from './firebase.js';
import { isOwner } from './roles.js';
import { header } from './screens.js';
import { fetchUsdEgp, saveRate } from './fx.js';

export function renderRate(root, ctx, shopId) {
  const me = ctx.members.get(shopId);
  const s = ctx.shops.get(shopId)?.settings || {};
  const history = ctx.live(`fxRates:${shopId}`, (set) => watchCollection(['shops', shopId, 'fxRates'], set, orderBy('date', 'desc'), limit(60)));

  const fetchBtn = el('button', { type: 'button', class: 'btn primary' }, icon('globe'), t('fetchRate'));
  fetchBtn.addEventListener('click', () => busy(fetchBtn, async () => {
    try {
      const r = await fetchUsdEgp();
      await saveRate(shopId, { ...r, manual: false }, ctx.user.uid);
      toast(t('rateSaved', { n: fmtNum(r.rate, 4) }));
    } catch (err) {
      toast(err.code === 'fx-unavailable' ? t('rateUnavailable') : errorText(err), 'error');
    }
  }));

  root.replaceChildren(
    header(t('usdRateTitle'), { back: `#/shop/${shopId}` }),
    el('main', { class: 'page' },
      el('section', { class: 'card hero balance-card' },
        el('span', { class: 'muted' }, t('rateToday')),
        el('strong', { class: 'big-money' }, s.usdRate ? `${fmtNum(s.usdRate, 4)} ${t('egp')}` : '—'),
        s.rateDate ? el('span', { class: 'muted small' }, `${fmtDate(s.rateDate)} · ${s.rateManual ? t('rateManual') : s.rateSource || ''}`) : null,
        s.rateMode === 'manual' ? el('span', { class: 'badge low' }, t('rateModeManual')) : null,
      ),
      el('div', { class: 'actions' },
        isOwner(me) ? el('button', { type: 'button', class: 'btn ghost', onclick: () => manualDialog(ctx, shopId) }, icon('edit'), t('typeRate')) : null,
        fetchBtn,
      ),
      el('p', { class: 'muted small' }, t('rateHint')),
      el('h2', { class: 'section-title' }, t('rateHistory')),
      el('div', { class: 'list' },
        !history ? el('p', { class: 'empty' }, t('loading'))
          : !history.length ? el('p', { class: 'empty' }, t('noActivity'))
            : history.map((r, i) => {
              const prev = history[i + 1];
              const change = prev ? ((r.rate - prev.rate) / prev.rate) * 100 : 0;
              return el('div', { class: 'card row' },
                el('span', { class: 'row-main' },
                  el('strong', {}, fmtDate(r.date)),
                  el('span', { class: 'row-sub' }, r.manual ? t('rateManual') : r.source),
                ),
                prev && Math.abs(change) >= 0.01 ? el('span', { class: `small ${change > 0 ? 'neg' : 'pos'}` }, `${change > 0 ? '▲' : '▼'} ${fmtNum(Math.abs(change), 2)}%`) : null,
                el('span', { class: 'money' }, fmtNum(r.rate, 4)),
              );
            }),
      ),
    ),
  );
}

function manualDialog(ctx, shopId) {
  openDialog(t('typeRate'), (body, close) => {
    const form = el('form', { class: 'form', novalidate: true },
      numberField({ name: 'rate', label: t('usdRateTitle'), value: String(ctx.shops.get(shopId)?.settings?.usdRate || '') }),
      el('div', { class: 'actions' },
        el('button', { type: 'button', class: 'btn ghost', onclick: close }, t('cancel')),
        el('button', { type: 'submit', class: 'btn primary' }, t('save')),
      ),
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const rate = parseNum(form.elements.rate.value);
      const bad = Number.isNaN(rate) || rate <= 1;
      setFieldError(form, 'rate', bad ? t('needRate') : '');
      if (bad) return;
      saveRate(shopId, { rate, source: 'manual', manual: true }, ctx.user.uid).catch((err) => toast(errorText(err), 'error'));
      toast(t('rateSaved', { n: fmtNum(rate, 4) }));
      close();
    });
    body.append(form);
  });
}
