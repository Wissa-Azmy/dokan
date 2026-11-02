// Selling screen: a fast, phone-first till. Search or scan to add, adjust quantities, then check out
// with one or more payment methods, a down payment, or credit. Works offline.
import { t, getLang, localName, errorText } from './i18n.js';
import { fmtMoney, fmtNum, parseNum, getDigits } from './format.js';
import { el, icon, iconButton, numberField, dateField, openDialog, toast, isTouch } from './forms.js';
import { isManager } from './roles.js';
import { header } from './screens.js';
import { useProducts } from './products.js';
import { useLocations } from './locations.js';
import { useStock, stockMap, myLocations } from './stock.js';
import { productPicker, findByCode, listenForScanner } from './picker.js';
import { scanDialog } from './scanner.js';
import { useCustomers, useCustomerAccounts, customerBalance, pickCustomerDialog } from './customers.js';
import { receiptDialog } from './receipt.js';
import { today } from './suppliers.js';
import { nextNumber, round2 } from './buying.js';
import { qtyAt, roundQty } from './movements.js';
import { saleTotals, settle, recordSale, SALE_METHODS } from './selling.js';

// The cart survives reloads and live updates: { locId, lines: [{ productId, qty, price }], customerId, discount }.
const cartKey = (shopId) => `dokan.cart.${shopId}`;
const loadCart = (shopId) => { try { return JSON.parse(localStorage.getItem(cartKey(shopId))) || null; } catch { return null; } };
const saveCart = (shopId, cart) => localStorage.setItem(cartKey(shopId), JSON.stringify(cart));

let view = null;

export function renderSell(root, ctx, shopId) {
  const me = ctx.members.get(shopId);
  const data = {
    products: useProducts(ctx, shopId),
    locations: useLocations(ctx, shopId),
    stock: useStock(ctx, shopId),
    customers: useCustomers(ctx, shopId),
    accounts: useCustomerAccounts(ctx, shopId),
  };
  const look = getLang() + getDigits();
  if (view && view.shopId === shopId && view.look === look && root.contains(view.page)) return view.update(data);

  let cur = data;
  const canEditPrice = isManager(me);
  const cart = loadCart(shopId) || { locId: null, lines: [], customerId: null, discount: 0 };
  const persist = () => saveCart(shopId, cart);
  const branches = () => myLocations(me, cur.locations).filter((l) => l.type === 'branch');
  const product = (id) => (cur.products || []).find((p) => p.id === id);

  const locSelect = el('select', { class: 'input select', 'aria-label': t('branch') });
  locSelect.addEventListener('change', () => { cart.locId = locSelect.value; persist(); drawLines(); });
  const locWrap = el('span', { class: 'select-wrap' }, locSelect);

  const picker = productPicker({ getProducts: () => cur.products, onPick: (p) => add(p), placeholder: t('addToShelf') });
  // Each scan adds one piece; the card shows how many of it are in this sale now.
  const camBtn = iconButton('scan', t('scanTitle'), () => scanDialog((code) => {
    const p = findByCode(cur.products, code);
    if (!p) return { kind: 'warn', name: code, note: t('codeNotFound', { code }) };
    if (!add(p)) return { kind: 'warn', name: localName(p), meta: p.brand, note: t('noPriceAsk') };
    const qty = cart.lines.find((l) => l.productId === p.id)?.qty || 1;
    return { kind: 'ok', name: localName(p), meta: p.brand, n: fmtNum(qty), unit: t('inThisSale') };
  }, { title: t('scanProducts') }), 'big');

  const linesBox = el('div', { class: 'cart' });
  const totalEl = el('strong', { class: 'cart-total' });
  const countEl = el('span', { class: 'muted small' });
  const checkoutBtn = el('button', { type: 'button', class: 'btn primary', onclick: () => checkout() }, t('checkout'));
  const clearBtn = iconButton('trash', t('clearCart'), () => { cart.lines = []; cart.customerId = null; cart.discount = 0; persist(); drawLines(); }, 'danger');

  // Adds one of a product, or one more if it's already in the cart. Returns true if added.
  function add(p) {
    const line = cart.lines.find((l) => l.productId === p.id);
    if (line) {
      line.qty = roundQty(line.qty + 1);
    } else {
      if (p.price == null && !canEditPrice) { toast(t('noPriceAsk'), 'error'); return false; }
      cart.lines.unshift({ productId: p.id, qty: 1, price: p.price ?? null });
    }
    persist();
    drawLines();
    return true;
  }

  function drawLines() {
    linesBox.replaceChildren();
    const map = stockMap(cur.stock);
    if (!cart.lines.length) linesBox.append(el('p', { class: 'empty' }, t('cartEmpty')));
    for (const line of cart.lines) {
      const p = product(line.productId);
      const available = qtyAt(map.get(line.productId), cart.locId);
      const qtyInput = el('input', { type: 'text', inputmode: 'decimal', class: 'input num qty-input', value: String(line.qty), 'aria-label': t('qty') });
      qtyInput.addEventListener('change', () => {
        const n = parseNum(qtyInput.value);
        if (!Number.isNaN(n) && n > 0) line.qty = roundQty(n);
        persist();
        drawLines();
      });
      const step = (d) => () => { line.qty = roundQty(Math.max(line.qty + d, 0)); if (!line.qty) cart.lines.splice(cart.lines.indexOf(line), 1); persist(); drawLines(); };
      let priceEl;
      if (canEditPrice) {
        priceEl = el('input', { type: 'text', inputmode: 'decimal', class: 'input num price-input', value: line.price != null ? String(line.price) : '', placeholder: t('price'), 'aria-label': t('price') });
        priceEl.addEventListener('change', () => {
          const n = parseNum(priceEl.value);
          line.price = Number.isNaN(n) || n < 0 ? null : n;
          persist();
          drawLines();
        });
      } else {
        priceEl = el('span', { class: 'muted' }, fmtMoney(line.price));
      }
      linesBox.append(el('div', { class: `cart-line ${line.qty > available ? 'short' : ''}` },
        el('div', { class: 'line-head' },
          el('strong', {}, p ? localName(p) : t('unknownProduct')),
          iconButton('trash', t('delete'), () => { cart.lines.splice(cart.lines.indexOf(line), 1); persist(); drawLines(); }, 'danger'),
        ),
        el('div', { class: 'cart-controls' },
          el('div', { class: 'stepper' },
            el('button', { type: 'button', class: 'icon-btn', 'aria-label': '−', onclick: step(-1) }, '−'),
            qtyInput,
            el('button', { type: 'button', class: 'icon-btn', 'aria-label': '+', onclick: step(1) }, '+'),
          ),
          priceEl,
          el('strong', { class: 'money' }, line.price != null ? fmtMoney(line.qty * line.price) : '—'),
        ),
        el('span', { class: `small ${line.qty > available ? 'neg' : 'muted'}` }, `${t('available')}: ${fmtNum(available, 3)}${p ? ` ${t(`unit_${p.unit}`)}` : ''}`),
      ));
    }
    const { total } = saleTotals(cart.lines.filter((l) => l.price != null), cart.discount);
    totalEl.textContent = fmtMoney(total);
    countEl.textContent = t('itemsCount', { n: fmtNum(cart.lines.length) });
    checkoutBtn.disabled = !cart.lines.length;
    clearBtn.hidden = !cart.lines.length;
  }

  function fillLocations() {
    const list = branches();
    locSelect.replaceChildren(...list.map((l) => el('option', { value: l.id }, localName(l))));
    if (!list.some((l) => l.id === cart.locId)) { cart.locId = list[0]?.id || null; persist(); }
    locSelect.value = cart.locId || '';
    locWrap.hidden = list.length < 2;
  }

  // ---------- Checkout ----------

  function checkout() {
    if (!cart.locId) return toast(t('noStockLocations'), 'error');
    if (cart.lines.some((l) => l.price == null)) return toast(t('missingPrice'), 'error');
    const loc = (cur.locations || []).find((l) => l.id === cart.locId);

    openDialog(t('checkout'), (body, close) => {
      const payments = [{ method: 'cash', amount: '' }];
      let customerId = cart.customerId;
      // A customer added just now isn't in the live list yet, so keep what the picker returned.
      let picked = null;
      const customer = () => (cur.customers || []).find((c) => c.id === customerId) || (picked?.id === customerId ? picked : null);

      const customerRow = el('div', { class: 'sum-line customer-row' });
      const discountField = numberField({ name: 'discount', label: t('discount'), value: cart.discount ? String(cart.discount) : '' });
      const payBox = el('div', { class: 'list' });
      const summary = el('div', { class: 'summary' });
      const dueField = dateField({ name: 'due', label: t('dueDate') });
      const errorBox = el('p', { class: 'form-error', role: 'alert' });
      const confirmBtn = el('button', { type: 'button', class: 'btn primary wide' }, t('confirmSale'));

      const discountInput = discountField.querySelector('input');
      const totals = () => {
        const d = parseNum(discountInput.value);
        return saleTotals(cart.lines, Number.isNaN(d) ? 0 : d);
      };
      const readPayments = () => payments.map((p) => ({ method: p.method, amount: (() => { const n = parseNum(p.amount); return Number.isNaN(n) ? 0 : n; })() }));

      function drawCustomer() {
        const c = customer();
        customerRow.replaceChildren(
          el('span', {}, t('customer')),
          el('button', { type: 'button', class: 'chip', onclick: () => pickCustomerDialog(ctx, shopId, (p) => { picked = p; customerId = p?.id || null; drawCustomer(); recalc(); }) },
            icon('user'), c ? `${c.name} · ${fmtMoney(customerBalance(cur.accounts, c.id))}` : t('noCustomer')),
        );
      }

      function drawPayments() {
        payBox.replaceChildren();
        payments.forEach((p, i) => {
          const method = el('select', { class: 'input select', 'aria-label': t('method') },
            SALE_METHODS.map((m) => el('option', { value: m, selected: m === p.method }, t(`pay_${m}`))));
          method.addEventListener('change', () => { p.method = method.value; recalc(); });
          const amount = el('input', { type: 'text', inputmode: 'decimal', class: 'input num', value: p.amount, placeholder: t('amount'), 'aria-label': t('amount') });
          amount.addEventListener('input', () => { p.amount = amount.value; recalc(); });
          payBox.append(el('div', { class: 'pay-row' },
            el('span', { class: 'select-wrap' }, method),
            amount,
            payments.length > 1 ? iconButton('trash', t('delete'), () => { payments.splice(i, 1); drawPayments(); recalc(); }, 'danger') : null,
          ));
        });
      }

      function recalc() {
        const tot = totals();
        const s = settle(tot.total, readPayments());
        errorBox.textContent = s.error ? t(s.error) : '';
        dueField.hidden = !(s.onCredit > 0);
        // Only the lines that apply; empty ones are left out (replaceChildren would print "null").
        summary.replaceChildren(...[
          el('div', { class: 'sum-line total' }, el('span', {}, t('total')), el('strong', {}, fmtMoney(tot.total))),
          s.error ? null : el('div', { class: 'sum-line' }, el('span', {}, t('paidNow')), el('span', {}, fmtMoney(s.paid))),
          s.change ? el('div', { class: 'sum-line change' }, el('span', {}, t('change')), el('strong', {}, fmtMoney(s.change))) : null,
          !s.error && s.onCredit > 0 ? el('div', { class: 'sum-line credit' }, el('span', {}, t('pay_credit')), el('strong', {}, fmtMoney(s.onCredit))) : null,
        ].filter(Boolean));
        return { tot, s };
      }
      discountInput.addEventListener('input', recalc);

      const quick = el('div', { class: 'seg-group three' },
        el('button', { type: 'button', class: 'btn ghost', onclick: () => { payments.splice(0, payments.length, { method: 'cash', amount: String(totals().total) }); drawPayments(); recalc(); } }, t('exactCash')),
        el('button', { type: 'button', class: 'btn ghost', onclick: () => { payments.push({ method: 'instapay', amount: '' }); drawPayments(); recalc(); } }, icon('plus'), t('splitPayment')),
        el('button', { type: 'button', class: 'btn ghost', onclick: () => { payments.splice(0, payments.length, { method: 'cash', amount: '' }); drawPayments(); recalc(); } }, t('allOnCredit')),
      );

      confirmBtn.addEventListener('click', () => {
        const { tot, s } = recalc();
        if (s.error) return;
        const d = parseNum(discountInput.value);
        if (!Number.isNaN(d) && (d < 0 || d > tot.subtotal)) { errorBox.textContent = t('discountTooBig'); return; }
        if (s.onCredit > 0 && !customerId) { errorBox.textContent = t('creditNeedsCustomer'); return; }

        const sale = {
          number: nextNumber(shopId, 'S', loc.code),
          locationId: loc.id,
          date: today(),
          clientAt: new Date().toISOString(),
          customerId: customerId || null,
          lines: cart.lines.map((l) => ({ productId: l.productId, qty: l.qty, price: round2(l.price) })),
          subtotal: tot.subtotal,
          discount: tot.discount,
          total: tot.total,
          payments: s.payments,
          paid: s.paid,
          change: s.change,
          onCredit: s.onCredit,
          dueDate: s.onCredit > 0 ? dueField.querySelector('input').value || null : null,
        };
        const { done } = recordSale(shopId, sale, ctx.user.uid);
        done.catch((err) => toast(errorText(err), 'error'));

        cart.lines = [];
        cart.customerId = null;
        cart.discount = 0;
        persist();
        drawLines();
        close();
        receiptDialog(sale, { shop: ctx.shops.get(shopId), location: loc, products: cur.products || [], customer: customer() }, [
          { label: t('newSale'), primary: true, onclick: () => {} },
        ]);
      });

      drawCustomer();
      drawPayments();
      body.append(
        customerRow,
        discountField,
        el('span', { class: 'field-label' }, t('paymentTitle')),
        payBox,
        quick,
        summary,
        dueField,
        errorBox,
        confirmBtn,
      );
      recalc();
    });
  }

  const page = el('main', { class: 'page sell-page' },
    el('div', { class: 'sell-top' }, locWrap, el('div', { class: 'sell-search' }, picker.element, camBtn)),
    linesBox,
    el('div', { class: 'cart-bar' },
      el('div', { class: 'cart-sum' }, countEl, totalEl),
      clearBtn,
      checkoutBtn,
    ),
  );
  root.replaceChildren(header(t('sell'), { back: `#/shop/${shopId}` }), page);

  function update(next) {
    cur = next;
    if (!cur.locations) return;
    fillLocations();
    drawLines();
  }
  view = { shopId, look, page, update };
  update(data);
  listenForScanner(page, (code) => {
    const p = findByCode(cur.products, code);
    if (!p) return toast(t('codeNotFound', { code }), 'error');
    if (add(p)) toast(`✓ ${localName(p)}`);
  });
  if (!isTouch()) page.querySelector('.picker input')?.focus();
}
