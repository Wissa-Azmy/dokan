// Camera barcode scanning, laid out like shanta-dm: the camera with a frame and a red line, a
// flashlight button, the latest scans as cards, and a box to type the number instead.
// The browser's own barcode reader is used where there is one (Chrome on Android); otherwise the
// open-source ZXing reader, loaded the first time it's needed (iPhone, desktop Safari, Firefox).
import { t } from './i18n.js';
import { el, icon, openDialog, isTouch } from './forms.js';

const ZXING_URL = 'https://cdn.jsdelivr.net/npm/@zxing/browser@0.2.1/umd/zxing-browser.min.js';
const DETECTOR_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'];
const PAUSE_AFTER_HIT = 1500; // ms before the next code counts, so one scan adds one piece
const LOG_SIZE = 4; // the newest scan as a card, the three before it as short rows

let loading = null;
function loadZXing() {
  if (window.ZXingBrowser) return Promise.resolve();
  loading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = ZXING_URL;
    s.onload = resolve;
    s.onerror = () => { loading = null; s.remove(); reject(new Error('scanner-load')); };
    document.head.append(s);
  });
  return loading;
}

// Numeric retail codes carry a check digit: a misread fails it and is ignored.
function checkDigitOk(c) {
  if (!/^\d+$/.test(c)) return true;
  if (![8, 12, 13, 14].includes(c.length)) return true;
  const d = [...c].map(Number);
  const chk = d.pop();
  const sum = d.reverse().reduce((a, x, i) => a + x * (i % 2 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10 === chk;
}

let audio = null;
function beep() {
  navigator.vibrate?.(60);
  try {
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.frequency.value = 1100;
    g.gain.value = 0.08;
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + 0.09);
  } catch { /* no sound on this device */ }
}

// Keeps scanning until Done. onCode(code) returns what to show for that scan:
// { kind: 'ok' | 'warn', name, meta, note, n, unit } as a card, or a plain message.
export function scanDialog(onCode, { title = t('scanTitle') } = {}) {
  // Sound must be unlocked while handling the tap that opened the scanner.
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) { audio ||= new AC(); audio.resume(); }
  } catch { /* no sound */ }

  const video = el('video', { playsinline: '', muted: '', autoplay: '' });
  video.muted = true;
  const torchBtn = el('button', { type: 'button', class: 'scan-torch', 'aria-label': t('flashlight'), title: t('flashlight'), 'aria-pressed': 'false', hidden: true }, icon('torch'));
  const log = el('div', { class: 'scan-log', 'aria-live': 'polite' });
  const status = el('p', { class: 'scan-msg', role: 'status' }, t('cameraStarting'));
  const typed = el('input', { class: 'input', dir: 'ltr', autocomplete: 'off', enterkeyhint: 'done', placeholder: t('typeCodeHint'), 'aria-label': t('typeCodeHint') });

  const { dialog } = openDialog(title, (body, close) => {
    const typeForm = el('form', { class: 'scan-type' }, typed, el('button', { class: 'btn dark' }, t('use')));
    typeForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const code = typed.value.trim();
      if (!code) return;
      if (!checkDigitOk(code)) return msg(t('badTypedCode'));
      accept(code);
    });
    body.append(
      el('div', { class: 'scan-view' }, video, el('div', { class: 'scan-frame' }), torchBtn),
      log,
      status,
      typeForm,
      el('button', { type: 'button', class: 'btn ghost scan-done', onclick: close }, t('done')),
    );
  });
  dialog.classList.add('scan-dialog');

  let stream = null;
  let timer = 0;
  let controls = null;
  let last = '';
  let pausedUntil = 0;
  let torchOn = false;
  let closed = false;

  function msg(text) { status.textContent = text; }

  // One row per product: scanning it again replaces its row and moves it to the top.
  function show(r) {
    if (!r) return;
    if (typeof r !== 'object') { msg(r); return; }
    const key = String(r.key ?? r.name);
    log.querySelector('.slog.new')?.classList.remove('new');
    [...log.children].find((x) => x.dataset.key === key)?.remove();
    const meta = [r.meta, r.note].filter(Boolean);
    const row = el('div', { class: `slog ${r.kind === 'warn' ? 'warn' : 'ok'} new` },
      el('span', { class: 'sic', 'aria-hidden': 'true' }, r.kind === 'warn' ? '!' : '✓'),
      el('span', { class: 'sx' },
        el('strong', { dir: 'auto' }, r.name),
        meta.length ? el('span', { class: 'sm', dir: 'auto' }, meta.join(' · ')) : null,
      ),
      r.n != null ? el('span', { class: 'sn' }, el('strong', {}, String(r.n)), r.unit ? el('small', {}, r.unit) : null) : null,
    );
    row.dataset.key = key;
    log.prepend(row);
    [...log.children].slice(LOG_SIZE).forEach((x) => x.remove());
    msg(t('scanHold'));
  }

  function accept(code) {
    beep();
    show(onCode(code));
    last = '';
    pausedUntil = Date.now() + PAUSE_AFTER_HIT;
    typed.value = '';
    if (isTouch()) typed.blur();
  }

  // A code counts once it is read twice in a row (and passes its check digit).
  function hit(raw) {
    const code = String(raw || '').trim();
    if (!code || !checkDigitOk(code) || Date.now() < pausedUntil) return;
    if (last === code) accept(code); else last = code;
  }

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      return msg(window.isSecureContext ? t('noCameraApi') : t('cameraHttps'));
    }
    let s;
    try {
      s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    } catch (e) {
      return msg(e?.name === 'NotAllowedError' ? t('cameraBlocked') : t('noCamera'));
    }
    if (closed) { s.getTracks().forEach((tr) => tr.stop()); return; }
    stream = s;
    video.srcObject = s;
    video.play().catch(() => {});
    // Always shown once the camera runs; some phones only report the flashlight after the
    // first frames, and the tap tells the user if this one has none.
    torchBtn.hidden = false;
    msg(t('scanHold'));

    let formats = [];
    if ('BarcodeDetector' in window) formats = await window.BarcodeDetector.getSupportedFormats().catch(() => []);
    if (formats.includes('ean_13')) {
      const detector = new window.BarcodeDetector({ formats: DETECTOR_FORMATS.filter((f) => formats.includes(f)) });
      const tick = async () => {
        if (stream !== s) return;
        try {
          if (video.readyState >= 2) {
            const found = await detector.detect(video);
            if (found[0]) hit(found[0].rawValue);
          }
        } catch { /* try the next frame */ }
        if (stream === s) timer = setTimeout(tick, 120);
      };
      tick();
      return;
    }
    try { await loadZXing(); } catch { return msg(t('scannerLoadFailed')); }
    if (stream !== s) return;
    try {
      const reader = new window.ZXingBrowser.BrowserMultiFormatOneDReader();
      controls = await reader.decodeFromStream(s, video, (r) => r && hit(r.getText()));
      if (stream !== s) { controls.stop(); controls = null; }
    } catch {
      msg(t('cameraError'));
    }
  }

  torchBtn.addEventListener('click', async () => {
    const track = stream?.getVideoTracks()[0];
    if (!track) return;
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    const next = !torchOn;
    try {
      if (!caps.torch) throw new Error('no-torch');
      await track.applyConstraints({ advanced: [{ torch: next }] });
    } catch {
      torchBtn.classList.add('off');
      msg(t('noFlashlight'));
      return;
    }
    torchOn = next;
    torchBtn.classList.toggle('on', torchOn);
    torchBtn.setAttribute('aria-pressed', String(torchOn));
  });

  dialog.addEventListener('close', () => {
    closed = true;
    clearTimeout(timer);
    try { controls?.stop(); } catch { /* already stopped */ }
    controls = null;
    stream?.getTracks().forEach((tr) => tr.stop());
    stream = null;
  });

  start();
}
