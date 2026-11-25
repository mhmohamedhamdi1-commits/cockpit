// Export / import Excel au format historique de Cockpit (mêmes onglets, mêmes en-têtes).
// Module sans dépendance au DOM : utilisé par l'application (navigateur) et par le script de migration (Node).
// La bibliothèque SheetJS est passée en paramètre (XLSX).
import { TABLES, BY_KEY, dbCol, DEFAULT_PARAMS } from './schema.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const round2 = (v) => Math.round(v * 100) / 100;
const pad = (n) => String(n).padStart(2, '0');

// ---------- conversions ----------
export function serialToDate(n) {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 864e5);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
export function dateToSerial(s) {
  const [y, m, d] = s.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 864e5);
}
export function parseDate(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  if (typeof v === 'number') return v > 20000 && v < 80000 ? serialToDate(v) : '';
  const s = String(v).trim();
  if (!s) return '';
  const n = Number(s);
  if (isFinite(n) && n > 20000 && n < 80000) return serialToDate(n);
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${pad(m[2])}-${pad(m[1])}`; }
  return '';
}
export function parseNum(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  const s = String(v ?? '').replace(/[\s  ]/g, '').replace(',', '.');
  if (!s) return 0;
  const n = Number(s);
  return isFinite(n) ? n : 0;
}

// ---------- lecture ----------
// Renvoie { data: { tx: [lignes au format base], ... }, counts, errors, warnings, sheets }
export function parseWorkbook(XLSX, buf) {
  const wb = XLSX.read(buf, { type: buf instanceof ArrayBuffer ? 'array' : 'buffer', cellDates: false });
  const data = {}, counts = {}, errors = [], warnings = [], sheets = [];
  for (const def of TABLES) {
    const ws = wb.Sheets[def.sheet];
    if (!ws) continue;
    sheets.push(def.sheet);
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
    if (!rows.length) { data[def.key] = []; counts[def.key] = 0; continue; }
    const hdr = new Map(rows[0].map((h, i) => [String(h).trim(), i]));
    const missing = def.cols.filter((c) => !hdr.has(c.x)).map((c) => c.x);
    if (missing.length) warnings.push(`${def.sheet} : colonne(s) absente(s) ${missing.join(', ')} (laissées vides)`);
    const out = [];
    rows.slice(1).forEach((r, i) => {
      if (!r.some((c) => String(c).trim() !== '')) return;
      const o = { _row: i + 2 };
      for (const c of def.cols) {
        const ci = hdr.get(c.x);
        const raw = ci == null ? '' : r[ci];
        const k = dbCol(c);
        if (c.t === 'date') o[k] = parseDate(raw) || null;
        else if (c.t === 'money' || c.t === 'rate') o[k] = parseNum(raw);
        else if (c.t === 'int') o[k] = Math.round(parseNum(raw));
        else o[k] = String(raw ?? '').trim();
      }
      const u = hdr.has('UUID') ? String(r[hdr.get('UUID')] || '').trim() : '';
      if (UUID_RE.test(u)) o.id = u.toLowerCase();
      else if (def.id && hdr.has('ID')) { const n = Math.round(parseNum(r[hdr.get('ID')])); if (n > 0) o.legacy_id = n; }
      out.push(o);
    });
    data[def.key] = out;
    counts[def.key] = out.length;
  }
  if (!sheets.includes('Transactions')) errors.push('Onglet « Transactions » introuvable : ce fichier n\'est pas un export Cockpit.');
  normalize(data, errors);
  for (const k of Object.keys(data)) for (const r of data[k]) delete r._row;
  return { data, counts, errors, warnings, sheets };
}

// Complète les champs calculés (équivalent de normalizeLoaded en Go) et vérifie la validité
function normalize(d, errors) {
  const params = d.params || [];
  for (const [cle, valeur, libelle] of DEFAULT_PARAMS) if (!params.some((p) => p.cle === cle)) params.push({ cle, valeur, libelle });
  if (d.params) d.params = params;
  const rate = parseNum((params.find((p) => p.cle === 'taux_mad_eur') || {}).valeur) || 0.093;
  const cat = new Map((d.categories || []).map((c) => [`${c.activite}|${c.sens}|${c.categorie}`, c]));
  const err = (sheet, r, msg) => { if (errors.length < 50) errors.push(`${sheet} ligne ${r._row} : ${msg}`); };
  for (const t of d.tx || []) {
    if (t.devise !== 'MAD') t.devise = 'EUR';
    if (!(t.taux > 0)) t.taux = t.devise === 'MAD' ? rate : 1;
    if (t.montant_eur === 0 && t.montant !== 0) t.montant_eur = round2(t.montant * t.taux);
    if (t.montant < 0) {
      t.montant = -t.montant; t.montant_eur = -t.montant_eur;
      t.sens = t.sens === 'Revenu' ? 'Dépense' : 'Revenu';
    }
    if (!t.nature) t.nature = (cat.get(`${t.activite}|${t.sens}|${t.categorie}`) || {}).nature || 'Courant';
    if (!t.periode && t.date) t.periode = t.date.slice(0, 7);
    if (!t.date) err('Transactions', t, 'date manquante ou illisible');
    if (!(t.montant > 0)) err('Transactions', t, 'montant nul');
    if (!['Perso', 'Freelance', 'Immobilier'].includes(t.activite)) err('Transactions', t, `activité « ${t.activite} » invalide`);
    if (!['Revenu', 'Dépense'].includes(t.sens)) err('Transactions', t, `sens « ${t.sens} » invalide`);
    if (!t.categorie) err('Transactions', t, 'catégorie vide');
    if (!['Courant', 'Investissement', 'Financement'].includes(t.nature)) err('Transactions', t, `nature « ${t.nature} » invalide`);
  }
  for (const v of d.invoices || []) {
    if (v.ht === 0) v.ht = round2(v.jours * v.tjm);
    if (v.ttc === 0) v.ttc = round2(v.ht * (1 + v.tva));
    if (v.devise !== 'MAD') v.devise = 'EUR';
    if (!['Planifiée', 'Envoyée', 'Payée'].includes(v.statut)) v.statut = 'Planifiée';
    if (!v.client) err('Factures', v, 'client vide');
    if (!/^\d{4}-\d{2}$/.test(v.periode)) err('Factures', v, `période « ${v.periode} » invalide (AAAA-MM)`);
  }
  for (const s of d.snapshots || []) {
    if (s.devise !== 'MAD') s.devise = 'EUR';
    if (s.solde_eur === 0 && s.solde !== 0) s.solde_eur = s.devise === 'MAD' ? round2(s.solde * rate) : s.solde;
    if (!s.date) err('Relevés', s, 'date manquante');
  }
  for (const k of ['lots', 'tenants', 'clients', 'accounts']) for (const r of d[k] || []) if (!r.nom) err(BY_KEY[k].sheet, r, 'nom vide');
  for (const r of d.tenants || []) if (!r.lot) err('Locataires', r, 'lot vide');
  for (const r of d.recurring || []) if (!r.libelle || !r.categorie) err('Récurrents', r, 'libellé ou catégorie vide');
  for (const r of d.rappels || []) { if (!r.titre || !r.date) err('Rappels', r, 'titre ou échéance vide'); if (!['Une fois', 'Mensuel', 'Trimestriel', 'Annuel'].includes(r.frequence)) r.frequence = 'Une fois'; }
  for (const r of d.categories || []) if (!r.activite || !r.sens || !r.categorie) err('Catégories', r, 'activité, sens ou catégorie vide');
}

// ---------- écriture ----------
// data = données au format de l'interface (S.data). Renvoie un classeur SheetJS.
export function buildWorkbook(XLSX, data, { exportedAt = new Date() } = {}) {
  const wb = XLSX.utils.book_new();
  for (const def of TABLES) {
    const list = [...(data[def.key] || [])];
    if (def.key === 'tx') list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.seq || 0) - (b.seq || 0)));
    else list.sort((a, b) => (a.seq || 0) - (b.seq || 0));
    const head = [...(def.id ? ['ID'] : []), ...def.cols.map((c) => c.x), 'UUID'];
    const aoa = [head];
    for (const r of list) {
      const row = def.id ? [r.seq || ''] : [];
      for (const c of def.cols) {
        const v = r[c.k];
        if (c.t === 'date') row.push(v ? { t: 'n', v: dateToSerial(v), z: 'dd/mm/yyyy' } : '');
        else if (c.t === 'money') row.push({ t: 'n', v: Number(v) || 0, z: '#,##0.00' });
        else if (c.t === 'rate') row.push({ t: 'n', v: Number(v) || 0, z: '0.0000' });
        else if (c.t === 'int') row.push({ t: 'n', v: Number(v) || 0, z: '0' });
        else row.push(v == null ? '' : String(v));
      }
      row.push(r.id || '');
      aoa.push(row);
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [...(def.id ? [{ wch: 7 }] : []), ...def.cols.map((c) => ({ wch: c.w || 14 })), { wch: 38 }];
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(aoa.length - 1, 1), c: head.length - 1 } }) };
    XLSX.utils.book_append_sheet(wb, ws, def.sheet);
  }
  const lines = [
    ['COCKPIT — export des données'],
    [`Exporté le ${exportedAt.toLocaleString('fr-FR')}`],
    [''],
    ['Ce fichier est une copie de tes données. La base centrale est dans l\'application (Supabase).'],
    ['Le modifier ici ne change rien dans l\'application.'],
    ['Pour revenir à ce fichier : Paramètres › Données › « Restaurer depuis un fichier Excel ». Toutes les données actuelles seront alors remplacées (un point de restauration est créé avant).'],
    ['Ne renomme ni les onglets ni les en-têtes. La colonne UUID identifie chaque ligne : ne la modifie pas.'],
    ['Montants toujours positifs : la colonne Sens (Revenu / Dépense) indique le signe.'],
  ];
  const rd = XLSX.utils.aoa_to_sheet(lines);
  rd['!cols'] = [{ wch: 120 }];
  XLSX.utils.book_append_sheet(wb, rd, 'Lisez-moi');
  return wb;
}

export const exportFileName = (d = new Date()) =>
  `Cockpit_Export_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}.xlsx`;
