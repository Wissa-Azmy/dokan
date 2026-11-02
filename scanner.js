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

// True when a number's last digit is the right EAN/UPC check digit for the rest.
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

  // A code with a valid EAN/UPC check digit counts on the first read. Anything else (Code 128,
  // or a number whose last digit isn't an EAN/UPC check digit) counts once it reads the same
  // twice in a row, which filters out misreads without refusing such codes.
  function hit(raw) {
    const code = String(raw || '').trim();
    if (!code || Date.now() < pausedUntil) return;
    const retail = /^\d{8}$|^\d{12,13}$/.test(code) && checkDigitOk(code);
    if (retail || last === code) accept(code); else last = code;
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
    const track = s.getVideoTracks()[0];
    const caps = track?.getCapabilities ? track.getCapabilities() : {};
    if (caps.torch) torchBtn.hidden = false;
    msg(t('scanHold'));

    // Both readers look at frames taken from the video by this loop, so nothing depends on a
    // library taking over the camera. If the browser's reader keeps failing, ZXing takes over.
    let detector = null;
    let zx = null;
    let fails = 0;
    const canvas = document.createElement('canvas');
    const cx = canvas.getContext('2d', { willReadFrequently: true });

    if ('BarcodeDetector' in window) {
      const formats = await window.BarcodeDetector.getSupportedFormats().catch(() => []);
      if (formats.includes('ean_13')) {
        try { detector = new window.BarcodeDetector({ formats: DETECTOR_FORMATS.filter((f) => formats.includes(f)) }); } catch { detector = null; }
      }
    }
    async function useZXing() {
      detector = null;
      try { await loadZXing(); } catch { msg(t('scannerLoadFailed')); return false; }
      zx = new window.ZXingBrowser.BrowserMultiFormatOneDReader();
      return true;
    }
    if (!detector && !(await useZXing())) return;
    if (stream !== s) return;

    // The frame scaled to at most 1280 px wide: enough detail for 1D codes, quick to read.
    function frame() {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const k = Math.min(1, 1280 / vw);
      canvas.width = Math.round(vw * k);
      canvas.height = Math.round(vh * k);
      cx.drawImage(video, 0, 0, canvas.width, canvas.height);
      return canvas;
    }

    const tick = async () => {
      if (stream !== s) return;
      if (video.readyState >= 2 && video.videoWidth) {
        if (detector) {
          try {
            const found = await detector.detect(video);
            fails = 0;
            if (found[0]) hit(found[0].rawValue);
          } catch {
            if (++fails > 15 && !(await useZXing())) return;
          }
        } else if (zx) {
          let text = '';
          try { text = zx.decodeFromCanvas(frame()).getText(); } catch { /* no code in this frame */ }
          if (text) hit(text);
        }
      }
      if (stream === s) timer = setTimeout(tick, detector ? 120 : 160);
    };
    tick();
  }

  torchBtn.addEventListener('click', () => {
    const track = stream?.getVideoTracks()[0];
    if (!track) return;
    torchOn = !torchOn;
    track.applyConstraints({ advanced: [{ torch: torchOn }] }).catch(() => {});
    torchBtn.classList.toggle('on', torchOn);
    torchBtn.setAttribute('aria-pressed', String(torchOn));
  });

  dialog.addEventListener('close', () => {
    closed = true;
    clearTimeout(timer);
    stream?.getTracks().forEach((tr) => tr.stop());
    stream = null;
  });

  start();
}
