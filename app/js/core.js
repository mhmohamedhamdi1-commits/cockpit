// Calculs purs (sans DOM, sans état global) : partagés par l'application et par la fonction
// serveur de notifications. ctx = { data, today, P, catMap, lots, immoView }.
import { addMonths, monthEnd, monthStart, monthLong, monthLabel, daysBetween, fmtDate, mad, eur } from './util.js';

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

// ---------- Freelance ----------
export function microFactor(ctx, year) {
  const start = ctx.P.microDebut || '2027-01-01';
  if (String(year) !== start.slice(0, 4)) return 1;
  const d0 = new Date(start + 'T00:00:00'), d1 = new Date(`${year}-12-31T00:00:00`);
  const days = Math.round((d1 - d0) / 864e5) + 1;
  return Math.min(1, days / 365);
}
export function freelanceYear(ctx, year) {
  const micro = new Set(ctx.data.clients.filter((c) => c.micro === 'Oui').map((c) => c.nom));
  const from = (ctx.P.microDebut || '2027-01-01').slice(0, 7);
  const ht = (i) => (i.devise === 'MAD' ? i.ht * ctx.P.taux : i.ht);
  const yr = (d, fb) => (d || fb || '').slice(0, 4);
  let paid = 0, billed = 0, planned = 0;
  for (const i of ctx.data.invoices) {
    if (!micro.has(i.client) || i.periode < from) continue;
    if (i.statut === 'Payée' && yr(i.paiement, i.emission || i.periode + '-01') === year) paid += ht(i);
    else if (i.statut === 'Envoyée' && yr(i.emission, i.periode + '-01') === year) billed += ht(i);
    else if (i.statut === 'Planifiée' && i.periode.slice(0, 4) === year) planned += ht(i);
  }
  const f = microFactor(ctx, year);
  return { paid, billed, planned, total: paid + billed + planned, factor: f, micro: ctx.P.seuilMicro * f, tva: ctx.P.seuilTva * f, tvaMaj: ctx.P.seuilTvaMaj * f };
}
export function microYear(ctx) { return Math.max(+ctx.today.slice(0, 4), +(ctx.P.microDebut || '2027').slice(0, 4)); }

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
  if (toSend.length) out.push({ id: 'factures_envoyer', kind: 'warn', ic: 'send', title: `${toSend.length} facture${toSend.length > 1 ? 's' : ''} à envoyer`, sub: toSend.slice(0, 3).map((i) => `${i.client.split(' ')[0]} ${monthLabel(i.periode)}`).join(' · '), go: '#/freelance', label: 'Voir' });
  const unpaid = d.invoices.filter((i) => i.statut === 'Envoyée' && i.emission && daysBetween(i.emission, ctx.today) > 30);
  if (unpaid.length) out.push({ id: 'factures_retard', kind: 'bad', ic: 'alert', title: `${unpaid.length} facture${unpaid.length > 1 ? 's' : ''} impayée${unpaid.length > 1 ? 's' : ''} depuis +30 j`, sub: unpaid.slice(0, 3).map((i) => `${i.numero} · ${i.client.split(' ')[0]}`).join(' · '), go: '#/freelance', label: 'Relancer' });
  const y = String(microYear(ctx)), fy = freelanceYear(ctx, y), done = fy.paid + fy.billed;
  if (done >= fy.tvaMaj) out.push({ id: 'seuil_tva_maj', kind: 'bad', ic: 'alert', title: 'Seuil majoré de TVA dépassé', sub: `${eur(done)} de CA ${y} : la TVA est due dès maintenant (seuil ${eur(fy.tvaMaj)})`, go: '#/freelance', label: 'Voir' });
  else if (done >= fy.tva) out.push({ id: 'seuil_tva', kind: 'warn', ic: 'alert', title: 'Franchise de TVA dépassée', sub: `${eur(done)} de CA ${y} (seuil ${eur(fy.tva)}) : TVA due au 1er janvier`, go: '#/freelance', label: 'Voir' });
  else if (fy.total > fy.micro) out.push({ id: 'seuil_micro', kind: 'info', ic: 'info', title: `Plafond micro ${y} dépassé en projection`, sub: `${eur(fy.total)} planifiés vs ${eur(fy.micro)} de plafond`, go: '#/freelance', label: 'Détails' });
  for (const m of [cur, ...(+ctx.today.slice(8, 10) >= 25 ? [addMonths(cur, 1)] : [])]) {
    const miss = missingRecurring(ctx, m);
    if (miss.length) out.push({ id: 'recurrents:' + m, kind: 'info', ic: 'repeat', title: `${miss.length} opération${miss.length > 1 ? 's' : ''} récurrente${miss.length > 1 ? 's' : ''} à générer`, sub: `pour ${monthLong(m)}`, action: { key: 'generate_recurring', month: m }, label: 'Générer' });
  }
  for (const u of upcomingRappels(ctx, 15)) {
    out.push({ id: 'rappel:' + u.r.id, kind: u.inDays <= 3 ? 'warn' : 'info', ic: 'calendar', title: u.r.titre, sub: u.inDays === 0 ? 'aujourd’hui' : `le ${fmtDate(u.date)} (dans ${u.inDays} j)`, go: '#/recurring', label: 'Voir' });
  }
  const last = d.snapshots.reduce((m, s) => (s.date > m ? s.date : m), '');
  if (!last || daysBetween(last, ctx.today) > 35) out.push({ id: 'releve', kind: 'info', ic: 'bank', title: 'Mets à jour tes soldes', sub: last ? `Dernier relevé : ${fmtDate(last)}` : 'Aucun relevé enregistré', go: '#/wealth', label: 'Relevé' });
  return out;
}
