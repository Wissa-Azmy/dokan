// Phone-friendly building blocks: elements, icons, fields, dialogs, confirmations and toasts.
import { t } from './i18n.js';

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'html') node.innerHTML = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

const paths = {
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 3 2.5 15 0 18M12 3c-2.5 3-2.5 15 0 18"/>',
  logout: '<path d="M15 4h4v16h-4"/><path d="M10 8l-4 4 4 4M6 12h10"/>',
  store: '<path d="M4 10v10h16V10"/><path d="M3 10l2-6h14l2 6"/><path d="M3 10c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3s3-1.3 3-3"/><path d="M10 20v-5h4v5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4.5-6 8-6s7 2 8 6"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3"/>',
  team: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5"/><circle cx="17" cy="9" r="2.8"/><path d="M16 14.6c2.8-.2 5 1.6 5.6 4.9"/>',
  pin: '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  share: '<path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6"/>',
  chevron: '<path d="M9 5l7 7-7 7"/>',
  box: '<path d="M3 7.5L12 3l9 4.5v9L12 21l-9-4.5v-9z"/><path d="M3 7.5L12 12l9-4.5M12 12v9"/>',
  tag: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  truck: '<path d="M2 6h11v10H2z"/><path d="M13 9h4l4 4v3h-8"/><circle cx="6" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  cart: '<path d="M3 4h2l2.5 11h11L21 7H6.5"/><circle cx="9" cy="19.5" r="1.5"/><circle cx="17" cy="19.5" r="1.5"/>',
  print: '<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9v6M18 9v6"/>',
  chart: '<path d="M4 20V4"/><path d="M4 20h16"/><path d="M8 16v-5M12 16V8M16 16v-3"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  barcode: '<path d="M4 5v14M7 5v14M10 5v14M14 5v14M16.5 5v14M20 5v14"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7"/><path d="M12 17h.01"/>',
};

export function icon(name) {
  const span = el('span', { class: 'icon', 'aria-hidden': 'true' });
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths[name] || ''}</svg>`;
  return span;
}

export function iconButton(name, label, onclick, extra = '') {
  return el('button', { type: 'button', class: `icon-btn ${extra}`.trim(), 'aria-label': label, title: label, onclick }, icon(name));
}

export const isTouch = () => matchMedia('(pointer: coarse)').matches;

// Focus only on desktop, never date fields.
export function focusFirst(container) {
  if (isTouch()) return;
  const first = container.querySelector('input:not([type=date]):not([type=hidden]), select, textarea');
  first?.focus();
}

function wrap(label, control, hint) {
  return el('label', { class: 'field' }, el('span', { class: 'field-label' }, label), control, hint ? el('span', { class: 'field-hint' }, hint) : null, el('span', { class: 'field-error', role: 'alert' }));
}

export function textField({ name, label, value = '', type = 'text', required, hint, autocomplete, dir }) {
  const input = el('input', { name, type, value, required, autocomplete, dir, class: 'input' });
  return wrap(label, input, hint);
}

// Numbers are text fields with a decimal keypad, so "6,5" and "6.5" both work.
export function numberField({ name, label, value = '', required, hint }) {
  const input = el('input', { name, type: 'text', inputmode: 'decimal', value, required, autocomplete: 'off', class: 'input num' });
  return wrap(label, input, hint);
}

export function selectField({ name, label, value, options, hint }) {
  const select = el('select', { name, class: 'input select' }, options.map((o) => el('option', { value: o.value, selected: String(o.value) === String(value) }, o.label)));
  return wrap(label, el('span', { class: 'select-wrap' }, select), hint);
}

export function dateField({ name, label, value, hint }) {
  return wrap(label, el('input', { name, type: 'date', value, class: 'input date' }), hint);
}

export function checkboxField({ name, label, checked, hint }) {
  return el('label', { class: 'check' },
    el('input', { type: 'checkbox', name, checked }),
    el('span', { class: 'check-text' }, el('span', {}, label), hint ? el('span', { class: 'field-hint' }, hint) : null),
  );
}

// A group of checkboxes sharing one name. Read with checkedValues(form, name).
export function checkGroup({ name, label, options, values = [], hint }) {
  return el('fieldset', { class: 'field check-group' },
    el('legend', { class: 'field-label' }, label),
    options.map((o) => el('label', { class: 'check' },
      el('input', { type: 'checkbox', name, value: o.value, checked: values.includes(o.value) }),
      el('span', { class: 'check-text' }, o.label),
    )),
    hint ? el('span', { class: 'field-hint' }, hint) : null,
    el('span', { class: 'field-error', role: 'alert' }),
  );
}

export function checkedValues(form, name) {
  return [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((i) => i.value);
}

export function setGroupError(form, name, message) {
  const box = form.querySelector(`input[name="${name}"]`)?.closest('fieldset')?.querySelector('.field-error');
  if (box) box.textContent = message || '';
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast(t('copied'));
  } catch {
    window.prompt('', text);
  }
}

export function setFieldError(form, name, message) {
  const input = form.elements[name];
  const box = input?.closest('.field')?.querySelector('.field-error');
  if (box) box.textContent = message || '';
  input?.classList.toggle('invalid', !!message);
}

// Create the dialog element first, attach it, then fill it.
export function openDialog(title, build) {
  const dialog = el('dialog', { class: 'dialog' });
  document.body.append(dialog);
  const close = () => dialog.close();
  dialog.addEventListener('close', () => dialog.remove());
  const body = el('div', { class: 'dialog-body' });
  dialog.append(el('header', { class: 'dialog-head' }, el('h2', {}, title), iconButton('close', t('cancel'), close)), body);
  build(body, close);
  dialog.showModal();
  focusFirst(body);
  return { dialog, close };
}

// Resolves true if confirmed. With typeWord, the user must type that word to enable the button.
export function confirmAction({ title, message, confirmLabel = t('confirm'), danger = false, typeWord }) {
  return new Promise((resolve) => {
    let answered = false;
    const { dialog } = openDialog(title, (body, close) => {
      body.append(el('p', { class: 'confirm-text' }, message));
      const ok = el('button', { type: 'button', class: danger ? 'btn danger' : 'btn primary', disabled: !!typeWord, onclick: () => { answered = true; resolve(true); close(); } }, confirmLabel);
      if (typeWord) {
        const input = el('input', { class: 'input', autocomplete: 'off', placeholder: typeWord, oninput: (e) => { ok.disabled = e.target.value.trim() !== typeWord; } });
        body.append(input);
      }
      body.append(el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn ghost', onclick: close }, t('cancel')), ok));
    });
    dialog.addEventListener('close', () => { if (!answered) resolve(false); });
  });
}

export function toast(message, kind = 'ok') {
  const box = document.getElementById('toasts');
  const item = el('div', { class: `toast ${kind}`, role: 'status' }, message);
  box.append(item);
  setTimeout(() => item.classList.add('out'), 2600);
  setTimeout(() => item.remove(), 3000);
}

// Disable the submit button while an async action runs.
export async function busy(button, fn) {
  button.disabled = true;
  button.classList.add('busy');
  try {
    return await fn();
  } finally {
    button.disabled = false;
    button.classList.remove('busy');
  }
}
