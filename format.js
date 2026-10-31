// Number parsing and formatting: accepts "6,5", "6.5" and Arabic-Indic digits; shows EGP.
import { getLang } from './i18n.js';

let digits = localStorage.getItem('dokan.digits') || 'latn';

export function setDigits(next) {
  digits = next === 'arab' ? 'arab' : 'latn';
  localStorage.setItem('dokan.digits', digits);
}

export function getDigits() {
  return digits;
}

// "١٢٫٥" → 12.5, "6,5" → 6.5, "1.250,5" → 1250.5. Returns NaN for empty or invalid input.
export function parseNum(input) {
  let s = String(input ?? '')
    .trim()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٫]/g, '.')
    .replace(/[٬\s]/g, '');
  if (!s) return NaN;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    // Whichever comes last is the decimal mark; the other is a thousands separator.
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma > -1) {
    s = s.replace(',', '.');
  }
  return /^-?\d*\.?\d+$/.test(s) ? Number(s) : NaN;
}

function locale() {
  return `${getLang() === 'ar' ? 'ar-EG' : 'en-EG'}-u-nu-${digits}`;
}

export function fmtNum(n, maxFrac = 2) {
  if (n == null || Number.isNaN(n)) return '';
  return new Intl.NumberFormat(locale(), { maximumFractionDigits: maxFrac }).format(n);
}

export function fmtMoney(n) {
  if (n == null || Number.isNaN(n)) return '';
  const num = new Intl.NumberFormat(locale(), { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);
  return getLang() === 'ar' ? `${num} ج.م` : `EGP ${num}`;
}

export function fmtDate(d) {
  const date = d?.toDate ? d.toDate() : d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale(), { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
}

// Convert any digits in a plain string (codes, counts) to the chosen style.
export function digitsOf(text) {
  const s = String(text ?? '');
  return digits === 'arab' ? s.replace(/\d/g, (d) => String.fromCharCode(0x0660 + Number(d))) : s;
}
