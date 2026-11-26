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

// =====================================================================================
// Trésorerie actuelle : cumul de TOUS les flux (courants, investissements, financements)
// depuis la première opération. Perso + Freelance = compte en France ; chaque projet a la sienne.
// =====================================================================================
export function cashPosition(ctx, { partOf = () => 1, isMine = () => true } = {}) {
  const toMadV = (t) => (t.devise === 'MAD' ? t.montant : t.montantEur / ctx.P.taux);
  const sign = (t) => (t.sens === 'Revenu' ? 1 : -1);
  const perso = { eur: 0, rev: 0, dep: 0, inv: 0, fin: 0, since: '' };
  const projets = new Map();
  for (const t of ctx.data.tx) {
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
  return {
    perso, projets: list,
    totalMineEur: perso.eur + list.reduce((s, p) => s + p.mineEur, 0),
    releve: lastDate ? { date: lastDate, total: releve.reduce((s, x) => s + x.soldeEur, 0), dispo: releve.filter((x) => dispoAcc.has(x.compte)).reduce((s, x) => s + x.soldeEur, 0) } : null,
  };
}

// =====================================================================================
// Santé financière (12 derniers mois glissants) : indicateurs verts / orange / rouges + recommandations
// =====================================================================================
const GRADE = { good: 100, warn: 60, bad: 20 };
export function financialHealth(ctx, { weight = () => 1 } = {}) {
  const cur = ctx.today.slice(0, 7);
  const from12 = addMonths(cur, -12), from3 = addMonths(cur, -3);
  const closed = (t) => { const m = t.date.slice(0, 7); return m >= from12 && m < cur; };   // 12 mois complets
  const v = (t) => t.montantEur * weight(t);
  let rev = 0, dep = 0, inv = 0, dep3 = 0, dep9 = 0;
  const catNow = new Map(), catBefore = new Map(), incomeBy = new Map();
  for (const t of ctx.data.tx) {
    if (!closed(t)) continue;
    const m = t.date.slice(0, 7);
    if (t.nature === 'Courant') {
      if (t.sens === 'Revenu') { rev += v(t); incomeBy.set(t.categorie, (incomeBy.get(t.categorie) || 0) + v(t)); }
      else {
        dep += v(t);
        if (m >= from3) { dep3 += v(t); catNow.set(t.categorie, (catNow.get(t.categorie) || 0) + v(t)); }
        else { dep9 += v(t); catBefore.set(t.categorie, (catBefore.get(t.categorie) || 0) + v(t)); }
      }
    } else if (t.nature === 'Investissement' && t.sens === 'Dépense' && t.activite !== 'Immobilier') inv += v(t);
  }
  const ind = [];
  const monthlyRev = rev / 12, monthlyDep = dep / 12;
  // 1. taux d'épargne
  const rate = rev > 0 ? (rev - dep) / rev : null;
  if (rate != null) ind.push({ id: 'epargne', label: 'Taux d’épargne', value: rate, fmt: 'pct', level: rate >= 0.2 ? 'good' : rate >= 0.1 ? 'warn' : 'bad',
    text: rate >= 0.2 ? `Tu mets de côté ${Math.round(rate * 100)} % de tes revenus : au-dessus de l’objectif de 20 %.` : `Objectif conseillé : 20 % de tes revenus, soit ${eur(monthlyRev * 0.2)} par mois (aujourd’hui ${eur(Math.max(0, monthlyRev - monthlyDep))}).` });
  // 2. épargne de précaution
  const cash = cashPosition(ctx);
  if (cash.releve && monthlyDep > 0) {
    const months = cash.releve.dispo / monthlyDep;
    ind.push({ id: 'precaution', label: 'Épargne de précaution', value: months, fmt: 'mois', level: months >= 6 ? 'good' : months >= 3 ? 'warn' : 'bad',
      text: months >= 6 ? `${months.toFixed(1).replace('.', ',')} mois de dépenses couverts par ton disponible : confortable.` : `${months.toFixed(1).replace('.', ',')} mois couverts. Vise 3 à 6 mois de dépenses (${eur(monthlyDep * 3)} à ${eur(monthlyDep * 6)}) sur un compte disponible.` });
  }
  // 3. tendance des dépenses (3 derniers mois vs 9 précédents)
  if (dep9 > 0) {
    const trend = (dep3 / 3) / (dep9 / 9) - 1;
    const up = [...catNow.entries()].map(([k, x]) => [k, x / 3 - (catBefore.get(k) || 0) / 9]).filter(([, d]) => d > 20).sort((a, b) => b[1] - a[1]).slice(0, 3);
    ind.push({ id: 'tendance', label: 'Tendance des dépenses', value: trend, fmt: 'delta', level: trend <= 0.05 ? 'good' : trend <= 0.2 ? 'warn' : 'bad',
      text: trend <= 0.05 ? 'Tes dépenses des 3 derniers mois sont stables ou en baisse.' : `Dépenses en hausse de ${Math.round(trend * 100)} % sur les 3 derniers mois${up.length ? ` : ${up.map(([k, d]) => `${k} (+${eur(d)}/mois)`).join(', ')}` : ''}.` });
  }
  // 4. dépendance à une source de revenus
  if (rev > 0 && incomeBy.size) {
    const [topK, topV] = [...incomeBy.entries()].sort((a, b) => b[1] - a[1])[0];
    const share = topV / rev;
    ind.push({ id: 'revenus', label: 'Diversification des revenus', value: share, fmt: 'pct', level: share <= 0.6 ? 'good' : share <= 0.85 ? 'warn' : 'bad',
      text: `${Math.round(share * 100)} % de tes revenus viennent de « ${topK} ».${share > 0.85 ? ' Une autre source (loyers, activité) réduirait le risque.' : ''}` });
  }
  // 5. effort d'investissement (hors immobilier, déjà dans les projets)
  if (rev > 0) {
    const ir = inv / rev;
    ind.push({ id: 'invest', label: 'Effort d’investissement', value: ir, fmt: 'pct', level: ir >= 0.1 ? 'good' : ir > 0 ? 'warn' : 'bad',
      text: ir >= 0.1 ? `${Math.round(ir * 100)} % de tes revenus investis sur 12 mois.` : `Investir au moins 10 % de tes revenus (${eur(monthlyRev * 0.1)}/mois) fait travailler ton épargne.` });
  }
  // 6. loyers encaissés (3 derniers mois, mes lots)
  let exp = 0, paid = 0;
  for (const l of ctx.lots) for (const m of [addMonths(cur, -1), addMonths(cur, -2), addMonths(cur, -3)]) { const c = rentCell(ctx, l.nom, m); exp += c.expected; paid += Math.min(c.paid, c.expected); }
  if (exp > 0) { const r = paid / exp; ind.push({ id: 'loyers', label: 'Loyers encaissés (3 mois)', value: r, fmt: 'pct', level: r >= 0.97 ? 'good' : r >= 0.85 ? 'warn' : 'bad', text: r >= 0.97 ? 'Tous les loyers des 3 derniers mois sont encaissés.' : `${mad(exp - paid)} de loyers manquants sur 3 mois : relance les locataires concernés.` }); }
  // 7. factures en retard
  const late = ctx.data.invoices.filter((i) => i.statut === 'Envoyée' && i.emission && daysBetween(i.emission, ctx.today) > 30);
  if (ctx.data.invoices.length) ind.push({ id: 'factures', label: 'Factures en retard', value: late.length, fmt: 'n', level: late.length ? 'bad' : 'good', text: late.length ? `${late.length} facture(s) impayée(s) depuis plus de 30 jours.` : 'Aucune facture en retard de paiement.' });
  const score = ind.length ? Math.round(ind.reduce((s, i) => s + GRADE[i.level], 0) / ind.length) : null;
  return { score, level: score == null ? 'info' : score >= 75 ? 'good' : score >= 50 ? 'warn' : 'bad', label: score == null ? '—' : score >= 85 ? 'Excellente' : score >= 75 ? 'Bonne' : score >= 50 ? 'À surveiller' : 'Fragile', indicators: ind, monthlyRev, monthlyDep };
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
    const p = pos.get(k) || { symbole: k, nom: o.nom || k, devise: o.devise || 'EUR', type: o.type || '', compte: o.compte || '', qty: 0, cost: 0, invested: 0, sold: 0, realized: 0, dividends: 0, fees: 0, first: o.date, orders: 0 };
    const q = Number(o.quantite) || 0, px = Number(o.prix) || 0, fee = Number(o.frais) || 0;
    const rate = fx(o.devise || p.devise) || 1;
    p.orders++; p.fees += fee * rate;
    if (o.nom) p.nom = o.nom;
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
