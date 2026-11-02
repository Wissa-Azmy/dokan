// Barcodes made by the shop, and drawing them as SVG for stickers.
// New codes are EAN-13 starting with "20": the range kept for in-store use, so they never clash
// with a factory barcode. Every barcode reader and phone camera reads EAN-13. Codes that are not
// a valid EAN-13 (for example a 12-digit UPC or letters) are drawn as Code 128, which scans back
// exactly as typed.

const SHOP_PREFIX = '20';
const QUIET = 10; // empty modules on each side, so readers find the start

export function ean13Check(first12) {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 ? 3 : 1);
  return String((10 - (sum % 10)) % 10);
}

export const isEan13 = (code) => /^\d{13}$/.test(code) && ean13Check(code) === code[12];

// A new shop code that no product in `taken` (a Set of codes) uses yet.
export function newShopBarcode(taken) {
  for (;;) {
    let body = SHOP_PREFIX;
    const rnd = crypto.getRandomValues(new Uint32Array(10));
    for (const n of rnd) body += String(n % 10);
    const code = body + ean13Check(body);
    if (!taken.has(code)) { taken.add(code); return code; }
  }
}

// ---------- EAN-13 ----------

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const R = L.map((p) => p.replace(/./g, (b) => (b === '0' ? '1' : '0')));
const G = R.map((p) => [...p].reverse().join(''));
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

function ean13Modules(code) {
  const parity = PARITY[code[0]];
  let m = '101';
  for (let i = 1; i <= 6; i++) m += (parity[i - 1] === 'L' ? L : G)[code[i]];
  m += '01010';
  for (let i = 7; i <= 12; i++) m += R[code[i]];
  return `${m}101`;
}

// ---------- Code 128 ----------

// Bar and space widths of the 107 symbols (values 0–105, then Stop).
const C128 = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
const START_B = 104;
const START_C = 105;
const STOP = 106;

export const canCode128 = (code) => /^[\x20-\x7e]+$/.test(code);

function code128Modules(code) {
  // Only digits, an even number of them: set C packs two digits in each symbol.
  const digitsOnly = /^\d+$/.test(code) && code.length % 2 === 0 && code.length >= 4;
  const values = digitsOnly
    ? [START_C, ...code.match(/\d\d/g).map(Number)]
    : [START_B, ...[...code].map((c) => c.charCodeAt(0) - 32)];
  let sum = values[0];
  for (let i = 1; i < values.length; i++) sum += values[i] * i;
  values.push(sum % 103, STOP);
  let m = '';
  for (const v of values) {
    [...C128[v]].forEach((w, i) => { m += (i % 2 ? '0' : '1').repeat(Number(w)); });
  }
  return m;
}

// ---------- Drawing ----------

// Returns an SVG element, or null if the code can't be drawn (empty, or letters outside English).
export function barcodeSvg(code) {
  code = String(code || '').trim();
  if (!code) return null;
  let modules;
  if (isEan13(code)) modules = ean13Modules(code);
  else if (canCode128(code)) modules = code128Modules(code);
  else return null;

  const width = modules.length + QUIET * 2;
  let bars = '';
  for (let i = 0; i < modules.length; i++) {
    if (modules[i] !== '1') continue;
    let run = 1;
    while (modules[i + run] === '1') run++;
    bars += `<rect x="${i + QUIET}" y="0" width="${run}" height="40"/>`;
    i += run - 1;
  }
  const holder = document.createElement('span');
  holder.innerHTML = `<svg class="barcode-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 40" preserveAspectRatio="none" shape-rendering="crispEdges" fill="#000" role="img" aria-label="${code.replace(/[<>&"]/g, '')}">${bars}</svg>`;
  return holder.firstChild;
}
