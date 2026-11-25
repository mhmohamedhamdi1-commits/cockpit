import { S } from './state.js';
import { addMonths, monthsBetween, monthEnd, monthStart, sum } from './util.js';

export const inRange = (date, p) => { const m = date.slice(0, 7); return m >= p.from && m <= p.to; };
export const weight = (t) => (t.activite === 'Immobilier' && S.immoView === 'mine' ? S.P.part : 1);
export const eurOf = (t) => t.montantEur * weight(t);

export function txs({ period = S.period, activity = S.activity } = {}) {
  return S.data.tx.filter((t) => inRange(t.date, period) && (activity === 'Tout' || t.activite === activity));
}
export function groupOf(t) { const c = S.catMap[`${t.activite}|${t.sens}|${t.categorie}`]; return c ? c.groupe : 'Autres'; }
export function iconOf(t) { const c = S.catMap[`${t.activite}|${t.sens}|${t.categorie}`]; return c ? c.icone : '•'; }

// Résumé d'une liste de transactions (en EUR, pondéré "ma part" pour l'immobilier)
export function summarize(list, { activity = S.activity } = {}) {
  let rev = 0, dep = 0, inv = 0, fin = 0;
  for (const t of list) {
    const v = eurOf(t);
    if (t.nature === 'Courant') { if (t.sens === 'Revenu') rev += v; else dep += v; }
    else if (t.nature === 'Investissement') {
      if (activity === 'Tout' && t.activite === 'Immobilier') continue; // déjà compté via l'apport Perso
      inv += t.sens === 'Dépense' ? v : -v;
    } else fin += t.sens === 'Revenu' ? v : -v;
  }
  return { rev, dep, res: rev - dep, inv, fin, rate: rev > 0 ? (rev - dep) / rev : null };
}

export function prevPeriod(p = S.period) {
  const n = monthsBetween(p.from, p.to).length;
  return { from: addMonths(p.from, -n), to: addMonths(p.from, -1) };
}

// Buckets pour les graphiques : mois / trimestres / années selon la longueur
export function buckets(p = S.period) {
  const ms = monthsBetween(p.from, p.to);
  const mode = ms.length <= 18 ? 'm' : ms.length <= 48 ? 'q' : 'y';
  const map = new Map();
  for (const m of ms) {
    let k, label;
    if (mode === 'm') { k = m; label = m; }
    else if (mode === 'q') { const q = Math.floor((+m.slice(5, 7) - 1) / 3) + 1; k = `${m.slice(0, 4)}-T${q}`; label = k; }
    else { k = m.slice(0, 4); label = k; }
    if (!map.has(k)) map.set(k, { key: k, label, months: [] });
    map.get(k).months.push(m);
  }
  return { mode, list: [...map.values()] };
}
export function bucketOf(date, mode) {
  const m = date.slice(0, 7);
  if (mode === 'm') return m;
  if (mode === 'q') return `${m.slice(0, 4)}-T${Math.floor((+m.slice(5, 7) - 1) / 3) + 1}`;
  return m.slice(0, 4);
}

export function seriesByBucket(list, p = S.period, activity = S.activity) {
  const b = buckets(p);
  const idx = new Map(b.list.map((x) => [x.key, { ...x, rev: 0, dep: 0, inv: 0, res: 0 }]));
  const groups = new Map();
  for (const t of list) {
    const k = bucketOf(t.date, b.mode); const x = idx.get(k); if (!x) continue;
    (groups.get(k) || groups.set(k, []).get(k)).push(t);
  }
  for (const [k, ts] of groups) { const s = summarize(ts, { activity }); Object.assign(idx.get(k), s); }
  return { mode: b.mode, points: [...idx.values()] };
}

export function topCategories(list, { by = 'groupe', n = 8 } = {}) {
  const m = new Map();
  for (const t of list) {
    if (t.nature !== 'Courant' || t.sens !== 'Dépense') continue;
    const k = by === 'groupe' ? groupOf(t) : t.categorie;
    m.set(k, (m.get(k) || 0) + eurOf(t));
  }
  const arr = [...m.entries()].sort((a, b) => b[1] - a[1]);
  if (arr.length > n) { const rest = sum(arr.slice(n - 1), (x) => x[1]); return [...arr.slice(0, n - 1), ['Autres postes', rest]]; }
  return arr;
}

// ---------- Immobilier : locataires & loyers ----------
export function tenancyFor(lotLabel, month) {
  const a = monthStart(month), b = monthEnd(month);
  const c = S.data.tenants.filter((t) => t.lot === lotLabel && (!t.entree || t.entree <= b) && (!t.sortie || t.sortie >= a));
  c.sort((x, y) => (y.entree || '').localeCompare(x.entree || ''));
  return c[0] || null;
}
export const activeTenants = (date = S.today) => S.data.tenants.filter((t) => (!t.entree || t.entree <= date) && (!t.sortie || t.sortie >= date));
const toMad = (t) => (t.devise === 'MAD' ? t.montant : t.montantEur / S.P.taux);

let _rentIdx = null, _rentSrc = null;
function rentIndex() {
  if (_rentSrc === S.data) return _rentIdx;
  const m = new Map();
  for (const t of S.data.tx) {
    if (t.activite !== 'Immobilier' || t.categorie !== 'Loyer' || t.sens !== 'Revenu') continue;
    const k = `${t.lot}|${t.periode || t.date.slice(0, 7)}`;
    const e = m.get(k) || { paid: 0, txs: [] };
    e.paid += toMad(t); e.txs.push(t); m.set(k, e);
  }
  _rentSrc = S.data; _rentIdx = m; return m;
}
export function rentCell(lot, month) {
  const ten = tenancyFor(lot, month);
  const e = rentIndex().get(`${lot}|${month}`) || { paid: 0, txs: [] };
  let expected = ten ? ten.loyer : 0;
  // mois partiel (entrée ou sortie en cours de mois) : au prorata, ou considéré réglé si un paiement existe
  if (ten) {
    const a = monthStart(month), b = monthEnd(month), dim = +b.slice(8, 10);
    const startDay = ten.entree && ten.entree > a ? +ten.entree.slice(8, 10) : 1;
    const endDay = ten.sortie && ten.sortie < b ? +ten.sortie.slice(8, 10) : dim;
    if (startDay > 1 || endDay < dim) expected = e.paid > 0 ? e.paid : Math.round(((endDay - startDay + 1) / dim) * ten.loyer / 50) * 50;
  }
  const cur = S.today.slice(0, 7);
  let status;
  if (expected === 0 && e.paid === 0) status = 'vac';
  else if (expected > 0 && e.paid >= expected - 0.5) status = 'paid';
  else if (expected === 0) status = 'paid';
  else if (e.paid > 0) status = 'part';
  else if (month > cur) status = 'fut';
  else if (month === cur) status = 'due';
  else status = 'late';
  return { status, paid: e.paid, expected, tenant: ten, txs: e.txs };
}

// ---------- Freelance ----------
// Seuls les clients "compte dans la micro" et les périodes >= début de la micro-entreprise comptent.
export function microFactor(year) {
  const start = S.P.microDebut || '2027-01-01';
  if (String(year) !== start.slice(0, 4)) return 1;
  const d0 = new Date(start + 'T00:00:00'), d1 = new Date(`${year}-12-31T00:00:00`);
  const days = Math.round((d1 - d0) / 864e5) + 1;
  return Math.min(1, days / 365);
}
export function freelanceYear(year) {
  const micro = new Set(S.data.clients.filter((c) => c.micro === 'Oui').map((c) => c.nom));
  const from = (S.P.microDebut || '2027-01-01').slice(0, 7);
  const ht = (i) => (i.devise === 'MAD' ? i.ht * S.P.taux : i.ht);
  const yr = (d, fb) => (d || fb || '').slice(0, 4);
  let paid = 0, billed = 0, planned = 0;
  for (const i of S.data.invoices) {
    if (!micro.has(i.client) || i.periode < from) continue;
    if (i.statut === 'Payée' && yr(i.paiement, i.emission || i.periode + '-01') === year) paid += ht(i);
    else if (i.statut === 'Envoyée' && yr(i.emission, i.periode + '-01') === year) billed += ht(i);
    else if (i.statut === 'Planifiée' && i.periode.slice(0, 4) === year) planned += ht(i);
  }
  const f = microFactor(year);
  return { paid, billed, planned, total: paid + billed + planned, factor: f, micro: S.P.seuilMicro * f, tva: S.P.seuilTva * f, tvaMaj: S.P.seuilTvaMaj * f };
}
export function microYear() { return Math.max(+S.today.slice(0, 4), +(S.P.microDebut || '2027').slice(0, 4)); }
