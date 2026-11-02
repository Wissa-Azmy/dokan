// Receipts: on screen, as text for WhatsApp or the share sheet, and printed at 58 or 80 mm.
import { t, localName } from './i18n.js';
import { fmtMoney, fmtNum, fmtDate, digitsOf } from './format.js';
import { el, icon, openDialog, copyText } from './forms.js';
import { waNumber } from './customers.js';

// The printer width is a choice of this device, since each till has its own printer.
export const getPrintWidth = () => localStorage.getItem('dokan.printWidth') || '80';
const setPrintWidth = (w) => localStorage.setItem('dokan.printWidth', w);

function timeOf(sale) {
  const d = sale.at?.toDate ? sale.at.toDate() : sale.clientAt ? new Date(sale.clientAt) : new Date();
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(d);
}

// info: { shop, location, products, customer }
export function receiptNode(sale, { shop, location, products, customer }) {
  const product = (id) => products.find((p) => p.id === id);
  return el('div', { class: 'receipt' },
    el('div', { class: 'r-head' },
      el('strong', { class: 'r-shop' }, localName(shop)),
      location ? el('span', {}, localName(location)) : null,
      el('span', {}, `${fmtDate(sale.date)} · ${digitsOf(timeOf(sale))}`),
      el('span', { dir: 'ltr' }, sale.number),
      customer ? el('span', {}, `${t('customer')}: ${customer.name}`) : null,
    ),
    el('div', { class: 'r-lines' }, sale.lines.map((l) => el('div', { class: 'r-line' },
      el('span', { class: 'r-name' }, product(l.productId) ? localName(product(l.productId)) : t('unknownProduct')),
      el('span', { class: 'r-calc' }, `${fmtNum(l.qty, 3)} × ${fmtMoney(l.price)}`),
      el('span', { class: 'r-amt' }, fmtMoney(l.qty * l.price)),
    ))),
    el('div', { class: 'r-totals' },
      sale.discount ? el('div', { class: 'sum-line' }, el('span', {}, t('subtotal')), el('span', {}, fmtMoney(sale.subtotal))) : null,
      sale.discount ? el('div', { class: 'sum-line' }, el('span', {}, t('discount')), el('span', {}, `−${fmtMoney(sale.discount)}`)) : null,
      el('div', { class: 'sum-line total' }, el('span', {}, t('total')), el('strong', {}, fmtMoney(sale.total))),
      sale.payments.map((p) => el('div', { class: 'sum-line' }, el('span', {}, t(`pay_${p.method}`)), el('span', {}, fmtMoney(p.amount)))),
      sale.change ? el('div', { class: 'sum-line' }, el('span', {}, t('change')), el('span', {}, fmtMoney(sale.change))) : null,
      sale.onCredit > 0 ? el('div', { class: 'sum-line' }, el('span', {}, t('pay_credit')), el('strong', {}, fmtMoney(sale.onCredit))) : null,
      sale.dueDate ? el('div', { class: 'sum-line' }, el('span', {}, t('dueDate')), el('span', {}, fmtDate(sale.dueDate))) : null,
    ),
    shop?.settings?.receiptFooter ? el('p', { class: 'r-foot' }, shop.settings.receiptFooter) : el('p', { class: 'r-foot' }, t('thanks')),
  );
}

export function receiptText(sale, { shop, location, products, customer }) {
  const product = (id) => products.find((p) => p.id === id);
  const rows = [
    `*${localName(shop)}*${location ? ` · ${localName(location)}` : ''}`,
    `${sale.number} · ${fmtDate(sale.date)}`,
    customer ? `${t('customer')}: ${customer.name}` : null,
    '',
    ...sale.lines.map((l) => `${product(l.productId) ? localName(product(l.productId)) : t('unknownProduct')}\n  ${fmtNum(l.qty, 3)} × ${fmtMoney(l.price)} = ${fmtMoney(l.qty * l.price)}`),
    '',
    sale.discount ? `${t('discount')}: −${fmtMoney(sale.discount)}` : null,
    `*${t('total')}: ${fmtMoney(sale.total)}*`,
    ...sale.payments.map((p) => `${t(`pay_${p.method}`)}: ${fmtMoney(p.amount)}`),
    sale.onCredit > 0 ? `${t('pay_credit')}: ${fmtMoney(sale.onCredit)}` : null,
    sale.dueDate ? `${t('dueDate')}: ${fmtDate(sale.dueDate)}` : null,
    '',
    shop?.settings?.receiptFooter || t('thanks'),
  ];
  return rows.filter((r) => r !== null).join('\n');
}

// Prints only `node`. pageCss sets the paper, e.g. "@page { size: 40mm 30mm; margin: 0; }" for
// stickers; receipts leave it empty and use the default in style.css.
export function printNode(node, className, pageCss = '') {
  let area = document.getElementById('print-area');
  if (!area) {
    area = el('div', { id: 'print-area' });
    document.body.append(area);
  }
  let page = document.getElementById('print-page');
  if (!page) {
    page = el('style', { id: 'print-page' });
    document.head.append(page);
  }
  page.textContent = pageCss;
  area.className = className;
  area.replaceChildren(node.cloneNode(true));
  window.print();
}

export function printReceipt(node) {
  printNode(node, `print-${getPrintWidth()}`);
}

// Shows the receipt with Share, WhatsApp and Print. extra: more buttons, e.g. "New sale".
export function receiptDialog(sale, info, extra = []) {
  openDialog(t('receipt'), (body, close) => {
    const node = receiptNode(sale, info);
    const text = receiptText(sale, info);
    const wa = waNumber(info.customer?.phone);
    const width = el('select', { class: 'input select', 'aria-label': t('printWidth') },
      el('option', { value: '80', selected: getPrintWidth() === '80' }, '80 mm'),
      el('option', { value: '58', selected: getPrintWidth() === '58' }, '58 mm'),
    );
    width.addEventListener('change', () => setPrintWidth(width.value));

    body.append(
      el('div', { class: 'receipt-wrap' }, node),
      el('div', { class: 'receipt-actions' },
        wa
          ? el('a', { class: 'btn primary', href: `https://wa.me/${wa}?text=${encodeURIComponent(text)}`, target: '_blank', rel: 'noopener' }, icon('share'), t('whatsapp'))
          : null,
        navigator.share
          ? el('button', { type: 'button', class: wa ? 'btn ghost' : 'btn primary', onclick: () => navigator.share({ text }).catch(() => {}) }, icon('share'), t('share'))
          : el('button', { type: 'button', class: 'btn ghost', onclick: () => copyText(text) }, icon('copy'), t('copyText')),
        el('div', { class: 'print-row' },
          el('span', { class: 'select-wrap' }, width),
          el('button', { type: 'button', class: 'btn ghost', onclick: () => printReceipt(node) }, icon('print'), t('print')),
        ),
        ...extra.map((b) => el('button', { type: 'button', class: b.primary ? 'btn primary' : 'btn ghost', onclick: () => { close(); b.onclick(); } }, b.label)),
      ),
    );
  });
}
