// Camera barcode scanning with the html5-qrcode library, which also works in iPhone Safari.
// The library is loaded only the first time the camera is opened.
import { t } from './i18n.js';
import { el, openDialog } from './forms.js';

const LIB = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js';
const SAME_CODE_PAUSE = 1500; // ms before the same code counts again

let loading = null;
function loadLib() {
  if (window.Html5Qrcode) return Promise.resolve();
  loading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = LIB;
    s.onload = resolve;
    s.onerror = () => { loading = null; reject(new Error('scanner-load')); };
    document.head.append(s);
  });
  return loading;
}

// Keeps scanning until closed. onCode(code) returns a short message to show, e.g. the product name.
export function scanDialog(onCode) {
  const { dialog } = openDialog(t('scanTitle'), (body, close) => {
    const box = el('div', { id: 'scan-box', class: 'scan-box' });
    const status = el('p', { class: 'muted small center', role: 'status' }, t('scanHint'));
    body.append(box, status, el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn primary', onclick: close }, t('done'))));
  });

  let scanner = null;
  let last = { code: '', at: 0 };
  const status = dialog.querySelector('[role=status]');

  loadLib()
    .then(() => {
      scanner = new window.Html5Qrcode('scan-box');
      return scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: (w, h) => ({ width: Math.floor(w * 0.85), height: Math.floor(Math.min(h, w) * 0.45) }) },
        (code) => {
          const now = Date.now();
          if (code === last.code && now - last.at < SAME_CODE_PAUSE) return;
          last = { code, at: now };
          navigator.vibrate?.(60);
          status.textContent = onCode(code) || code;
        },
        () => {},
      );
    })
    .catch(() => {
      dialog.querySelector('#scan-box')?.replaceChildren(el('p', { class: 'form-error' }, t('cameraError')));
    });

  dialog.addEventListener('close', () => {
    if (scanner?.isScanning) scanner.stop().catch(() => {});
  });
}
