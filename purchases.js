// Purchases: invoice list, new invoice / goods receipt, adding prices to a receipt, and viewing.
import { t, localName, errorText } from './i18n.js';
import { fmtMoney, fmtNum, fmtDate, parseNum, optionalNum } from './format.js';
import {
  el, icon, iconButton, textField, numberField, selectField, dateField, setFieldError, toast, busy, isTouch,
} from './forms.js';
import { watchCollection, watchDoc } from './sync.js';
import { where, orderBy, limit } from './firebase.js';
import { isCostManager } from './roles.js';
import { header } from './screens.js';
import { useProducts } from './products.js';
import { useLocations } from './locations.js';
import { myLocations } from './stock.js';
import { productPicker } from './picker.js';
import { useSuppliers, supplierName, today } from './suppliers.js';
import {
  invoiceTotals, paymentStatus, receivePurchase, addPurchaseCosts, applyCosting, nextNumber, round2,
} from './buying.js';
import { roundQty } from './movements.js';

const RECENT = 100;

function usePurchaseLists(ctx, shopId) {
  const me = ctx.members.get(shopId);
  if (isCostManager(me)) {
    return {
      pending: ctx.live(`purchasesPending:${shopId}`, (set) => watchCollection(['shops', shopId, 'purchases'], set, where('status', '==', 'received'))),
      recent: ctx.live(`purchasesRecent:${shopId}`, (set) => watchCollection(['shops', shopId, 'purchases'], set, orderBy('createdAt', 'desc'), limit(RECENT))),
    };
  }
  // Employees only see their own receipts that are still waiting for prices.
  return {
    pending: ctx.live(`purchasesMine:${shopId}`, (set) => watchCollection(['shops', shopId, 'purchases'], set,
      where('createdBy', '==', ctx.user.uid), where('status', '==', 'received'), where('costsEntered', '==', false))),
    recent: [],
  };
}

const locName = (locations, id) => localName((locations || []).find((l) => l.id === id)) || '—';

// ---------- List ----------

export function renderPurchases(root, ctx, shopId) {
  const me = ctx.members.get(shopId);
  const costs = isCostManager(me);
  const { pending, recent } = usePurchaseLists(ctx, shopId);
  const suppliers = useSuppliers(ctx, shopId);
  const locations = useLocations(ctx, shopId);

  const row = (p) => el('a', { class: 'card row link-row', href: `#/shop/${shopId}/purchase/${p.id}` },
    el('span', { class: 'row-main' },
      el('strong', {}, supplierName(suppliers, p.supplierId)),
      el('span', { class: 'row-sub' }, [p.number, fmtDate(p.date), locName(locations, p.locationId), t('itemsCount', { n: fmtNum(p.lines?.length || 0) })].join(' · ')),
      el('span', { class: 'row-meta' },
        p.status === 'received'
          ? el('span', { class: 'badge low' }, p.costsEntered ? t('waitingCosting') : t('waitingCosts'))
          : el('span', { class: `badge status-${p.paymentStatus}` }, t(`status_${p.paymentStatus}`)),
      ),
    ),
    costs && p.total != null ? el('span', { class: 'money' }, fmtMoney(p.total)) : null,
  );

  const pendingRows = [...(pending || [])].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const recentRows = (recent || []).filter((p) => p.status === 'costed');

  root.replaceChildren(
    header(costs ? t('purchases') : t('receiveGoods'), { back: `#/shop/${shopId}` }),
    el('main', { class: 'page' },
      el('a', { class: 'btn primary', href: `#/shop/${shopId}/purchase/new` }, icon('plus'), costs ? t('newPurchase') : t('receiveGoods')),
      pendingRows.length ? el('section', { class: 'section' },
        el('h2', { class: 'section-title' }, costs ? t('waitingCosts') : t('receiveGoods')),
        el('div', { class: 'list' }, pendingRows.map(row)),
      ) : null,
      costs ? el('section', { class: 'section' },
        el('h2', { class: 'section-title' }, t('recentPurchases')),
        el('div', { class: 'list' },
          !recent ? el('p', { class: 'empty' }, t('loading'))
            : recentRows.length ? recentRows.map(row) : el('p', { class: 'empty' }, t('noPurchases')),
        ),
      ) : null,
      !costs && pending && !pending.length ? el('p', { class: 'empty' }, t('employeeReceiveHint')) : null,
    ),
  );
}

// ---------- Form ----------

// Returns true once drawn with all its data, so live updates leave it alone while typing.
export function renderPurchaseForm(root, ctx, shopId, purchaseId) {
  const back = `#/shop/${shopId}/purchases`;
  const me = ctx.members.get(shopId);
  const costs = isCostManager(me);
  const isNew = purchaseId === 'new';
  const products = useProducts(ctx, shopId);
  const locations = useLocations(ctx, shopId);
  const suppliers = useSuppliers(ctx, shopId);
  const existing = isNew ? undefined : ctx.live(`purchase:${purchaseId}`, (set) => watchDoc(['shops', shopId, 'purchases', purchaseId], set));
  const title = isNew ? (costs ? t('newPurchase') : t('receiveGoods')) : t('purchase');

  const show = (message) => { root.replaceChildren(header(title, { back }), el('main', { class: 'page' }, el('p', { class: 'empty' }, message))); return false; };
  // existing: null while loading, false if missing or not allowed.
  if (!products || !locations || !suppliers || existing === null) return show(t('loading'));
  if (existing === false) return show(t('noMatches'));

  // A costed invoice, or one with prices already entered, is shown read-only and kept live.
  if (!isNew && (existing.status === 'costed' || existing.costsEntered || !costs)) {
    renderView(root, ctx, shopId, existing, { products, locations, suppliers, back, costs });
    return false;
  }

  const mine = myLocations(me, locations);
  if (isNew && !mine.length) return show(t('noStockLocations'));
  const completing = !isNew; // adding prices to an employee's receipt
  const lines = []; // { productId, qtyInput, costInput }
  const extras = []; // { labelInput, amountInput, onInvoiceInput, row }
  const productById = (id) => products.find((p) => p.id === id);
  // The shop's rate of the day comes first; the last rate typed on this device is the fallback.
  const lastRate = ctx.shops.get(shopId)?.settings?.usdRate || localStorage.getItem(`dokan.usdRate.${shopId}`) || '';

  const form = el('form', { class: 'form', novalidate: true });
  const linesBox = el('div', { class: 'list' });
  const extrasBox = el('div', { class: 'list' });
  const summary = el('div', { class: 'summary' });

  const header1 = el('section', { class: 'card form' },
    costs || completing
      ? selectField({ name: 'supplier', label: t('supplier'), value: existing?.supplierId || '', options: [
        { value: '', label: '—' },
        ...suppliers.filter((s) => s.active !== false || s.id === existing?.supplierId).sort((a, b) => a.name.localeCompare(b.name)).map((s) => ({ value: s.id, label: s.name })),
      ] })
      : selectField({ name: 'supplier', label: t('supplier'), value: '', options: [
        { value: '', label: t('noSupplier') },
        ...suppliers.filter((s) => s.active !== false).sort((a, b) => a.name.localeCompare(b.name)).map((s) => ({ value: s.id, label: s.name })),
      ] }),
    dateField({ name: 'date', label: t('date'), value: existing?.date || today() }),
    completing
      ? el('p', { class: 'muted' }, `${t('receivingLocation')}: ${locName(locations, existing.locationId)}`)
      : selectField({ name: 'loc', label: t('receivingLocation'), value: mine[0]?.id, options: mine.map((l) => ({ value: l.id, label: `${localName(l)} · ${t(l.type)}` })) }),
    costs ? numberField({ name: 'rate', label: t('usdRate'), value: String(lastRate), hint: t('usdRateHint') }) : null,
    textField({ name: 'note', label: t('note'), value: existing?.note || '' }),
    costs ? null : el('p', { class: 'note' }, t('employeeReceiveHint')),
  );

  const picker = completing ? null : productPicker({ getProducts: () => products, onPick: (p, { scanned }) => addLine(p, scanned) });
  const linesCard = el('section', { class: 'card form' },
    el('h2', { class: 'section-title' }, t('linesTitle')),
    completing ? el('p', { class: 'note' }, t('qtyLocked')) : picker.element,
    linesBox,
    el('p', { class: 'field-error', role: 'alert', 'data-for': 'lines' }),
  );

  const discountField = numberField({ name: 'discount', label: t('discount') });
  const extrasCard = costs ? el('section', { class: 'card form' },
    el('h2', { class: 'section-title' }, t('discountExtras')),
    discountField,
    el('span', { class: 'field-label' }, t('extraCosts')),
    extrasBox,
    el('button', { type: 'button', class: 'btn ghost', onclick: () => addExtra() }, icon('plus'), t('addExtraCost')),
    el('p', { class: 'field-hint' }, t('extrasHint')),
  ) : null;

  // 'credit' and 'full' stay selected while the total changes; typing an amount makes it 'custom'.
  let payMode = 'credit';
  const creditBtn = el('button', { type: 'button', class: 'btn ghost seg', onclick: () => { payMode = 'credit'; recalc(); } }, t('onCredit'));
  const fullBtn = el('button', { type: 'button', class: 'btn ghost seg', onclick: () => { payMode = 'full'; recalc(); } }, t('paidFull'));
  const paidField = numberField({ name: 'paid', label: t('paid') });
  const payCard = costs ? el('section', { class: 'card form' },
    el('h2', { class: 'section-title' }, t('paymentTitle')),
    summary,
    el('div', { class: 'seg-group' }, creditBtn, fullBtn),
    paidField,
  ) : null;

  const submit = el('button', { type: 'submit', class: 'btn primary' }, t('save'));
  form.append(header1, linesCard, extrasCard, payCard,
    el('p', { class: 'form-error', role: 'alert' }),
    el('div', { class: 'actions sticky-actions' }, el('a', { class: 'btn ghost', href: back }, t('cancel')), submit),
  );

  function addLine(p, scanned, preset) {
    const found = lines.find((l) => l.productId === p.id);
    if (found && !preset) {
      if (scanned) found.qtyInput.value = String(roundQty((parseNum(found.qtyInput.value) || 0) + 1));
      if (!isTouch()) found.qtyInput.focus({ preventScroll: true });
      return recalc();
    }
    const qtyInput = el('input', { type: 'text', inputmode: 'decimal', class: 'input num', value: preset ? String(preset.qty) : scanned ? '1' : '', readonly: completing || null, 'aria-label': t('qty') });
    const costInput = costs ? el('input', { type: 'text', inputmode: 'decimal', class: 'input num', value: preset?.unitCost != null ? String(preset.unitCost) : '', 'aria-label': t('unitCost') }) : null;
    const landed = el('div', { class: 'line-cost' });
    const line = { productId: p.id, qtyInput, costInput, landed };
    const rowEl = el('div', { class: 'line' },
      el('div', { class: 'line-head' },
        el('strong', {}, localName(p)),
        completing ? null : iconButton('trash', t('delete'), () => { lines.splice(lines.indexOf(line), 1); rowEl.remove(); recalc(); }, 'danger'),
      ),
      el('div', { class: 'line-fields' },
        el('label', { class: 'field' }, el('span', { class: 'field-label' }, `${t('qty')} (${t(`unit_${p.unit}`)})`), qtyInput),
        costInput ? el('label', { class: 'field' }, el('span', { class: 'field-label' }, t('unitCost')), costInput) : null,
      ),
      costs ? landed : null,
    );
    line.row = rowEl;
    lines.push(line);
    linesBox.append(rowEl);
    listen(qtyInput, costInput);
    recalc();
  }

  // Recalculate on every kind of change, so totals follow typing, pasting, autofill and ticks.
  function listen(...inputs) {
    for (const input of inputs) {
      if (!input) continue;
      input.addEventListener('input', recalc);
      input.addEventListener('change', recalc);
      input.addEventListener('keyup', recalc);
    }
  }

  function addExtra() {
    const labelInput = el('input', { class: 'input', placeholder: t('extraLabel'), 'aria-label': t('extraLabel') });
    const amountInput = el('input', { type: 'text', inputmode: 'decimal', class: 'input num', placeholder: t('amount'), 'aria-label': t('amount') });
    const onInvoiceInput = el('input', { type: 'checkbox' });
    const x = { labelInput, amountInput, onInvoiceInput };
    x.row = el('div', { class: 'line' },
      el('div', { class: 'line-fields' }, labelInput, amountInput),
      el('div', { class: 'line-head' },
        el('label', { class: 'check' }, onInvoiceInput, el('span', { class: 'check-text' }, t('onSupplierInvoice'))),
        iconButton('trash', t('delete'), () => { extras.splice(extras.indexOf(x), 1); x.row.remove(); recalc(); }, 'danger'),
      ),
    );
    extras.push(x);
    extrasBox.append(x.row);
    for (const input of [amountInput, onInvoiceInput]) listen(input);
    recalc();
  }

  const numOr0 = (v) => { const n = parseNum(v); return Number.isNaN(n) ? 0 : n; };
  const readLines = () => lines.map((l) => ({ productId: l.productId, qty: numOr0(l.qtyInput.value), unitCost: l.costInput ? numOr0(l.costInput.value) : null }));
  const readExtras = () => extras.map((x) => ({ label: x.labelInput.value.trim(), amount: numOr0(x.amountInput.value), onInvoice: x.onInvoiceInput.checked }))
    .filter((x) => x.amount > 0);
  const totals = () => invoiceTotals({ lines: readLines(), discount: numOr0(discountField.querySelector('input').value), extras: readExtras() });

  function recalc() {
    if (!costs) return;
    const tot = totals();
    const data = readLines();
    lines.forEach((l, i) => {
      const { qty, unitCost } = data[i];
      l.landed.replaceChildren();
      if (!qty || !unitCost) return;
      l.landed.append(
        el('span', {}, `${t('lineTotal')}: ${fmtMoney(round2(qty * unitCost))}`),
        el('strong', {}, t('landedCost', { n: fmtMoney(tot.landed[i]) })),
      );
    });

    const paidInput = paidField.querySelector('input');
    if (payMode === 'credit') paidInput.value = '0';
    if (payMode === 'full') paidInput.value = String(tot.total);
    const paid = numOr0(paidInput.value);
    creditBtn.classList.toggle('on', payMode === 'credit');
    fullBtn.classList.toggle('on', payMode === 'full');
    creditBtn.setAttribute('aria-pressed', String(payMode === 'credit'));
    fullBtn.setAttribute('aria-pressed', String(payMode === 'full'));

    summary.replaceChildren(
      el('div', { class: 'sum-line' }, el('span', {}, t('subtotal')), el('span', {}, fmtMoney(tot.subtotal))),
      el('div', { class: 'sum-line total' }, el('span', {}, t('total')), el('strong', {}, fmtMoney(tot.total))),
      el('p', { class: 'muted small' }, t('remaining', { n: fmtMoney(round2(tot.total - paid)) })),
    );
  }
  listen(discountField.querySelector('input'));
  // Typing an amount switches to a custom payment.
  paidField.querySelector('input').addEventListener('input', () => { payMode = 'custom'; recalc(); });

  if (completing) existing.lines.forEach((l) => addLine(productById(l.productId) || { id: l.productId, unit: 'piece', nameAr: t('unknownProduct') }, false, l));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = form.elements;
    const errorBox = form.querySelector('.form-error');
    errorBox.textContent = '';
    const linesError = form.querySelector('[data-for=lines]');
    const data = readLines();
    let ok = true;

    linesError.textContent = data.length ? '' : t('needLines');
    if (!data.length) ok = false;
    lines.forEach((l) => {
      const q = parseNum(l.qtyInput.value);
      const badQ = Number.isNaN(q) || q <= 0;
      l.qtyInput.classList.toggle('invalid', badQ);
      const c = l.costInput ? optionalNum(l.costInput.value) : 0;
      const badC = l.costInput && (c == null || Number.isNaN(c));
      l.costInput?.classList.toggle('invalid', !!badC);
      if (badQ || badC) ok = false;
    });
    let rate = null;
    if (costs) {
      setFieldError(form, 'supplier', f.supplier.value ? '' : t('needSupplier'));
      if (!f.supplier.value) ok = false;
      rate = parseNum(f.rate.value);
      const badRate = Number.isNaN(rate) || rate <= 0;
      setFieldError(form, 'rate', badRate ? t('needRate') : '');
      if (badRate) ok = false;
      for (const name of ['discount', 'paid']) {
        const bad = Number.isNaN(optionalNum(f[name].value));
        setFieldError(form, name, bad ? t('invalidNumber') : '');
        if (bad) ok = false;
      }
    }
    if (!ok) { errorBox.textContent = t('checkFields'); return; }

    const tot = costs ? totals() : null;
    const paid = costs ? round2(numOr0(f.paid.value)) : null;
    if (costs && paid > tot.total) { setFieldError(form, 'paid', t('paidTooMuch')); return; }

    const costFields = costs ? {
      supplierId: f.supplier.value,
      date: f.date.value || today(),
      note: f.note.value.trim(),
      lines: data.map((l) => ({ ...l, qty: roundQty(l.qty), usdRate: rate })),
      discount: round2(numOr0(f.discount.value)),
      extras: readExtras(),
      subtotal: tot.subtotal,
      total: tot.total,
      paid,
      paymentStatus: paymentStatus(tot.total, paid),
      usdRate: rate,
    } : null;
    if (costs) localStorage.setItem(`dokan.usdRate.${shopId}`, String(rate));

    busy(submit, async () => {
      if (completing) {
        if (!navigator.onLine) { errorBox.textContent = t('needOnline'); return; }
        try {
          await addPurchaseCosts(shopId, existing.id, costFields);
          await applyCosting(shopId, existing.id, ctx.user.uid);
          toast(t('costedOk'));
        } catch (err) {
          errorBox.textContent = errorText(err);
          return;
        }
        ctx.go(back);
        return;
      }

      const loc = locations.find((l) => l.id === f.loc.value);
      const purchase = costs
        ? { ...costFields, number: nextNumber(shopId, 'P', loc.code), locationId: loc.id, costsEntered: true }
        : {
          number: nextNumber(shopId, 'P', loc.code),
          supplierId: f.supplier.value || null,
          date: f.date.value || today(),
          locationId: loc.id,
          note: f.note.value.trim(),
          lines: data.map((l) => ({ productId: l.productId, qty: roundQty(l.qty), unitCost: null })),
          discount: 0, extras: [], subtotal: null, total: null, paid: null, paymentStatus: null, usdRate: null,
          costsEntered: false,
        };
      const { id, done } = receivePurchase(shopId, purchase, ctx.user.uid);
      if (costs && navigator.onLine) {
        done.then(() => applyCosting(shopId, id, ctx.user.uid))
          .then(() => toast(t('costedOk')))
          .catch(() => toast(t('costingLater'), 'error'));
      } else {
        done.catch((err) => toast(errorText(err), 'error'));
        toast(costs ? t('costingLater') : t('receiptSaved'));
      }
      ctx.go(back);
    });
  });

  root.replaceChildren(header(completing ? t('addCosts') : title, { back }), el('main', { class: 'page' }, form));
  recalc();
  return true;
}

// ---------- Read-only view ----------

function renderView(root, ctx, shopId, p, { products, locations, suppliers, back, costs }) {
  const productById = (id) => products.find((x) => x.id === id);
  const waiting = p.status === 'received' && p.costsEntered;
  const applyBtn = waiting && costs ? el('button', { type: 'button', class: 'btn primary' }, t('applyCostingBtn')) : null;
  applyBtn?.addEventListener('click', () => busy(applyBtn, async () => {
    if (!navigator.onLine) return toast(t('needOnline'), 'error');
    try {
      await applyCosting(shopId, p.id, ctx.user.uid);
      toast(t('costedOk'));
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }));

  root.replaceChildren(
    header(p.number, { back }),
    el('main', { class: 'page' },
      el('section', { class: 'card form' },
        el('div', { class: 'sum-line' }, el('span', {}, t('supplier')), el('strong', {}, supplierName(suppliers, p.supplierId))),
        el('div', { class: 'sum-line' }, el('span', {}, t('date')), el('span', {}, fmtDate(p.date))),
        el('div', { class: 'sum-line' }, el('span', {}, t('receivingLocation')), el('span', {}, locName(locations, p.locationId))),
        p.usdRate ? el('div', { class: 'sum-line' }, el('span', {}, t('usdRate')), el('span', {}, fmtNum(p.usdRate))) : null,
        p.note ? el('p', { class: 'muted' }, p.note) : null,
        p.status === 'received'
          ? el('span', { class: 'badge low' }, p.costsEntered ? t('waitingCosting') : t('waitingCosts'))
          : el('span', { class: `badge status-${p.paymentStatus}` }, t(`status_${p.paymentStatus}`)),
      ),
      el('section', { class: 'card form' },
        el('h2', { class: 'section-title' }, t('linesTitle')),
        p.lines.map((l) => {
          const prod = productById(l.productId);
          return el('div', { class: 'sum-line' },
            el('span', {}, `${prod ? localName(prod) : t('unknownProduct')} × ${fmtNum(l.qty, 3)}`),
            costs && l.unitCost != null ? el('span', {}, fmtMoney(l.unitCost)) : null,
          );
        }),
      ),
      costs && p.total != null ? el('section', { class: 'card form' },
        el('div', { class: 'sum-line' }, el('span', {}, t('subtotal')), el('span', {}, fmtMoney(p.subtotal))),
        p.discount ? el('div', { class: 'sum-line' }, el('span', {}, t('discount')), el('span', {}, `−${fmtMoney(p.discount)}`)) : null,
        (p.extras || []).map((x) => el('div', { class: 'sum-line' }, el('span', {}, x.label || t('extraCosts')), el('span', {}, fmtMoney(x.amount)))),
        el('div', { class: 'sum-line total' }, el('span', {}, t('total')), el('strong', {}, fmtMoney(p.total))),
        el('div', { class: 'sum-line' }, el('span', {}, t('paid')), el('span', {}, fmtMoney(p.paid))),
      ) : null,
      p.status === 'costed' ? el('p', { class: 'muted small' }, t('purchaseLocked')) : null,
      applyBtn,
    ),
  );
}
