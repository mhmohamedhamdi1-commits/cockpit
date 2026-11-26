import { S, partOf } from './state.js';
import { addMonths, monthsBetween, sum } from './util.js';
import * as core from './core.js';

export const inRange = (date, p) => { const m = date.slice(0, 7); return m >= p.from && m <= p.to; };
// Part : en consolidé toujours « mes parts » ; le choix Ma part / 100 % n'existe que dans l'écran Immobilier
export const weight = (t) => (t.activite !== 'Immobilier' ? 1 : S.route === 'immo' && S.immoView === 'full' ? 1 : partOf(t.projetId));
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
  const g = S.chartGran || 'auto';
  const mode = g !== 'auto' ? g : ms.length <= 18 ? 'm' : ms.length <= 48 ? 'q' : 'y';
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

// Délégation au module partagé (S sert de contexte)
export const tenancyFor = (lot, month) => core.tenancyFor(S, lot, month);
export const activeTenants = (date = S.today) => core.activeTenants(S, date);
export const rentCell = (lot, month) => core.rentCell(S, lot, month);
export const microFactor = (year) => core.microFactor(S, year);
export const freelanceYear = (year) => core.freelanceYear(S, year);
export const microYear = () => core.microYear(S);

// Tri stable « plus récent d'abord » (date puis ordre de saisie)
export const byDateDesc = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.seq || 1e15) - (a.seq || 1e15));
