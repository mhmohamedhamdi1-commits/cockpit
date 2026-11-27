// ---------- DOM ----------
const PROPS = new Set(['value', 'checked', 'disabled', 'selected', 'indeterminate', 'htmlFor']);
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (PROPS.has(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, kids);
  return el;
}
export function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}
export function sv(tag, props, ...kids) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v);
  }
  append(el, kids);
  return el;
}
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

// ---------- Icônes (24×24, trait) ----------
const ICONS = {
  plus: 'M5 12h14M12 5v14',
  calendar: 'M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM16 2v4M8 2v4M3 10h18',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  trash: 'M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
  edit: 'M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z',
  check: 'M20 6 9 17l-5-5',
  x: 'M18 6 6 18M6 6l12 12',
  alert: 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01',
  left: 'm15 18-6-6 6-6',
  right: 'm9 18 6-6-6-6',
  dash: 'M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  brief: 'M2 9a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2zM16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2',
  building: 'M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18zM6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2M10 6h4M10 10h4M10 14h4M10 18h4',
  bank: 'M3 22h18M6 18v-7M10 18v-7M14 18v-7M18 18v-7M12 2l8 5H4z',
  repeat: 'm17 2 4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3',
  sliders: 'M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4',
  sheet: 'M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5zM14 2v6h6M8 13h2M14 13h2M8 17h2M14 17h2',
  folder: 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9L9.6 3.9A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z',
  save: 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2zM17 21v-8H7v8M7 3v5h8',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4',
  moon: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z',
  up: 'M7 17 17 7M7 7h10v10',
  down: 'M7 7l10 10M17 7v10H7',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01',
  more: 'M12 12h.01M19 12h.01M5 12h.01',
  send: 'm22 2-7 20-4-9-9-4zM22 2 11 13',
  key: 'M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4',
  user: 'M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  wallet: 'M20 7H5a2 2 0 0 1 0-4h13v4M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4M21 12v4h-4a2 2 0 0 1 0-4z',
  undo: 'M3 7v6h6M21 17a9 9 0 0 0-15-6.7L3 13',
  chart: 'M3 3v18h18M7 14l4-4 4 4 5-6',
  chevup: 'm18 15-6-6-6 6',
  chevdown: 'm6 9 6 6 6-6',
  maximize: 'M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3',
  minimize: 'M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3',
  message: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  trend: 'M22 7l-8.5 8.5-5-5L2 17M16 7h6v6',
  globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z',
  inbox: 'M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z',
  percent: 'M19 5 5 19M6.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM17.5 20a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  target: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeoff: 'M9.9 4.2A10 10 0 0 1 12 4c6.4 0 10 8 10 8a17 17 0 0 1-3.2 4.3M6.6 6.6A16.8 16.8 0 0 0 2 12s3.6 8 10 8a9.7 9.7 0 0 0 5.4-1.6M2 2l20 20M9.9 9.9a3 3 0 0 0 4.2 4.2',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  scale: 'M12 3v18M8 21h8M5 7h14M5 7l-3 8a3 3 0 0 0 6 0zM19 7l-3 8a3 3 0 0 0 6 0z',
  bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0',
  file: 'M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5zM14 2v6h6',
  pie: 'M21.2 15.9A10 10 0 1 1 8 2.8M22 12A10 10 0 0 0 12 2v10z',
  link: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
  heart: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z',
};
export function icon(name, size = 18) {
  const s = sv('svg', { viewBox: '0 0 24 24', width: size, height: size, class: 'i', 'aria-hidden': 'true' });
  for (const d of (ICONS[name] || '').split(/(?=M)/)) if (d) s.append(sv('path', { d }));
  return s;
}

// ---------- Formats ----------
const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf1 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fixMinus = (s) => s.replace('-', '\u2212').replace(/\u202f/g, '\u00a0');
export const num0 = (v) => fixMinus(nf0.format(Math.round(v || 0)));
export const num2 = (v) => fixMinus(nf2.format(v || 0));
export const num1 = (v) => fixMinus(nf1.format(v || 0));
// Devises gérées : EUR, MAD, USD (US), GBP (UK), CHF (Suisse)
export const CURRENCIES = [
  { code: 'EUR', sym: '€', label: 'EUR — Euro' }, { code: 'MAD', sym: 'MAD', label: 'MAD — Dirham marocain' },
  { code: 'USD', sym: '$', label: 'USD — Dollar (US)' }, { code: 'GBP', sym: '£', label: 'GBP — Livre sterling (UK)' }, { code: 'CHF', sym: 'CHF', label: 'CHF — Franc suisse' },
];
export const CUR_CODES = CURRENCIES.map((c) => c.code);
export const curSym = (cur) => (CURRENCIES.find((c) => c.code === cur) || { sym: cur }).sym;
export function money(v, cur = 'EUR', dec = 0) {
  const n = dec === 2 ? num2(v) : num0(v);
  return `${n}\u00a0${curSym(cur)}`;
}
// Devise d'affichage des montants en euros (EUR par défaut ; MAD = conversion au taux du jour)
let DISPLAY = { cur: 'EUR', rate: 1 };
export function setDisplayCurrency(cur, rateFromEur) { DISPLAY = { cur: cur || 'EUR', rate: rateFromEur > 0 ? rateFromEur : 1 }; }
export const displayRate = () => DISPLAY.rate;
export const displayCur = () => DISPLAY.cur;
export const eur = (v, dec = 0) => money((v || 0) * DISPLAY.rate, DISPLAY.cur, dec);
export const mad = (v, dec = 0) => money(v, 'MAD', dec);
export function compact(v) {
  const a = Math.abs(v);
  if (a >= 1e6) return fixMinus((v / 1e6).toFixed(1).replace('.', ',')) + ' M';
  if (a >= 1e4) return fixMinus(String(Math.round(v / 1e3))) + ' k';
  if (a >= 1e3) return fixMinus((v / 1e3).toFixed(1).replace('.', ',').replace(',0', '')) + ' k';
  return fixMinus(String(Math.round(v)));
}
export const pct = (v, d = 0) => (v == null || !isFinite(v) ? '—' : fixMinus((v * 100).toFixed(d).replace('.', ',')) + ' %');

// ---------- Dates ----------
const MONTHS = {
  fr: [['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'], ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']],
  en: [['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']],
  ar: [['يناير', 'فبراير', 'مارس', 'أبريل', 'ماي', 'يونيو', 'يوليوز', 'غشت', 'شتنبر', 'أكتوبر', 'نونبر', 'دجنبر'], ['يناير', 'فبراير', 'مارس', 'أبريل', 'ماي', 'يونيو', 'يوليوز', 'غشت', 'شتنبر', 'أكتوبر', 'نونبر', 'دجنبر']],
};
let MS = MONTHS.fr[0], ML = MONTHS.fr[1];
const monthNamesRef = [...MONTHS.fr[1]];
export function setLocale(l) { [MS, ML] = MONTHS[l] || MONTHS.fr; monthNamesRef.splice(0, 12, ...ML); }
export const monthKey = (d) => d.slice(0, 7);
export const monthShort = (k) => MS[+k.slice(5, 7) - 1];
export const monthLabel = (k) => `${MS[+k.slice(5, 7) - 1]} ${k.slice(0, 4)}`;
export const monthLong = (k) => `${ML[+k.slice(5, 7) - 1]} ${k.slice(0, 4)}`;
export const monthName = (m) => ML[m - 1];
export const monthNames = monthNamesRef;
export function addMonths(k, n) {
  const y = +k.slice(0, 4), m = +k.slice(5, 7) - 1 + n;
  const yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, '0')}`;
}
export function monthsBetween(a, b) {
  const out = [];
  for (let k = a; k <= b && out.length < 600; k = addMonths(k, 1)) out.push(k);
  return out;
}
export const monthEnd = (k) => { const d = new Date(+k.slice(0, 4), +k.slice(5, 7), 0); return `${k}-${String(d.getDate()).padStart(2, '0')}`; };
export const monthStart = (k) => `${k}-01`;
export function fmtDate(s) {
  if (!s) return '';
  return `${+s.slice(8, 10)} ${MS[+s.slice(5, 7) - 1]} ${s.slice(0, 4)}`;
}
export const fmtDateShort = (s) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(2, 4)}` : '');
export function addDays(s, n) {
  const d = new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10) + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 864e5);
}

// ---------- Divers ----------
export const sum = (arr, f = (x) => x) => arr.reduce((s, x) => s + f(x), 0);
export const uniq = (arr) => [...new Set(arr)];
export const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
export function debounce(fn, ms = 250) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
export function parseAmount(s) {
  if (typeof s === 'number') return s;
  const v = parseFloat(String(s || '').replace(/\s/g, '').replace(',', '.'));
  return isFinite(v) ? v : 0;
}
