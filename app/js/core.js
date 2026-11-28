// Calculs purs (sans DOM, sans état global) : partagés par l'application et par la fonction
// serveur de notifications. ctx = { data, today, P, catMap, lots, immoView }.
import { addMonths, monthEnd, monthStart, monthLong, monthLabel, daysBetween, fmtDate, mad, eur } from './util.js';
import { entrepriseAlerts, entrepriseHealth } from './entreprise.js';   // module Entreprise (pur) : alertes de plafonds / échéances, santé

export function buildIndex(data) {
  const P = {}; for (const p of data.params) P[p.cle] = p.valeur;
  const n = (k, def) => { const v = parseFloat(String(P[k] ?? '').replace(',', '.')); return isFinite(v) ? v : def; };
  const catMap = {};
  for (const c of data.categories) catMap[`${c.activite}|${c.sens}|${c.categorie}`] = c;
  return {
    P: {
      taux: n('taux_mad_eur', 0.093), part: n('part_immo', 0.67), seuilMicro: n('seuil_micro', 83600),
      seuilTva: n('seuil_tva', 37500), seuilTvaMaj: n('seuil_tva_maj', 41250), cotis: n('taux_cotis', 0.256),
      cfp: n('taux_cfp', 0.002), provision: n('taux_provision', 0.4), nom: P.nom || '', microDebut: P.micro_debut || '2027-01-01',
      notif: (k) => (P['notif_' + k] ?? 'Oui') !== 'Non', notifNum: (k, d) => n('notif_' + k, d),
    },
    catMap,
    lots: [...data.lots].sort((a, b) => String(a.code).localeCompare(String(b.code))),
  };
}

// ---------- Immobilier ----------
export function tenancyFor(ctx, lotLabel, month) {
  const a = monthStart(month), b = monthEnd(month);
  const c = ctx.data.tenants.filter((t) => t.lot === lotLabel && (!t.entree || t.entree <= b) && (!t.sortie || t.sortie >= a));
  c.sort((x, y) => (y.entree || '').localeCompare(x.entree || ''));
  return c[0] || null;
}
export const activeTenants = (ctx, date = ctx.today) => ctx.data.tenants.filter((t) => (!t.entree || t.entree <= date) && (!t.sortie || t.sortie >= date));
const toMad = (ctx, t) => (t.devise === 'MAD' ? t.montant : t.montantEur / ctx.P.taux);

const rentCache = new WeakMap();
function rentIndex(ctx) {
  const hit = rentCache.get(ctx.data.tx);
  if (hit) return hit;
  const m = new Map();
  for (const t of ctx.data.tx) {
    if (t.activite !== 'Immobilier' || t.categorie !== 'Loyer' || t.sens !== 'Revenu') continue;
    const k = `${t.lot}|${t.periode || t.date.slice(0, 7)}`;
    const e = m.get(k) || { paid: 0, txs: [] };
    e.paid += toMad(ctx, t); e.txs.push(t); m.set(k, e);
  }
  rentCache.set(ctx.data.tx, m);
  return m;
}
export function rentCell(ctx, lot, month) {
  const ten = tenancyFor(ctx, lot, month);
  const e = rentIndex(ctx).get(`${lot}|${month}`) || { paid: 0, txs: [] };
  let expected = ten ? ten.loyer : 0;
  if (ten) {
    const a = monthStart(month), b = monthEnd(month), dim = +b.slice(8, 10);
    const startDay = ten.entree && ten.entree > a ? +ten.entree.slice(8, 10) : 1;
    const endDay = ten.sortie && ten.sortie < b ? +ten.sortie.slice(8, 10) : dim;
    if (startDay > 1 || endDay < dim) expected = e.paid > 0 ? e.paid : Math.round(((endDay - startDay + 1) / dim) * ten.loyer / 50) * 50;
  }
  const cur = ctx.today.slice(0, 7);
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

// ---------- Récurrents ----------
export const recurringApplies = (r, m) => r.actif !== 'Non' && (!r.debut || r.debut <= m + '-31') && (!r.fin || r.fin >= m + '-01');
export function missingRecurring(ctx, m) {
  const have = new Set(ctx.data.tx.map((t) => t.ref).filter(Boolean));
  return ctx.data.recurring.filter((r) => recurringApplies(r, m) && !have.has(`REC${r.id}:${m}`));
}

// ---------- Rappels / échéances ----------
// Prochaine occurrence >= from (YYYY-MM-DD) d'un rappel. null si terminé.
export function nextOccurrence(r, from) {
  if (!r.date) return null;
  if (r.frequence === 'Une fois' || !r.frequence) return r.date >= from ? r.date : null;
  const step = r.frequence === 'Mensuel' ? 1 : r.frequence === 'Trimestriel' ? 3 : 12;
  const eom = r.date === monthEnd(r.date.slice(0, 7));
  const day = +r.date.slice(8, 10);
  for (let k = r.date.slice(0, 7), i = 0; i < 1200; k = addMonths(k, step), i++) {
    const last = monthEnd(k);
    const d = eom ? last : `${k}-${String(Math.min(day, +last.slice(8, 10))).padStart(2, '0')}`;
    if (d >= from) return d;
  }
  return null;
}
export function upcomingRappels(ctx, days = 45) {
  const out = [];
  for (const r of ctx.data.rappels || []) {
    if (r.actif === 'Non') continue;
    const d = nextOccurrence(r, ctx.today);
    if (d && daysBetween(ctx.today, d) <= days) out.push({ r, date: d, inDays: daysBetween(ctx.today, d) });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

// Jours ouvrés (lun-ven), sans jours fériés
export function lastBusinessDay(month) {
  let d = new Date(monthEnd(month) + 'T12:00:00');
  while (d.getDay() === 0 || d.getDay() === 6) d = new Date(d.getTime() - 864e5);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Rappel « facture d'électricité » : du jour `elec_debut` au jour `elec_fin` de chaque mois (1 → 3), tant qu'aucune dépense
// « Eau & électricité » du mois n'est saisie dans l'immobilier.
export function elecDue(ctx) {
  const from = Math.round(ctx.P.notifNum('elec_debut', 1)), to = Math.round(ctx.P.notifNum('elec_fin', 3));
  const day = +ctx.today.slice(8, 10), month = ctx.today.slice(0, 7);
  const hasImmo = ctx.data.projets ? ctx.data.projets.some((p) => (p.type || 'Immobilier') === 'Immobilier') || ctx.data.tx.some((t) => t.activite === 'Immobilier') : ctx.data.tx.some((t) => t.activite === 'Immobilier');
  const paid = ctx.data.tx.some((t) => t.activite === 'Immobilier' && t.sens === 'Dépense' && t.categorie === 'Eau & électricité' && t.date.slice(0, 7) === month && t.date.slice(8, 10) >= String(from).padStart(2, '0'));
  return { due: ctx.P.notif('elec') && hasImmo && day >= from && day <= to && !paid, from, to, paid, month };
}

// ---------- Alertes du tableau de bord (et base des notifications) ----------
export function computeAlerts(ctx) {
  const out = [], cur = ctx.today.slice(0, 7), d = ctx.data;
  const lateM = [addMonths(cur, -1), addMonths(cur, -2), addMonths(cur, -3)];
  let lateN = 0, lateAmt = 0, dueN = 0, dueAmt = 0;
  const lateList = [];
  for (const lot of ctx.lots) {
    for (const m of lateM) { const c = rentCell(ctx, lot.nom, m); if (c.status === 'late' || c.status === 'part') { lateN++; lateAmt += c.expected - c.paid; lateList.push(`${c.tenant ? c.tenant.nom : lot.nom} (${monthLabel(m)})`); } }
    const c = rentCell(ctx, lot.nom, cur); if (c.status === 'due' || c.status === 'part') { dueN++; dueAmt += c.expected - c.paid; }
  }
  if (lateN) out.push({ id: 'loyers_retard', kind: 'bad', ic: 'alert', title: `${lateN} loyer${lateN > 1 ? 's' : ''} en retard`, sub: `${mad(lateAmt)} à récupérer sur les 3 derniers mois`, detail: lateList.slice(0, 4).join(', '), go: '#/immo', label: 'Voir' });
  if (dueN) out.push({ id: 'loyers_mois', kind: 'warn', ic: 'building', title: `${dueN} loyer${dueN > 1 ? 's' : ''} à encaisser en ${monthLong(cur).split(' ')[0]}`, sub: `${mad(dueAmt)} attendus ce mois-ci`, go: '#/immo', label: 'Encaisser' });
  const toSend = d.invoices.filter((i) => i.statut === 'Planifiée' && i.periode <= cur);
  if (toSend.length) out.push({ id: 'factures_envoyer', kind: 'warn', ic: 'send', title: `${toSend.length} facture${toSend.length > 1 ? 's' : ''} à envoyer`, sub: toSend.slice(0, 3).map((i) => `${i.client.split(' ')[0]} ${monthLabel(i.periode)}`).join(' · '), go: '#/entreprise', label: 'Voir' });
  const unpaid = d.invoices.filter((i) => i.statut === 'Envoyée' && i.emission && daysBetween(i.emission, ctx.today) > 30);
  if (unpaid.length) out.push({ id: 'factures_retard', kind: 'bad', ic: 'alert', title: `${unpaid.length} facture${unpaid.length > 1 ? 's' : ''} impayée${unpaid.length > 1 ? 's' : ''} depuis +30 j`, sub: unpaid.slice(0, 3).map((i) => `${i.numero} · ${i.client.split(' ')[0]}`).join(' · '), go: '#/entreprise', label: 'Relancer' });
  out.push(...entrepriseAlerts(ctx));   // plafonds, TVA, démarrage, jours travaillés, échéances de déclaration (par entreprise)
  for (const m of [cur, ...(+ctx.today.slice(8, 10) >= 25 ? [addMonths(cur, 1)] : [])]) {
    const miss = missingRecurring(ctx, m);
    if (miss.length) out.push({ id: 'recurrents:' + m, kind: 'info', ic: 'repeat', title: `${miss.length} opération${miss.length > 1 ? 's' : ''} récurrente${miss.length > 1 ? 's' : ''} à générer`, sub: `pour ${monthLong(m)}`, action: { key: 'generate_recurring', month: m }, label: 'Générer' });
  }
  for (const u of upcomingRappels(ctx, 15)) {
    out.push({ id: 'rappel:' + u.r.id, kind: u.inDays <= 3 ? 'warn' : 'info', ic: 'calendar', title: u.r.titre, sub: u.inDays === 0 ? 'aujourd’hui' : `le ${fmtDate(u.date)} (dans ${u.inDays} j)`, go: '#/recurring', label: 'Voir' });
  }
  const el = elecDue(ctx);
  if (el.due) out.push({ id: 'elec', kind: 'warn', ic: 'alert', title: 'Facture d’électricité à payer', sub: `Du ${el.from} au ${el.to} du mois : pense à régler la facture (immeuble).`, go: '#/ops?new=1', label: 'Saisir' });
  const pend = (d.import_lignes || []).filter((l) => l.statut === 'attente').length;
  if (pend) out.push({ id: 'imports', kind: 'info', ic: 'inbox', title: `${pend} opération${pend > 1 ? 's' : ''} à valider`, sub: 'Importées depuis un relevé bancaire', go: '#/imports', label: 'Valider' });
  const last = d.snapshots.reduce((m, s) => (s.date > m ? s.date : m), '');
  if (!last || daysBetween(last, ctx.today) > 35) out.push({ id: 'releve', kind: 'info', ic: 'bank', title: 'Mets à jour tes soldes', sub: last ? `Dernier relevé : ${fmtDate(last)}` : 'Aucun relevé enregistré', go: '#/wealth', label: 'Relevé' });
  return out;
}

// =====================================================================================
// Trésorerie actuelle : cumul de TOUS les flux (courants, investissements, financements)
// depuis la première opération. Perso = compte en France ; chaque projet a la sienne.
// =====================================================================================
export function cashPosition(ctx, { partOf = () => 1, isMine = () => true } = {}) {
  const toMadV = (t) => (t.devise === 'MAD' ? t.montant : t.montantEur / ctx.P.taux);
  const sign = (t) => (t.sens === 'Revenu' ? 1 : -1);
  const perso = { eur: 0, rev: 0, dep: 0, inv: 0, fin: 0, since: '' };
  const projets = new Map();
  const ents = new Map();   // entreprises : suivies à part, JAMAIS additionnées au perso ni à l'immobilier (une facture devient un salaire dans le perso)
  for (const t of ctx.data.tx) {
    if (t.activite === 'Entreprise') {
      const k = t.projetId || '';
      const e = ents.get(k) || { id: k, eur: 0 };
      e.eur += t.montantEur * (t.sens === 'Revenu' ? 1 : -1);
      ents.set(k, e);
      continue;
    }
    if (t.activite === 'Immobilier') {
      const k = t.projetId || '';
      const p = projets.get(k) || { id: k, mad: 0, eur: 0, rev: 0, dep: 0, inv: 0, fin: 0 };
      const v = toMadV(t) * sign(t);
      p.mad += v; p.eur += t.montantEur * sign(t);
      if (t.nature === 'Courant') { if (t.sens === 'Revenu') p.rev += toMadV(t); else p.dep += toMadV(t); }
      else if (t.nature === 'Investissement') p.inv -= v; else p.fin += v;
      projets.set(k, p);
      continue;
    }
    if (!isMine(t)) continue;
    const v = t.montantEur * sign(t);
    perso.eur += v;
    if (!perso.since || t.date < perso.since) perso.since = t.date;
    if (t.nature === 'Courant') { if (t.sens === 'Revenu') perso.rev += t.montantEur; else perso.dep += t.montantEur; }
    else if (t.nature === 'Investissement') perso.inv -= v; else perso.fin += v;
  }
  const list = [...projets.values()].map((p) => {
    const pr = (ctx.data.projets || []).find((x) => x.id === p.id);
    const part = partOf(p.id || null);
    return { ...p, nom: pr ? pr.nom : 'Immobilier (sans projet)', part, mineMad: p.mad * part, mineEur: p.mad * part * ctx.P.taux, shared: pr ? !isMine(pr) : false };
  }).sort((a, b) => a.nom.localeCompare(b.nom));
  // dernier relevé de comptes (pour rapprochement)
  const lastDate = ctx.data.snapshots.reduce((m, s) => (s.date > m ? s.date : m), '');
  const releve = lastDate ? ctx.data.snapshots.filter((s) => s.date === lastDate) : [];
  const dispoAcc = new Set(ctx.data.accounts.filter((a) => a.dispo === 'Oui').map((a) => a.nom));
  const entreprises = [...ents.values()].map((e) => {
    const pr = (ctx.data.projets || []).find((x) => x.id === e.id);
    const part = pr ? Number(pr.part) : 1;
    return { ...e, nom: pr ? pr.nom : 'Entreprise (sans projet)', part, mineEur: e.eur * part };
  }).sort((a, b) => a.nom.localeCompare(b.nom));
  return {
    perso, projets: list, entreprises,
    totalMineEur: perso.eur + list.reduce((s, p) => s + p.mineEur, 0),   // perso + immobilier ; les entreprises restent à part
    releve: lastDate ? { date: lastDate, total: releve.reduce((s, x) => s + x.soldeEur, 0), dispo: releve.filter((x) => dispoAcc.has(x.compte)).reduce((s, x) => s + x.soldeEur, 0) } : null,
  };
}

// =====================================================================================
// Santé financière : un score sur 100 par domaine (Perso, Immobilier, Entreprise, Bourse) puis global.
//   chaque indicateur vaut 100 (vert), 60 (orange) ou 20 (rouge) ; le score d'un domaine = moyenne de ses indicateurs ;
//   le score global (« Tout ») = moyenne des domaines ayant des données. Chaque indicateur non vert propose un conseil.
// =====================================================================================
const GRADE = { good: 100, warn: 60, bad: 20 };
export const HEALTH_DOMAINS = ['Perso', 'Immobilier', 'Entreprise', 'Bourse'];
export const healthLabel = (score) => (score == null ? '—' : score >= 85 ? 'Excellente' : score >= 75 ? 'Bonne' : score >= 50 ? 'À surveiller' : 'Fragile');
export const healthLevel = (score) => (score == null ? 'info' : score >= 75 ? 'good' : score >= 50 ? 'warn' : 'bad');
export const HEALTH_BANDS = [['Excellente', '85 à 100', 'good'], ['Bonne', '75 à 84', 'good'], ['À surveiller', '50 à 74', 'warn'], ['Fragile', '0 à 49', 'bad']];
const avgGrade = (list) => (list.length ? Math.round(list.reduce((s, i) => s + GRADE[i.level], 0) / list.length) : null);

function persoIndicators(ctx) {
  const cur = ctx.today.slice(0, 7);
  const from12 = addMonths(cur, -12), from3 = addMonths(cur, -3);
  const closed = (t) => { const m = t.date.slice(0, 7); return m >= from12 && m < cur; };   // 12 mois complets
  let rev = 0, dep = 0, inv = 0, dep3 = 0, dep9 = 0, logement = 0;
  const catNow = new Map(), catBefore = new Map(), incomeBy = new Map();
  const grp = (t) => { const c = ctx.catMap[`${t.activite}|${t.sens}|${t.categorie}`]; return c ? c.groupe : ''; };
  for (const t of ctx.data.tx) {
    if (t.activite !== 'Perso' || !closed(t)) continue;
    const m = t.date.slice(0, 7), v = t.montantEur;
    if (t.nature === 'Courant') {
      if (t.sens === 'Revenu') { rev += v; incomeBy.set(t.categorie, (incomeBy.get(t.categorie) || 0) + v); }
      else {
        dep += v; if (grp(t) === 'Logement') logement += v;
        if (m >= from3) { dep3 += v; catNow.set(t.categorie, (catNow.get(t.categorie) || 0) + v); }
        else { dep9 += v; catBefore.set(t.categorie, (catBefore.get(t.categorie) || 0) + v); }
      }
    } else if (t.nature === 'Investissement' && t.sens === 'Dépense') inv += v;
  }
  const ind = [];
  const mk = (o) => ind.push({ domain: 'Perso', ...o });
  const monthlyRev = rev / 12, monthlyDep = dep / 12;
  const rate = rev > 0 ? (rev - dep) / rev : null;
  if (rate != null) mk({ id: 'epargne', label: 'Taux d’épargne', value: rate, fmt: 'pct', level: rate >= 0.2 ? 'good' : rate >= 0.1 ? 'warn' : 'bad',
    text: rate >= 0.2 ? `Tu mets de côté ${Math.round(rate * 100)} % de tes revenus : au-dessus de l’objectif de 20 %.` : `Objectif conseillé : 20 % de tes revenus, soit ${eur(monthlyRev * 0.2)} par mois (aujourd’hui ${eur(Math.max(0, monthlyRev - monthlyDep))}).`,
    advice: 'Automatise un virement d’épargne le jour de la paie et regarde les 3 plus grosses dépenses variables.' });
  // épargne de précaution (comptes disponibles du dernier relevé)
  const last = ctx.data.snapshots.reduce((m, x) => (x.date > m ? x.date : m), '');
  if (last && monthlyDep > 0) {
    const dispoAcc = new Set(ctx.data.accounts.filter((a) => a.dispo === 'Oui').map((a) => a.nom));
    const dispo = ctx.data.snapshots.filter((x) => x.date === last && dispoAcc.has(x.compte)).reduce((s, x) => s + x.soldeEur, 0);
    const months = dispo / monthlyDep;
    mk({ id: 'precaution', label: 'Épargne de précaution', value: months, fmt: 'mois', level: months >= 6 ? 'good' : months >= 3 ? 'warn' : 'bad',
      text: months >= 6 ? `${months.toFixed(1).replace('.', ',')} mois de dépenses couverts par ton disponible : confortable.` : `${months.toFixed(1).replace('.', ',')} mois couverts. Vise 3 à 6 mois de dépenses (${eur(monthlyDep * 3)} à ${eur(monthlyDep * 6)}) sur un compte disponible.`,
      advice: `Il manque environ ${eur(Math.max(0, monthlyDep * 6 - dispo))} pour 6 mois : mets en place un virement mensuel vers un livret.` });
  }
  if (dep9 > 0) {
    const trend = (dep3 / 3) / (dep9 / 9) - 1;
    const up = [...catNow.entries()].map(([k, x]) => [k, x / 3 - (catBefore.get(k) || 0) / 9]).filter(([, d]) => d > 20).sort((a, b) => b[1] - a[1]).slice(0, 3);
    mk({ id: 'tendance', label: 'Tendance des dépenses', value: trend, fmt: 'delta', level: trend <= 0.05 ? 'good' : trend <= 0.2 ? 'warn' : 'bad',
      text: trend <= 0.05 ? 'Tes dépenses des 3 derniers mois sont stables ou en baisse.' : `Dépenses en hausse de ${Math.round(trend * 100)} % sur les 3 derniers mois${up.length ? ` : ${up.map(([k, d]) => `${k} (+${eur(d)}/mois)`).join(', ')}` : ''}.`,
      advice: 'Fixe un plafond mensuel pour les catégories en hausse.' });
  }
  if (rev > 0 && incomeBy.size) {
    const [topK, topV] = [...incomeBy.entries()].sort((a, b) => b[1] - a[1])[0];
    const share = topV / rev;
    mk({ id: 'revenus', label: 'Diversification des revenus', value: share, fmt: 'pct', level: share <= 0.6 ? 'good' : share <= 0.85 ? 'warn' : 'bad',
      text: `${Math.round(share * 100)} % de tes revenus viennent de « ${topK} ».${share > 0.85 ? ' Une autre source (loyers, activité) réduirait le risque.' : ''}`,
      advice: 'Développe une 2ᵉ source : activité d’entreprise, dividendes, loyers.' });
  }
  if (rev > 0) {
    const ir = inv / rev;
    mk({ id: 'invest', label: 'Effort d’investissement', value: ir, fmt: 'pct', level: ir >= 0.1 ? 'good' : ir > 0 ? 'warn' : 'bad',
      text: ir >= 0.1 ? `${Math.round(ir * 100)} % de tes revenus investis sur 12 mois.` : `Investir au moins 10 % de tes revenus (${eur(monthlyRev * 0.1)}/mois) fait travailler ton épargne.`,
      advice: 'Programme un investissement mensuel automatique (ETF diversifié).' });
  }
  if (rev > 0 && logement > 0) {
    const r = logement / rev;
    mk({ id: 'logement', label: 'Poids du logement', value: r, fmt: 'pct', level: r <= 0.33 ? 'good' : r <= 0.4 ? 'warn' : 'bad',
      text: `Le logement représente ${Math.round(r * 100)} % de tes revenus (repère : 33 % maximum).`, advice: 'Au-delà de 33 %, le logement limite ta capacité d’épargne : renégocie, colocation, ou rachat de crédit.' });
  }
  return { ind, monthlyRev, monthlyDep };
}

function immoIndicators(ctx, o) {
  const ind = [];
  const mk = (x) => ind.push({ domain: 'Immobilier', ...x });
  const projets = (o.projets || []).filter((p) => ctx.lots.some((l) => l.projetId === p.id) || ctx.data.tx.some((t) => t.projetId === p.id));
  if (!projets.length) return ind;
  const cur = ctx.today.slice(0, 7), since = addMonths(cur, -11) + '-01';
  const partOf = o.partOf || (() => 1);
  const toMadV = (t) => (t.devise === 'MAD' ? t.montant : t.montantEur / ctx.P.taux);
  let loy = 0, revC = 0, depC = 0, cout = 0, apports = 0, retraits = 0, debt = 0, treso = 0;
  const lots = ctx.lots.filter((l) => projets.some((p) => p.id === l.projetId));
  for (const p of projets) {
    const w = partOf(p.id);
    for (const t of ctx.data.tx) {
      if (t.projetId !== p.id) continue;
      const v = toMadV(t) * w, sg = t.sens === 'Revenu' ? 1 : -1;
      treso += sg * v;
      if (t.date >= since && t.nature === 'Courant') { if (t.sens === 'Revenu') revC += v; else depC += v; }
      if (t.date >= since && t.categorie === 'Loyer' && t.sens === 'Revenu') loy += v;
      if (t.nature === 'Investissement') cout += -sg * v;
      if (t.categorie === 'Apport en capital' && t.sens === 'Revenu') apports += v;
      if (t.categorie === 'Distribution aux associés' && t.sens === 'Dépense') retraits += v;
      if (t.categorie === 'Prêt reçu') debt += v; else if (t.categorie === 'Remboursement prêt') debt -= v;
    }
  }
  // loyers encaissés sur 3 mois
  let exp = 0, paid = 0;
  for (const l of lots) for (const m of [addMonths(cur, -1), addMonths(cur, -2), addMonths(cur, -3)]) { const c = rentCell(ctx, l.nom, m); exp += c.expected; paid += Math.min(c.paid, c.expected); }
  if (exp > 0) { const r = paid / exp; mk({ id: 'loyers', label: 'Loyers encaissés (3 mois)', value: r, fmt: 'pct', level: r >= 0.97 ? 'good' : r >= 0.85 ? 'warn' : 'bad', text: r >= 0.97 ? 'Tous les loyers des 3 derniers mois sont encaissés.' : `${mad(exp - paid)} de loyers manquants sur 3 mois : relance les locataires concernés.`, advice: 'Utilise « Relancer » (WhatsApp / SMS) dès le 5 du mois.' }); }
  // occupation sur 12 mois (jours-lots)
  const occ = o.occupancy ? o.occupancy(ctx, lots, addMonths(cur, -11), cur) : null;
  if (occ && occ.rate != null) mk({ id: 'occupation', label: 'Taux d’occupation (12 mois)', value: occ.rate, fmt: 'pct', level: occ.rate >= 0.92 ? 'good' : occ.rate >= 0.8 ? 'warn' : 'bad', text: `${occ.vacantDays} jours-lots vacants sur 12 mois (≈ ${mad(occ.vacancyLoss)} de loyers non perçus).`, advice: 'Prépare la remise en location avant le départ du locataire (annonce, visites).' });
  // rendement net
  if (cout > 0) { const net = (revC - depC) / cout; mk({ id: 'rendement', label: 'Rendement net (12 mois)', value: net, fmt: 'pct', level: net >= 0.06 ? 'good' : net >= 0.03 ? 'warn' : 'bad', text: `(revenus − charges) / capital investi = ${(net * 100).toFixed(1).replace('.', ',')} %.`, advice: 'Réduis les charges (agence, entretien) ou relève les loyers sous la moyenne.' }); }
  // cash-flow d'exploitation
  if (revC > 0 || depC > 0) { const cf = revC - depC; mk({ id: 'cashflow', label: 'Cash-flow d’exploitation', value: cf, fmt: 'mad', level: cf > 0 ? 'good' : 'bad', text: cf > 0 ? `${mad(cf)} dégagés sur 12 mois (ma part).` : `Les charges dépassent les revenus de ${mad(-cf)} sur 12 mois.`, advice: 'Analyse les charges par catégorie dans l’écran Immobilier.' }); }
  // récupération du capital
  if (apports > 0 && o.capital) {
    const rec = o.capital;
    const lvl = rec.years === 0 ? 'good' : rec.years == null ? 'bad' : rec.years <= 12 ? 'good' : rec.years <= 20 ? 'warn' : 'bad';
    mk({ id: 'capital', label: 'Capital récupéré', value: rec.pctRecovered, fmt: 'pct', level: lvl, text: rec.years === 0 ? 'Le capital investi est entièrement récupéré.' : rec.years == null ? 'Au rythme actuel, le capital ne sera pas récupéré (cash-flow libre ≤ 0).' : `${(rec.pctRecovered * 100).toFixed(1).replace('.', ',')} % récupéré ; retour complet estimé en ${rec.yearPayback} (dans ${rec.years.toFixed(1).replace('.', ',')} ans).`, advice: 'Chaque point de rendement net gagné raccourcit la date de retour.' });
  }
  if (o.balances && o.balances.associes && o.balances.associes.length > 1 && o.balances.retraits > 0) {
    const due = o.balances.aSolder, tot = o.balances.retraits;
    mk({ id: 'associes', label: 'Équilibre entre associés', value: due, fmt: 'mad', level: due / tot <= 0.02 ? 'good' : due / tot <= 0.1 ? 'warn' : 'bad', text: due / tot <= 0.02 ? 'Les retraits des associés sont proportionnels à leurs parts.' : `${mad(due)} à compenser entre associés pour que les retraits respectent les parts.`, advice: 'Voir « Comptes entre associés » dans l’écran Immobilier.' });
  }
  return ind;
}

function bourseIndicators(ctx, o) {
  const ind = [];
  const pf = o.pf;
  if (!pf || !pf.open.length) return ind;
  const mk = (x) => ind.push({ domain: 'Bourse', ...x });
  const tot = pf.total.value || 1;
  const sectorOf = o.sectorOf || (() => 'Non classé');
  // concentration sur une action
  const singles = pf.open.filter((p) => p.type !== 'ETF' && p.type !== 'Fonds');
  if (singles.length) {
    const top = [...singles].sort((a, b) => (b.value ?? b.cost) - (a.value ?? a.cost))[0], w = (top.value ?? top.cost) / tot;
    mk({ id: 'concentration', label: 'Concentration sur une ligne', value: w, fmt: 'pct', level: w <= 0.2 ? 'good' : w <= 0.4 ? 'warn' : 'bad', text: `${top.nom} pèse ${Math.round(w * 100)} % du portefeuille.`, advice: 'Renforce tes lignes diversifiées (ETF monde) avant d’ajouter à la plus grosse position.' });
  }
  // secteurs
  const sect = new Map();
  for (const p of pf.open) { const k = sectorOf(p); sect.set(k, (sect.get(k) || 0) + (p.value ?? p.cost)); }
  const risky = [...sect.entries()].filter(([k]) => k !== 'ETF / fonds diversifiés' && k !== 'Obligations').sort((a, b) => b[1] - a[1]);
  if (risky.length) { const [k, v] = risky[0], w = v / tot; mk({ id: 'secteurs', label: 'Diversification sectorielle', value: w, fmt: 'pct', level: w <= 0.4 ? 'good' : w <= 0.6 ? 'warn' : 'bad', text: `Le secteur « ${k} » représente ${Math.round(w * 100)} % du portefeuille.`, advice: 'Équilibre avec d’autres secteurs ou un ETF large (MSCI World).' }); }
  // performance
  if (pf.total.roi != null) mk({ id: 'perf', label: 'Performance globale', value: pf.total.roi, fmt: 'pct', level: pf.total.roi >= 0.05 ? 'good' : pf.total.roi >= 0 ? 'warn' : 'bad', text: `ROI cumulé de ${(pf.total.roi * 100).toFixed(1).replace('.', ',')} % (latent + réalisé + dividendes, non annualisé).`, advice: 'Juge la performance sur 5 ans minimum ; compare avec un ETF monde.' });
  // frais
  if (pf.total.invested > 0) { const f = pf.total.fees / pf.total.invested; mk({ id: 'frais', label: 'Frais payés', value: f, fmt: 'pct', level: f <= 0.01 ? 'good' : f <= 0.02 ? 'warn' : 'bad', text: `${eur(pf.total.fees, 2)} de frais pour ${eur(pf.total.invested)} investis (${(f * 100).toFixed(2).replace('.', ',')} %).`, advice: 'Regroupe les achats (moins d’ordres) ou choisis un courtier à frais réduits.' }); }
  // devise
  const nonEur = pf.open.filter((p) => p.devise !== 'EUR').reduce((s, p) => s + (p.value ?? p.cost), 0) / tot;
  mk({ id: 'devise', label: 'Exposition hors euro', value: nonEur, fmt: 'pct', level: nonEur <= 0.5 ? 'good' : nonEur <= 0.75 ? 'warn' : 'bad', text: `${Math.round(nonEur * 100)} % du portefeuille est en devises (USD, GBP…).`, advice: 'Une part hors euro diversifie, mais expose au risque de change.' });
  if (pf.total.missing) mk({ id: 'cours', label: 'Cours indisponibles', value: pf.total.missing, fmt: 'n', level: 'warn', text: `${pf.total.missing} titre(s) valorisé(s) au prix de revient faute de cours.`, advice: 'Saisis un symbole coté pour obtenir le cours en direct.' });
  return ind;
}

export function financialHealth(ctx, o = {}) {
  const scope = o.scope || 'Tout';
  const want = (d) => scope === 'Tout' || scope === d;
  const built = [];
  let monthlyRev = 0, monthlyDep = 0;
  if (want('Perso')) { const r = persoIndicators(ctx); built.push(['Perso', r.ind]); monthlyRev = r.monthlyRev; monthlyDep = r.monthlyDep; }
  if (want('Immobilier')) built.push(['Immobilier', immoIndicators(ctx, o)]);
  if (want('Entreprise')) built.push(['Entreprise', (o.entreprise ? o.entreprise(ctx) : entrepriseHealth(ctx)).map((i) => ({ domain: 'Entreprise', ...i }))]);
  if (want('Bourse')) built.push(['Bourse', bourseIndicators(ctx, o)]);
  const domains = built.filter(([, l]) => l.length).map(([name, list]) => ({ name, indicators: list, score: avgGrade(list), level: healthLevel(avgGrade(list)), label: healthLabel(avgGrade(list)) }));
  const indicators = domains.flatMap((d) => d.indicators);
  const score = domains.length ? Math.round(domains.reduce((s, d) => s + d.score, 0) / domains.length) : null;
  // points perdus par indicateur (sur le score affiché) et actions classées par gain potentiel
  const nd = domains.length || 1;
  for (const d of domains) for (const i of d.indicators) { i.points = GRADE[i.level]; i.gain = Math.round((100 - GRADE[i.level]) / d.indicators.length / nd * 10) / 10; }
  const actions = indicators.filter((i) => i.level !== 'good').sort((a, b) => b.gain - a.gain).map((i) => ({ id: i.id, domain: i.domain, label: i.label, level: i.level, gain: i.gain, advice: i.advice || i.text, text: i.text }));
  return { scope, score, level: healthLevel(score), label: healthLabel(score), indicators, domains, actions, monthlyRev, monthlyDep, explain: { nIndicators: indicators.length, nDomains: domains.length, grades: GRADE, bands: HEALTH_BANDS } };
}

// =====================================================================================
// Bourse : positions, prix de revient (moyenne pondérée, méthode fiscale française), plus-values
// =====================================================================================
// ordres : { date, symbole, sens: Achat|Vente|Dividende, quantite, prix, frais, devise }
// quotes : { SYMBOLE: { prix, devise } } ; fx : (devise) => taux vers EUR
export function portfolio(ordres, quotes = {}, fx = (d) => (d === 'EUR' ? 1 : null)) {
  const pos = new Map();
  const sorted = [...ordres].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.seq || 0) - (b.seq || 0)));
  for (const o of sorted) {
    const k = o.symbole;
    const p = pos.get(k) || { symbole: k, nom: o.nom || k, devise: o.devise || 'EUR', type: o.type || '', compte: o.compte || '', secteur: '', qty: 0, cost: 0, invested: 0, sold: 0, realized: 0, dividends: 0, fees: 0, first: o.date, orders: 0 };
    const q = Number(o.quantite) || 0, px = Number(o.prix) || 0, fee = Number(o.frais) || 0;
    const rate = fx(o.devise || p.devise) || 1;
    p.orders++; p.fees += fee * rate;
    if (o.nom) p.nom = o.nom;
    if (o.secteur) p.secteur = o.secteur;
    if (o.sens === 'Achat') { p.cost += (q * px + fee) * rate; p.qty += q; p.invested += (q * px + fee) * rate; }
    else if (o.sens === 'Vente') {
      const pru = p.qty > 0 ? p.cost / p.qty : 0;
      const sq = Math.min(q, p.qty);
      const proceeds = (sq * px - fee) * rate;
      p.realized += proceeds - pru * sq;
      p.cost -= pru * sq; p.qty -= sq; p.sold += proceeds;
    } else if (o.sens === 'Dividende') p.dividends += (q ? q * px : px) * rate - fee * rate;
    pos.set(k, p);
  }
  const list = [...pos.values()].map((p) => {
    const qt = quotes[p.symbole];
    const rate = qt ? fx(qt.devise || p.devise) : null;
    const price = qt && rate ? qt.prix * rate : null;
    const value = price != null ? p.qty * price : null;
    const pru = p.qty > 1e-9 ? p.cost / p.qty : 0;
    const latent = value != null ? value - p.cost : null;
    const gain = (latent || 0) + p.realized + p.dividends;
    return { ...p, pru, price, priceLocal: qt ? qt.prix : null, change: qt ? qt.variation : null, value, latent, latentPct: latent != null && p.cost > 0 ? latent / p.cost : null,
      gain, roi: p.invested > 0 ? gain / p.invested : null, open: p.qty > 1e-9 };
  }).sort((a, b) => (b.value || b.cost) - (a.value || a.cost));
  const open = list.filter((p) => p.open);
  const tot = {
    value: open.reduce((s, p) => s + (p.value ?? p.cost), 0), cost: open.reduce((s, p) => s + p.cost, 0),
    invested: list.reduce((s, p) => s + p.invested, 0), realized: list.reduce((s, p) => s + p.realized, 0),
    dividends: list.reduce((s, p) => s + p.dividends, 0), fees: list.reduce((s, p) => s + p.fees, 0), missing: open.filter((p) => p.value == null).length,
  };
  tot.latent = tot.value - tot.cost;
  tot.gain = tot.latent + tot.realized + tot.dividends;
  tot.roi = tot.invested > 0 ? tot.gain / tot.invested : null;
  return { positions: list, open, total: tot };
}
// Simulation de vente : plus-value et impôt estimés (PFU 30 % par défaut ; PEA > 5 ans : 17,2 %)
export function simulateSale(position, qty, price, { fee = 0, taxRate = 0.3 } = {}) {
  const q = Math.min(qty, position.qty);
  const proceeds = q * price - fee;
  const costBasis = position.pru * q;
  const gain = proceeds - costBasis;
  const tax = gain > 0 ? gain * taxRate : 0;
  return { qty: q, proceeds, costBasis, gain, gainPct: costBasis > 0 ? gain / costBasis : null, tax, net: proceeds - tax, remaining: position.qty - q };
}
