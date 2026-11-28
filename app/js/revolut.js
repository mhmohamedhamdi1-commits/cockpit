// Lecture des relevés Revolut (CSV personnel EN/FR, CSV Business, Excel, PDF) — module PUR : aucun DOM.
// Fonctionne dans le navigateur et dans Node (tests). Le fichier n'est jamais envoyé nulle part : tout est lu localement.
//
// Résultat de lecture : { format, lines: [ligne], skipped: [{ reason, label, date, montant, devise }], warnings: [texte] }
// Ligne normalisée : { date, libelle, montant (signé : + entrée, − sortie), devise, solde, typeOp, kind, source, hash, fee? }
//   hash = empreinte stable anti-doublon : source | date | montant | devise | libellé normalisé | rang d'occurrence du même
//   quadruplet dans le fichier → un ré-import du même relevé (ou d'un relevé qui chevauche) ne recrée rien.

export const SOURCE = 'Revolut';
export const CURRENCIES = ['EUR', 'MAD', 'USD', 'GBP', 'CHF'];

// ---------- outils ----------
export const normLabel = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const normKey = (s) => normLabel(s).replace(/ /g, '');
const pad = (n) => String(n).padStart(2, '0');

// FNV-1a 2×32 bits → 16 caractères hexadécimaux (pas de dépendance à crypto)
export function hash64(str) {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0xdeadbeef;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    a ^= c; a = Math.imul(a, 0x01000193) >>> 0;
    b ^= c + i; b = Math.imul(b, 0x85ebca6b) >>> 0; b ^= b >>> 13;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

// Nombre au format libre : « 1 234,56 », « 1,234.56 », « −5.00 », « €12.50 », « (12.50) » ; null si illisible
export function parseAmount(v, decimalHint = '') {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  let s = String(v ?? '').trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/[−–‒]/g, '-').replace(/[\s  ']/g, '').replace(/[A-Za-z€$£]|MAD|CHF/g, '');
  if (s.startsWith('-')) { neg = !neg; s = s.slice(1); }
  if (s.startsWith('+')) s = s.slice(1);
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
  const lastDot = s.lastIndexOf('.'), lastCom = s.lastIndexOf(',');
  let dec = '';
  if (lastDot >= 0 && lastCom >= 0) dec = lastDot > lastCom ? '.' : ',';
  else if (lastCom >= 0) dec = (decimalHint === ',' || !/^\d{1,3}(,\d{3})+$/.test(s)) ? ',' : '';
  else if (lastDot >= 0) dec = (decimalHint === '.' || !/^\d{1,3}(\.\d{3})+$/.test(s)) ? '.' : '';
  let out = dec ? s.slice(0, s.lastIndexOf(dec)).replace(/[.,]/g, '') + '.' + s.slice(s.lastIndexOf(dec) + 1) : s.replace(/[.,]/g, '');
  const n = Number(out);
  return isFinite(n) ? (neg ? -n : n) : null;
}

const MONTHS = {
  jan: 1, janv: 1, january: 1, janvier: 1, feb: 2, fev: 2, fevr: 2, february: 2, fevrier: 2, mar: 3, mars: 3, march: 3, apr: 4, avr: 4, april: 4, avril: 4,
  may: 5, mai: 5, jun: 6, juin: 6, june: 6, jul: 7, juil: 7, july: 7, juillet: 7, aug: 8, aout: 8, august: 8, sep: 9, sept: 9, september: 9, septembre: 9,
  oct: 10, october: 10, octobre: 10, nov: 11, november: 11, novembre: 11, dec: 12, december: 12, decembre: 12,
};
const monthOf = (w) => MONTHS[String(w).toLowerCase().normalize('NFD').replace(/[̀-ͯ.]/g, '')] || 0;
const validYmd = (y, m, d) => { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d; };

// Date → « AAAA-MM-JJ » ou '' ; accepte ISO, JJ/MM/AAAA, JJ.MM.AAAA, « 12 nov. 2025 », « Nov 12, 2025 », numéro de série Excel, Date
export function parseDate(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date) return isNaN(v) ? '' : `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  if (typeof v === 'number') {
    if (v < 20000 || v > 80000) return '';
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 864e5);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s]|$)/);
  if (m && validYmd(+m[1], +m[2], +m[3])) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})(?:[T\s,]|$)/);
  if (m) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; if (validYmd(y, +m[2], +m[1])) return `${y}-${pad(m[2])}-${pad(m[1])}`; }
  m = s.match(/^(\d{1,2})\s+([A-Za-zÀ-ÿ.]+)\s+(\d{4})/);
  if (m && monthOf(m[2]) && validYmd(+m[3], monthOf(m[2]), +m[1])) return `${m[3]}-${pad(monthOf(m[2]))}-${pad(m[1])}`;
  m = s.match(/^([A-Za-zÀ-ÿ.]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (m && monthOf(m[1]) && validYmd(+m[3], monthOf(m[1]), +m[2])) return `${m[3]}-${pad(monthOf(m[1]))}-${pad(m[2])}`;
  const n = Number(s);
  if (isFinite(n) && n > 20000 && n < 80000) return parseDate(n);
  return '';
}

// ---------- CSV ----------
// Découpe un texte CSV en lignes de cellules (guillemets, guillemets doublés, retours à la ligne dans une cellule, BOM)
export function parseCsvRows(text, delimiter) {
  text = String(text || '').replace(/^﻿/, '');
  const d = delimiter || detectDelimiter(text);
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"') q = true;
    else if (c === d) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some((x) => x.trim() !== '')) rows.push(row); row = []; }
    else cell += c;
  }
  row.push(cell); if (row.some((x) => x.trim() !== '')) rows.push(row);
  rows.delimiter = d;
  return rows;
}
export function detectDelimiter(text) {
  const first = String(text || '').replace(/^﻿/, '').split(/\r?\n/).find((l) => l.trim()) || '';
  const count = (ch) => { let n = 0, q = false; for (const c of first) { if (c === '"') q = !q; else if (!q && c === ch) n++; } return n; };
  const c = { ',': count(','), ';': count(';'), '\t': count('\t') };
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0][1] > 0 ? Object.entries(c).sort((a, b) => b[1] - a[1])[0][0] : ',';
}

// ---------- en-têtes ----------
const HEADERS = {
  type: ['type'],
  product: ['product', 'produit'],
  started: ['started date', 'date de debut', 'date started (utc)', 'date started', 'date de debut (utc)', 'started'],
  completed: ['completed date', 'date de fin', 'date completed (utc)', 'date completed', 'date de fin (utc)', 'completed', 'date'],
  description: ['description', 'libelle'],
  reference: ['reference', 'référence'],
  payer: ['payer', 'payeur'],
  amount: ['amount', 'montant', 'payment amount'],
  fee: ['fee', 'frais'],
  feeCurrency: ['fee currency', 'devise des frais'],
  currency: ['currency', 'devise', 'payment currency', 'devise du paiement'],
  state: ['state', 'etat', 'statut', 'status'],
  balance: ['balance', 'solde'],
  account: ['account', 'compte'],
};
const normHead = (h) => String(h || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

// Cherche la ligne d'en-têtes (les premières lignes peuvent être un titre) et renvoie { index, cols }
export function findHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cols = {};
    rows[i].forEach((h, ci) => {
      const n = normHead(h);
      for (const [k, names] of Object.entries(HEADERS)) if (cols[k] == null && names.map(normHead).includes(n)) cols[k] = ci;
    });
    if (cols.amount != null && (cols.completed != null || cols.started != null) && cols.description != null) return { index: i, cols };
  }
  return null;
}

// ---------- types d'opération ----------
export function kindOf(type, description = '') {
  const t = normKey(type);
  const has = (...xs) => xs.some((x) => t.includes(x));
  if (!t) return kindFromText(description);
  if (has('cardrefund', 'refund', 'remboursement')) return 'refund';
  if (has('cardpay', 'paiementparcarte', 'paiementcarte', 'cardcredit')) return t.includes('credit') ? 'refund' : 'card';
  if (has('topup', 'rechargement', 'deposit', 'depot')) return 'topup';
  if (has('exchange', 'change')) return 'exchange';
  if (has('atm', 'retrait', 'dab')) return 'atm';
  if (has('fee', 'frais')) return 'fee';
  if (has('interest', 'interet')) return 'interest';
  if (has('cashback', 'reward', 'recompense')) return 'cashback';
  if (has('tax', 'taxe', 'impot')) return 'tax';
  if (has('directdebit', 'prelevement')) return 'debit';
  if (has('transfer', 'virement')) return 'transfer';
  if (has('card', 'carte')) return 'card';
  return kindFromText(description);
}
function kindFromText(d) {
  const s = normLabel(d);
  if (/^(exchanged to|exchange|converti|change )/.test(s)) return 'exchange';
  // mouvements entre ses propres poches / comptes d'investissement Revolut
  if (/compte d ?investissement|investment account|\b(coffre|vault|pocket)\b|epargne revolut|round up|arrondi/.test(s)) return 'internal';
  if (/top ?up|recharge|depot/.test(s)) return 'topup';
  if (/atm|retrait/.test(s)) return 'atm';
  if (/^(fee|frais|commission)\b|^(.{0,20})frais de (tenue|compte|carte|change)/.test(s)) return 'fee';   // « Stop Frais » (nom d'un commerçant) n'est PAS un frais Revolut
  if (/interest|interet/.test(s)) return 'interest';
  if (/cashback|reward/.test(s)) return 'cashback';
  if (/refund|remboursement/.test(s)) return 'refund';
  if (/^(to |from |a |de |transfer|virement|payment from|payment sent|paiement de|paiement envoye)/.test(s)) return 'transfer';
  return 'card';
}

const STATE_OK = ['completed', 'complete', 'termine', 'terminee', 'effectue', 'effectuee', 'done', 'settled', 'booked'];
const stateKind = (s) => {
  const n = normKey(s);
  if (!n) return 'ok';
  if (STATE_OK.includes(n)) return 'ok';
  if (/pending|attente|encours|processing|traitement/.test(n)) return 'pending';
  return 'cancelled';   // reverted, declined, failed, annulé, refusé, échoué…
};

// ---------- lignes normalisées ----------
// Attribue les empreintes (rang d'occurrence du même quadruplet)
function finalize(lines) {
  const seen = new Map();
  for (const l of lines) {
    const base = [SOURCE, l.date, l.montant.toFixed(2), l.devise, normLabel(l.libelle)].join('|');
    const rank = (seen.get(base) || 0) + 1;
    seen.set(base, rank);
    l.hash = hash64(`${base}|${rank}`);
  }
  return lines;
}
const makeLine = (o) => ({ source: SOURCE, solde: null, typeOp: '', kind: 'card', ...o });

// Lignes d'un tableau de cellules (CSV ou Excel) → résultat
export function parseStatementRows(rows, { decimalHint = '', format = 'csv' } = {}) {
  const res = { format, lines: [], skipped: [], warnings: [] };
  const hd = findHeader(rows);
  if (!hd) { res.error = 'En-têtes non reconnus : ce fichier ne ressemble pas à un relevé Revolut (colonnes attendues : Type, Description, Amount/Montant, Currency/Devise, State/État…).'; return res; }
  const { cols } = hd;
  const business = cols.reference != null || cols.payer != null || cols.feeCurrency != null || normHead(rows[hd.index][cols.started ?? cols.completed]).includes('(utc)');
  res.format = business ? `${format}-business` : `${format}-perso`;
  const get = (r, k) => (cols[k] == null ? '' : r[cols[k]]);
  const accounts = new Set();
  for (const r of rows.slice(hd.index + 1)) {
    if (!r.some((c) => String(c ?? '').trim() !== '')) continue;
    const desc0 = String(get(r, 'description') ?? '').trim();
    let ref = business ? String(get(r, 'reference') ?? '').trim() : '';
    const type = String(get(r, 'type') ?? '').trim();
    const dateRaw = get(r, 'completed') || get(r, 'started');
    const date = parseDate(dateRaw) || parseDate(get(r, 'started'));
    const montant = parseAmount(get(r, 'amount'), decimalHint);
    const devise = String(get(r, 'currency') ?? '').trim().toUpperCase() || 'EUR';
    const label = desc0 || ref || type;
    const st = stateKind(get(r, 'state'));
    if (!date || montant == null) { res.skipped.push({ reason: 'illisible', label, date: String(dateRaw ?? ''), montant: String(get(r, 'amount') ?? ''), devise }); continue; }
    if (st !== 'ok') { res.skipped.push({ reason: st === 'pending' ? 'en cours' : 'annulée ou refusée', label, date, montant, devise }); continue; }
    if (!CURRENCIES.includes(devise)) { res.skipped.push({ reason: `devise ${devise} non gérée`, label, date, montant, devise }); continue; }
    if (ref && normLabel(ref) === normLabel(desc0)) ref = '';
    const libelle = ref && !normLabel(desc0).includes(normLabel(ref)) ? `${desc0 || type} — ${ref}` : label;
    const solde = parseAmount(get(r, 'balance'), decimalHint);
    const kind = kindOf(type, libelle);
    if (cols.account != null && String(get(r, 'account') ?? '').trim()) accounts.add(String(get(r, 'account')).trim());
    if (montant !== 0) res.lines.push(makeLine({ date, libelle, montant: Math.round(montant * 100) / 100, devise, solde, typeOp: type, kind }));
    const fee = parseAmount(get(r, 'fee'), decimalHint);
    if (fee) {
      const fdev = (String(get(r, 'feeCurrency') ?? '').trim().toUpperCase()) || devise;
      if (!CURRENCIES.includes(fdev)) res.skipped.push({ reason: `devise ${fdev} non gérée (frais)`, label: `Frais — ${label}`, date, montant: -Math.abs(fee), devise: fdev });
      else res.lines.push(makeLine({ date, libelle: `Frais — ${label}`, montant: -Math.abs(Math.round(fee * 100) / 100), devise: fdev, solde, typeOp: 'Fee', kind: 'fee' }));
    }
  }
  if (accounts.size) res.accounts = [...accounts];
  finalize(res.lines);
  if (!res.lines.length && !res.skipped.length) res.error = 'Aucune opération trouvée dans ce fichier.';
  return res;
}

// ---------- CSV ----------
export function parseCsv(text) {
  const rows = parseCsvRows(text);
  const decimalHint = rows.delimiter === ';' || rows.delimiter === '\t' ? ',' : '';
  return parseStatementRows(rows, { decimalHint, format: 'csv' });
}

// ---------- Excel (SheetJS passé en paramètre) ----------
export function parseXlsx(XLSX, buf) {
  const wb = XLSX.read(buf, { type: buf instanceof ArrayBuffer || ArrayBuffer.isView(buf) ? 'array' : 'buffer', cellDates: true });
  let last = null;
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
    const r = parseStatementRows(rows, { format: 'xlsx' });
    if (!r.error) return r;
    last = r;
  }
  return last || { format: 'xlsx', lines: [], skipped: [], warnings: [], error: 'Classeur vide.' };
}

// ---------- PDF ----------
// items : [{ str, x, y, w, page }] (y vers le haut ou vers le bas, peu importe : on regroupe par proximité).
const CUR_SYMBOLS = { '€': 'EUR', '$': 'USD', '£': 'GBP' };
const PDF_COLS = {
  date: ['date', 'datum'],
  description: ['description', 'libelle'],
  out: ['money out', 'argent sortant', 'debit', 'sortie', 'paid out', 'withdrawals', 'retrait'],
  in: ['money in', 'argent entrant', 'credit', 'entree', 'paid in', 'deposits', 'depot'],
  balance: ['balance', 'solde'],
};
const looksAmount = (s) => /^[-+−(]?\s*[€$£]?\s*[\d][\d\s .,']*\s*(EUR|USD|GBP|CHF|MAD|€|\$|£)?\)?$/.test(s.trim()) && /\d/.test(s);
const currencyIn = (s) => { const m = s.match(/\b(EUR|USD|GBP|CHF|MAD)\b/); if (m) return m[1]; for (const [k, v] of Object.entries(CUR_SYMBOLS)) if (s.includes(k)) return v; return ''; };
const DATE_RE = /^(?:\d{4}-\d{2}-\d{2}|\d{1,2}[/.]\d{1,2}[/.]\d{2,4}|\d{1,2}\s+[A-Za-zÀ-ÿ.]+\s+\d{4}|[A-Za-zÀ-ÿ.]+\s+\d{1,2},?\s+\d{4})/;

function groupLines(items) {
  const byPage = new Map();
  for (const it of items) { if (!String(it.str).trim()) continue; (byPage.get(it.page || 1) || byPage.set(it.page || 1, []).get(it.page || 1)).push(it); }
  const out = [];
  for (const [page, arr] of [...byPage].sort((a, b) => a[0] - b[0])) {
    arr.sort((a, b) => b.y - a.y || a.x - b.x);
    let cur = null;
    for (const it of arr) {
      if (cur && Math.abs(it.y - cur.y) <= 3) { cur.items.push(it); }
      else { cur = { page, y: it.y, items: [it] }; out.push(cur); }
    }
  }
  for (const l of out) l.items.sort((a, b) => a.x - b.x);
  return out;
}
// pdf.js peut fusionner plusieurs cellules voisines en un seul item (« Money out Money in », « Nov 12, 2026To Fatima ») :
// on les redécoupe en estimant la position de chaque morceau au prorata des caractères.
const HEADER_PHRASES = Object.values(PDF_COLS).flat().sort((a, b) => b.length - a.length);
const sub = (it, from, to, x0 = null) => { const n = Math.max(1, it.str.length); return { ...it, str: it.str.slice(from, to), x: x0 ?? it.x + (it.w || 0) * from / n, w: (it.w || 0) * (to - from) / n }; };
function splitHeaderItem(it) {
  const low = it.str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (low.length !== it.str.length) return [it];
  const re = new RegExp(`(?<![a-z])(${HEADER_PHRASES.map((x) => x.replace(/ /g, '\\s+')).join('|')})(?![a-z])`, 'g');
  const ms = [...low.matchAll(re)];
  if (ms.length < 2) return [it];
  return ms.map((m) => sub(it, m.index, m.index + m[0].length));
}
const DATE_PREFIX = /^((?:\d{4}-\d{2}-\d{2})|(?:\d{1,2}[/.]\d{1,2}[/.]\d{2,4})|(?:\d{1,2}\s+[A-Za-zÀ-ÿ.]+\s+\d{4})|(?:[A-Za-zÀ-ÿ.]+\s+\d{1,2},?\s+\d{4}))\s*(.*)$/;
const AMOUNT_TOKEN = /^[-+−(]?[€$£]?[\d][\d.,']*[€$£)]?$/;
function explodeItem(it, cols) {
  const out = [];
  let cur = it;
  if (cur.x < cols.description.left - 2) {
    const m = cur.str.match(DATE_PREFIX);
    if (m && m[2] && parseDate(m[1])) {
      out.push({ ...cur, str: m[1], w: (cur.w || 0) * m[1].length / Math.max(1, cur.str.length) });
      cur = { ...cur, str: m[2], x: cols.description.left, w: (cur.w || 0) * m[2].length / Math.max(1, cur.str.length) };
    }
  }
  // plusieurs montants dans un même item (« €12.00 €1,000.00 »)
  const toks = cur.str.trim().split(/\s+/);
  if (toks.length >= 2 && toks.every((t) => AMOUNT_TOKEN.test(t) && /[€$£]|[.,]\d{2}[)]?$/.test(t))) {   // « 1 142,10 » (milliers à l'espace) n'est PAS découpé
    let pos = 0;
    for (const t of toks) { const i = cur.str.indexOf(t, pos); out.push(sub(cur, i, i + t.length)); pos = i + t.length; }
    return out;
  }
  out.push(cur);
  return out;
}

// Fusionne les items adjacents d'une même colonne en un texte
const joinItems = (items) => items.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();

// Pied de page de chaque page (« Signaler une carte perdue ou volée… », mentions légales) : tout ce qui est en dessous est ignoré
const FOOTER_RE = /signaler une carte|report (a )?lost|obtenir de l.aide|get help directly/i;
function cutFooters(items) {
  const footerY = new Map();
  for (const it of items) if (FOOTER_RE.test(it.str)) { const pg = it.page || 1; footerY.set(pg, Math.max(footerY.get(pg) || 0, it.y)); }
  return items.filter((it) => !footerY.has(it.page || 1) || it.y > footerY.get(it.page || 1) + 4);
}
// Titulaire du compte : première ligne en majuscules (2 à 4 mots) de la 1re page, hors mentions Revolut
function holderOf(items) {
  const first = items.filter((i) => (i.page || 1) === (items[0].page || 1) && String(i.str).trim());
  for (const it of first.sort((a, b) => b.y - a.y)) {
    const t = String(it.str).trim();
    if (/^[A-ZÀ-Ý][A-ZÀ-Ý' -]+$/.test(t) && t.split(/\s+/).length >= 2 && t.split(/\s+/).length <= 4 && !/REVOLUT|IBAN|BIC|EUR|USD|CHF|GBP|RELEV|STATEMENT/.test(t)) return t.replace(/\s+/g, ' ');
  }
  return '';
}
// Libellé lisible : sans IBAN ni numéro de carte masqué
const cleanLabel = (t) => t.replace(/\b[A-Z]{2}\d{2}[A-Z0-9 ]{10,32}\b/g, '').replace(/\b\d{6}\*{4,}\d{4}\b/g, '').replace(/\s*,\s*$/, '').replace(/\s+/g, ' ').trim();

export function parsePdfItems(items, { fallbackCurrency = '' } = {}) {
  const res = { format: 'pdf', lines: [], skipped: [], warnings: [] };
  if (items.length) res.holder = holderOf(items);
  items = cutFooters(items);
  const lines = groupLines(items);
  const fullText = lines.map((l) => joinItems(l.items)).join('\n');
  let docCur = '';
  const mc = fullText.match(/\b(EUR|USD|GBP|CHF|MAD)\s+(?:Statement|Account|Pocket)\b/i) || fullText.match(/(?:Relev[ée]|Statement|Compte)\s+(?:en\s+)?(EUR|USD|GBP|CHF|MAD)\b/i);
  if (mc) docCur = mc[1].toUpperCase();
  let cols = null;
  const labelOfCell = (s) => normHead(s);
  const isHeader = (l) => {
    const cells = l.items.map((i) => ({ i, n: labelOfCell(i.str) }));
    const found = {};
    for (const c of cells) for (const [k, names] of Object.entries(PDF_COLS)) if (!found[k] && names.includes(c.n)) found[k] = c.i;
    // en-têtes sur plusieurs mots séparés en items distincts (« Money » « out »)
    const joined = joinItems(l.items); const jn = normHead(joined);
    for (const [k, names] of Object.entries(PDF_COLS)) if (!found[k]) for (const nm of names) { if (jn.includes(nm) && nm.includes(' ')) { const w = nm.split(' ')[0]; const it = l.items.find((x) => normHead(x.str).startsWith(w)); if (it) found[k] = it; } }
    return found.date && found.description && found.balance && (found.out || found.in) ? found : null;
  };
  const colsFromHeader = (f) => {
    const mk = (it) => it ? { left: it.x, right: it.x + (it.w || 0), center: it.x + (it.w || 0) / 2 } : null;
    return { date: mk(f.date), description: mk(f.description), out: mk(f.out), in: mk(f.in), balance: mk(f.balance) };
  };
  let prev = null;
  const flush = () => { if (prev) { res.lines.push(prev); prev = null; } };
  for (const l of lines) {
    if (l.items.length <= 6) { const split = l.items.flatMap(splitHeaderItem); if (split.length > l.items.length) l.items = split; }
    const hdr = isHeader(l);
    if (hdr) { flush(); cols = colsFromHeader(hdr); continue; }
    if (!cols) continue;
    l.items = l.items.flatMap((it) => explodeItem(it, cols)).sort((a, b) => a.x - b.x);
    const txt = joinItems(l.items);
    if (/^(page\s+\d+|\d+\s*\/\s*\d+$|revolut (bank|ltd|payments|france)|©|report lost|get help|scan the qr|signalez|signaler|scanner le qr|obtenir de l'aide|relev[ée]\s+[A-Z]{3}$|statement\s+[A-Z]{3}$|g[ée]n[ée]r[ée] le|generated on)/i.test(txt)) { flush(); continue; }
    if (/^(total|balance summary|r[ée]sum[ée] du solde|opening balance|closing balance|solde d'ouverture|solde de cl[oô]ture)/i.test(txt)) { flush(); continue; }
    const first = l.items[0];
    const dateStr = first && first.x < (cols.description.left - 2) && DATE_RE.test(first.str.trim()) ? joinItems(l.items.filter((i) => i.x < cols.description.left - 2)) : '';
    // colonnes numériques par bord droit (montants alignés à droite) ou gauche
    const numCols = ['out', 'in', 'balance'].filter((k) => cols[k]);
    const nums = {}, descParts = [];
    for (const it of l.items) {
      if (dateStr && it.x < cols.description.left - 2) continue;
      const s = it.str.trim();
      if (looksAmount(s) && it.x + (it.w || 0) > cols.description.left + 20 && numCols.length) {
        const r = it.x + (it.w || 0);
        let best = null, bd = Infinity;
        // colonne la plus proche : on compare le centre du montant au centre de l'en-tête, et le bord droit (montants alignés à droite)
        // au bord droit de l'en-tête ; on retient le meilleur des deux critères
        const ctr = it.x + (it.w || 0) / 2;
        for (const k of numCols) { const d = Math.min(Math.abs(ctr - cols[k].center), Math.abs(r - cols[k].right), Math.abs(it.x - cols[k].left)); if (d < bd) { bd = d; best = k; } }
        if (bd <= 60) { nums[best] = (nums[best] ? nums[best] + ' ' : '') + s; continue; }
      }
      descParts.push(it);
    }
    const desc = joinItems(descParts);
    if (dateStr) {
      flush();
      const date = parseDate(dateStr);
      if (!date) { res.skipped.push({ reason: 'illisible', label: desc, date: dateStr, montant: '', devise: '' }); continue; }
      const outV = nums.out != null ? parseAmount(nums.out.replace(/[A-Za-z€$£]/g, '')) : null;
      const inV = nums.in != null ? parseAmount(nums.in.replace(/[A-Za-z€$£]/g, '')) : null;
      let montant = null;
      if (inV != null && inV !== 0) montant = Math.abs(inV);
      else if (outV != null && outV !== 0) montant = -Math.abs(outV);
      const cur = currencyIn(`${nums.out || ''} ${nums.in || ''}`) || docCur || fallbackCurrency || 'EUR';
      if (montant == null) { if (desc) res.skipped.push({ reason: 'illisible', label: desc, date, montant: '', devise: cur }); continue; }
      if (!CURRENCIES.includes(cur)) { res.skipped.push({ reason: `devise ${cur} non gérée`, label: desc, date, montant, devise: cur }); continue; }
      const solde = nums.balance != null ? parseAmount(nums.balance.replace(/[A-Za-z€$£]/g, '')) : null;
      prev = makeLine({ date, libelle: desc, montant: Math.round(montant * 100) / 100, devise: cur, solde, typeOp: '', kind: kindFromText(desc) });
    } else if (prev && desc && !Object.keys(nums).length) {
      // ligne de suite : complément de libellé (on écarte les lignes techniques)
      if (/^(card|carte|revolut rate|taux revolut|fees?:|frais:|reference|r[ée]f[ée]rence|exchange rate|taux de change)\b/i.test(desc)) {
        if (/^(reference|r[ée]f[ée]rence)/i.test(desc)) prev.libelle = `${prev.libelle} — ${desc.replace(/^[^:]*:\s*/, '')}`.slice(0, 160);
      } else prev.libelle = `${prev.libelle} ${desc}`.replace(/\s+/g, ' ').trim().slice(0, 160);
    }
  }
  flush();
  for (const l of res.lines) { l.libelle = cleanLabel(l.libelle); l.kind = kindFromText(l.libelle); if (l.kind === 'card') l.libelle = l.libelle.replace(/\s+[ÀA]\s:.*$/, '').trim() || l.libelle; }   // paiement carte : on garde le nom du commerçant
  if (!cols) res.error = 'Mise en page du PDF non reconnue (tableau « Date / Description / Argent sortant / Argent entrant / Solde » introuvable). Exporte plutôt le relevé en CSV ou Excel depuis l’app Revolut (Relevés › Excel / CSV).';
  else if (!res.lines.length) res.error = 'Aucune opération lue dans ce PDF. Exporte plutôt le relevé en CSV ou Excel depuis l’app Revolut (Relevés › Excel / CSV).';
  if (!docCur && res.lines.length) res.warnings.push(`Devise du relevé non indiquée : ${fallbackCurrency || 'EUR'} supposée.`);
  finalize(res.lines);
  return res;
}

// Extrait les items de texte d'un PDF avec pdf.js (objet pdfjs passé en paramètre : navigateur ou Node)
export async function extractPdfItems(pdfjs, data) {
  const doc = await pdfjs.getDocument({ data: data instanceof Uint8Array ? data : new Uint8Array(data), useSystemFonts: true, isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise;
  const items = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    for (const it of tc.items) if (it.str != null && String(it.str).trim()) items.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, page: p });
  }
  return items;
}

// ---------- point d'entrée : un fichier (octets) ----------
// opts : { name, XLSX, pdfjs, fallbackCurrency }
export async function parseStatementFile(buffer, { name = '', XLSX = null, pdfjs = null, fallbackCurrency = '' } = {}) {
  const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const ext = String(name).toLowerCase().split('.').pop();
  const isPdf = ext === 'pdf' || (u8[0] === 0x25 && u8[1] === 0x50 && u8[2] === 0x44 && u8[3] === 0x46);
  const isZip = u8[0] === 0x50 && u8[1] === 0x4b;               // xlsx = archive zip
  const isOle = u8[0] === 0xd0 && u8[1] === 0xcf;               // xls
  if (isPdf) {
    if (!pdfjs) return { format: 'pdf', lines: [], skipped: [], warnings: [], error: 'Lecteur PDF indisponible. Exporte plutôt le relevé en CSV ou Excel.' };
    let items;
    try { items = await extractPdfItems(pdfjs, u8); } catch (e) { return { format: 'pdf', lines: [], skipped: [], warnings: [], error: `PDF illisible (${e.message || 'erreur'}). Exporte plutôt le relevé en CSV ou Excel depuis l’app Revolut.` }; }
    if (!items.length) return { format: 'pdf', lines: [], skipped: [], warnings: [], error: 'Ce PDF ne contient pas de texte (image scannée ?). Exporte le relevé en CSV ou Excel depuis l’app Revolut.' };
    return parsePdfItems(items, { fallbackCurrency });
  }
  if (isZip || isOle || ext === 'xlsx' || ext === 'xls') {
    if (!XLSX) return { format: 'xlsx', lines: [], skipped: [], warnings: [], error: 'Module Excel indisponible.' };
    try { return parseXlsx(XLSX, u8); } catch (e) { return { format: 'xlsx', lines: [], skipped: [], warnings: [], error: `Fichier Excel illisible (${e.message || 'erreur'}).` }; }
  }
  let text = new TextDecoder('utf-8').decode(u8);
  if (text.includes('�')) { try { text = new TextDecoder('windows-1252').decode(u8); } catch { /* garde l'UTF-8 */ } }
  return parseCsv(text);
}

// Résumé lisible d'un résultat de lecture
export function summarizeParse(res) {
  const by = {};
  for (const s of res.skipped) by[s.reason] = (by[s.reason] || 0) + 1;
  return { read: res.lines.length + res.skipped.length, kept: res.lines.length, skippedBy: by };
}
