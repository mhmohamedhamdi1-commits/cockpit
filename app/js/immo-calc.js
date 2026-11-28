// Calculs immobiliers PURS (sans DOM) : associés, retraits et dettes entre associés, capital récupéré et projection,
// taux d'occupation sur une période, analyses et recommandations. Montants en MAD (devise des projets), sauf mention.
import { addMonths, monthEnd, monthStart, monthsBetween, daysBetween, norm, sum } from './util.js';
import { rentCell } from './core.js';

const toMad = (ctx, t) => (t.devise === 'MAD' ? t.montant : t.montantEur / ctx.P.taux);
const firstWord = (s) => norm(String(s || '').replace(/\(.*?\)/g, '').trim()).split(/\s+/)[0] || '';
const display = (s) => String(s || '').replace(/\(.*?\)/g, '').trim() || String(s || '');
const round2 = (v) => Math.round(v * 100) / 100;

export const CAT_APPORT = 'Apport en capital';
export const CAT_RETRAIT = 'Distribution aux associés';

// Transactions d'un projet (100 %)
const txOf = (ctx, projetId) => ctx.data.tx.filter((t) => t.activite === 'Immobilier' && (!projetId || t.projetId === projetId));

// ---------------------------------------------------------------------------------------------
// Associés d'un projet : [{ key, nom, part, mine }]
//   priorité : projet.meta.associes (saisi) > propriétaire + invités (parts) > noms trouvés dans les apports / retraits
// ---------------------------------------------------------------------------------------------
export function associatesOf(ctx, projet, { memberships = [], ownerName = ctx.P.nom, amOwner = true } = {}) {
  const meta = (projet && projet.meta) || {};
  if (Array.isArray(meta.associes) && meta.associes.length) {
    return meta.associes.filter((a) => a && a.nom).map((a) => ({ key: firstWord(a.nom), nom: display(a.nom), part: Number(a.part) || 0, mine: !!a.moi }));
  }
  const names = new Map();   // key -> nom affiché, d'après les opérations
  for (const t of txOf(ctx, projet && projet.id)) {
    if ((t.categorie === CAT_APPORT || t.categorie === CAT_RETRAIT) && t.tiers) { const k = firstWord(t.tiers); if (k && !names.has(k)) names.set(k, display(t.tiers)); }
  }
  const list = [];
  const part = projet ? Number(projet.part) : 1;
  const mem = memberships.filter((m) => projet && m.projet_id === projet.id && Number(m.part) > 0);
  if (amOwner) {
    const ok = firstWord(ownerName);
    list.push({ key: ok || 'moi', nom: display(ownerName) || (names.values().next().value || 'Moi'), part, mine: true });
    for (const m of mem) list.push({ key: firstWord(m.label) || `m${list.length}`, nom: display(m.label) || 'Associé', part: Number(m.part), mine: false });
  } else {
    // projet partagé avec moi : le propriétaire détient `projet.part` ; je détiens la part de mon invitation (rôle « moi »)
    const me = mem.find((m) => m.user_id) || mem[0];
    if (me) list.push({ key: firstWord(me.label) || 'moi', nom: display(me.label) || 'Moi', part: Number(me.part), mine: true });
    const ownerKey = [...names.keys()].find((k) => !list.some((a) => a.key === k));
    list.push({ key: ownerKey || 'proprietaire', nom: ownerKey ? names.get(ownerKey) : 'Propriétaire', part, mine: false });
  }
  // part restante : un associé dont on connaît le nom par les opérations, sinon « Autres associés »
  const rest = round2(1 - sum(list, (a) => a.part));
  if (rest > 0.0005) {
    const k = [...names.keys()].find((x) => !list.some((a) => a.key === x));
    list.push({ key: k || 'autres', nom: k ? names.get(k) : 'Autres associés', part: rest, mine: false });
  }
  // les noms rencontrés dans les opérations mais pas dans la liste (un seul inconnu et une seule place libre) : on complète le nom
  return list;
}

// ---------------------------------------------------------------------------------------------
// Comptes entre associés : apports, retraits, écart par rapport à la part, qui doit quoi, retrait maximum possible
// ---------------------------------------------------------------------------------------------
export function partnerBalances(ctx, projet, opts = {}) {
  const assoc = associatesOf(ctx, projet, opts);
  const txs = txOf(ctx, projet && projet.id);
  const byKey = new Map(assoc.map((a) => [a.key, { ...a, apports: 0, retraits: 0, nbRetraits: 0, last: '' }]));
  let unassigned = 0, nUnassigned = 0;
  let treso = 0;
  for (const t of txs) {
    const v = toMad(ctx, t);
    treso += t.sens === 'Revenu' ? v : -v;
    if (t.categorie === CAT_APPORT && t.sens === 'Revenu') { const a = byKey.get(firstWord(t.tiers)); if (a) a.apports += v; }
    else if (t.categorie === CAT_RETRAIT && t.sens === 'Dépense') {
      const a = byKey.get(firstWord(t.tiers));
      if (a) { a.retraits += v; a.nbRetraits++; if (t.date > a.last) a.last = t.date; } else { unassigned += v; nUnassigned++; }
    }
  }
  const list = [...byKey.values()];
  const W = sum(list, (a) => a.retraits);                       // retraits attribués
  const apports = sum(list, (a) => a.apports);
  for (const a of list) {
    a.droit = a.part * W;                                       // ce qu'il aurait retiré si tous retiraient au prorata des parts
    a.ecart = round2(a.retraits - a.droit);                     // > 0 : a retiré PLUS que sa part (doit de l'argent) ; < 0 : a retiré moins (on lui doit)
    a.partRetraits = W > 0 ? a.retraits / W : 0;
    a.partCapital = apports > 0 ? a.apports / apports : 0;
  }
  // qui doit combien à qui (compensation gloutonne des plus gros écarts)
  const debtors = list.filter((a) => a.ecart > 0.5).map((a) => ({ nom: a.nom, left: a.ecart })).sort((x, y) => y.left - x.left);
  const creditors = list.filter((a) => a.ecart < -0.5).map((a) => ({ nom: a.nom, left: -a.ecart })).sort((x, y) => y.left - x.left);
  const owes = [];
  for (const d of debtors) for (const c of creditors) {
    if (d.left <= 0.5 || c.left <= 0.5) continue;
    const m = Math.min(d.left, c.left);
    owes.push({ from: d.nom, to: c.nom, amount: round2(m)}); d.left -= m; c.left -= m;
  }
  // retrait maximum possible dans le compte bancaire du projet sans déséquilibrer : remplissage par niveau
  // chaque associé i part de r_i / p_i ; on relève tout le monde au même niveau L jusqu'à épuiser la trésorerie B
  const B = Math.max(0, treso);
  const act = list.filter((a) => a.part > 0).map((a) => ({ a, base: a.retraits / a.part, p: a.part })).sort((x, y) => x.base - y.base);
  let level = 0, used = 0;
  if (act.length) {
    let pSum = 0; level = act[0].base;
    for (let i = 0; i < act.length; i++) {
      pSum += act[i].p;
      const next = i + 1 < act.length ? act[i + 1].base : Infinity;
      const need = pSum * (next - level);               // coût pour relever les i+1 premiers jusqu'au niveau suivant
      if (need >= B - used) { level += (B - used) / pSum; used = B; break; }
      used += need; level = next;
    }
  }
  for (const x of act) x.a.maxRetrait = round2(Math.max(0, x.p * (level - x.base)));
  for (const a of list) if (a.maxRetrait == null) a.maxRetrait = 0;
  const settled = round2(sum(list, (a) => Math.max(0, a.ecart)));
  // après compensation des dettes (le débiteur reverse sa part trop retirée dans le compte), le retrait possible est celui de la trésorerie augmentée
  return { associes: list, retraits: round2(W), apports: round2(apports), unassigned: round2(unassigned), nUnassigned, tresorerie: round2(treso), owes, aSolder: settled, balanced: !owes.length };
}

// ---------------------------------------------------------------------------------------------
// Capital récupéré depuis le début et projection du retour sur investissement
//   capital investi = apports des associés ; récupéré = retraits (distributions) ; trésorerie du projet = encore disponible
//   rythme = cash-flow libre des 12 derniers mois complets (courant net − remboursements de prêt), éventuellement indexé
// ---------------------------------------------------------------------------------------------
export function capitalRecovery(ctx, projet, { growth = 0, months = 12 } = {}) {
  const txs = txOf(ctx, projet && projet.id);
  const cur = ctx.today.slice(0, 7);
  let apports = 0, retraits = 0, treso = 0, cout = 0, firstDate = '';
  const monthly = new Map();            // mois -> { retraits, apports, libre }
  const m = (k) => { let e = monthly.get(k); if (!e) { e = { retraits: 0, apports: 0, libre: 0 }; monthly.set(k, e); } return e; };
  for (const t of txs) {
    const v = toMad(ctx, t), k = t.date.slice(0, 7), sg = t.sens === 'Revenu' ? 1 : -1;
    treso += sg * v;
    if (!firstDate || t.date < firstDate) firstDate = t.date;
    if (t.categorie === CAT_APPORT && t.sens === 'Revenu') { apports += v; m(k).apports += v; }
    else if (t.categorie === CAT_RETRAIT && t.sens === 'Dépense') { retraits += v; m(k).retraits += v; }
    if (t.nature === 'Investissement') cout += (t.sens === 'Dépense' ? 1 : -1) * v;
    if (t.nature === 'Courant') m(k).libre += sg * v;
    else if (t.categorie === 'Remboursement prêt') m(k).libre -= v;
  }
  // 12 derniers mois complets
  const from = addMonths(cur, -months), win = monthsBetween(from, addMonths(cur, -1));
  const free12 = sum(win, (k) => (monthly.get(k) || { libre: 0 }).libre);
  const annual = months === 12 ? free12 : (free12 / months) * 12;
  const start = firstDate ? firstDate.slice(0, 7) : cur;
  const remaining = Math.max(0, apports - retraits - Math.max(0, treso));
  const pctRecovered = apports > 0 ? retraits / apports : 0;
  const pctWithCash = apports > 0 ? (retraits + Math.max(0, treso)) / apports : 0;
  // projection
  let years = null, date = null, series = [];
  if (apports > 0) {
    if (remaining <= 0) { years = 0; date = cur; }
    else if (annual > 0) {
      let left = remaining, y = 0, f = annual;
      while (left > 0 && y < 80) { const take = Math.min(left, f); left -= take; y += take / f; f *= 1 + growth; if (left > 0 && f <= 0) break; }
      years = left > 0 ? null : y;
      if (years != null) { const mm = Math.ceil(years * 12); date = addMonths(cur, mm); }
    }
  }
  // courbe : récupéré cumulé par fin d'année, historique puis projection
  const y0 = +start.slice(0, 4), yNow = +cur.slice(0, 4), yEnd = years != null ? +date.slice(0, 4) : yNow + 5;
  let cum = 0; const byYear = new Map();
  for (const [k, e] of monthly) byYear.set(+k.slice(0, 4), (byYear.get(+k.slice(0, 4)) || 0) + e.retraits);
  for (let y = y0; y <= Math.max(yEnd, yNow); y++) {
    if (y <= yNow) { cum += byYear.get(y) || 0; series.push({ year: y, value: cum, projected: false }); }
  }
  if (years != null && annual > 0) {
    let base = Math.max(retraits + Math.max(0, treso), 0), f = annual;   // la trésorerie disponible est comptée comme récupérable
    const lastHist = series[series.length - 1];
    for (let y = yNow + 1; y <= yEnd; y++) { f *= y === yNow + 1 ? 1 : 1 + growth; base += f; series.push({ year: y, value: Math.min(base, apports), projected: true }); }
    if (lastHist) lastHist.cashIncluded = true;
  }
  return { apports: round2(apports), retraits: round2(retraits), tresorerie: round2(treso), coutProjet: round2(cout), remaining: round2(remaining),
    pctRecovered, pctWithCash, annualFree: round2(annual), monthlyFree: round2(annual / 12), years, date, yearPayback: date ? +date.slice(0, 4) : null, start, series, growth };
}

// ---------------------------------------------------------------------------------------------
// Taux d'occupation sur une période (jours-lots occupés / jours-lots disponibles), mois en cours compté jusqu'à aujourd'hui
// ---------------------------------------------------------------------------------------------
export function occupancy(ctx, lots, from, to) {
  const cur = ctx.today.slice(0, 7);
  const last = to > cur ? cur : to;
  if (!lots.length || from > last) return { rate: null, occupiedDays: 0, totalDays: 0, vacantDays: 0, perLot: [], vacancyLoss: 0 };
  const perLot = [];
  for (const l of lots) {
    const tenants = ctx.data.tenants.filter((t) => t.lot === l.nom);
    let occ = 0, tot = 0;
    for (const mo of monthsBetween(from, last)) {
      const a = monthStart(mo), b = mo === cur ? ctx.today : monthEnd(mo);
      const days = daysBetween(a, b) + 1;
      tot += days;
      // jours couverts par au moins un locataire (intervalles fusionnés, bornes incluses)
      const iv = tenants.filter((t) => (!t.entree || t.entree <= b) && (!t.sortie || t.sortie >= a))
        .map((t) => [t.entree && t.entree > a ? t.entree : a, t.sortie && t.sortie < b ? t.sortie : b]).sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
      let cs = null, ce = null;
      for (const [s0, e0] of iv) {
        if (ce == null) { cs = s0; ce = e0; }
        else if (s0 <= ce) { if (e0 > ce) ce = e0; }
        else { occ += daysBetween(cs, ce) + 1; cs = s0; ce = e0; }
      }
      if (ce != null) occ += daysBetween(cs, ce) + 1;
    }
    perLot.push({ lot: l.nom, code: l.code, occupiedDays: occ, totalDays: tot, rate: tot ? occ / tot : 0, loyer: l.loyer || 0 });
  }
  const occupiedDays = sum(perLot, (x) => x.occupiedDays), totalDays = sum(perLot, (x) => x.totalDays);
  const vacancyLoss = sum(perLot, (x) => ((x.totalDays - x.occupiedDays) / 30.4) * x.loyer);
  return { rate: totalDays ? occupiedDays / totalDays : null, occupiedDays, totalDays, vacantDays: totalDays - occupiedDays, perLot, vacancyLoss: round2(vacancyLoss) };
}

// ---------------------------------------------------------------------------------------------
// Analyses et recommandations (rendement, charges, vacance, cautions, loyers, associés, prévision)
// ---------------------------------------------------------------------------------------------
export function projectInsights(ctx, projet, { lots = [], balances = null, recovery = null } = {}) {
  const out = [];
  const cur = ctx.today.slice(0, 7), pid = projet && projet.id;
  const txs = txOf(ctx, pid);
  const since = addMonths(cur, -11) + '-01';
  const win = txs.filter((t) => t.date >= since);
  const sumW = (list, f) => sum(list.filter(f), (t) => toMad(ctx, t));
  const loyers = sumW(win, (t) => t.categorie === 'Loyer' && t.sens === 'Revenu');
  const refact = sumW(win, (t) => t.categorie === 'Charges refacturées' && t.sens === 'Revenu');
  const chargesEx = sumW(win, (t) => t.nature === 'Courant' && t.sens === 'Dépense');
  const revC = sumW(win, (t) => t.nature === 'Courant' && t.sens === 'Revenu');
  const cout = sum(txs.filter((t) => t.nature === 'Investissement'), (t) => (t.sens === 'Dépense' ? 1 : -1) * toMad(ctx, t));
  const valeur = Number(projet && projet.meta && projet.meta.valeur) || 0;
  const pct = (v) => `${(v * 100).toFixed(1).replace('.', ',')} %`;
  const nf = (v) => Math.round(v).toLocaleString('fr-FR').replace(/\s/g, ' ');

  // rendement
  if (cout > 0) {
    const brut = loyers / cout, net = (revC - chargesEx) / cout;
    out.push({ id: 'rendement', kind: net >= 0.06 ? 'good' : net >= 0.03 ? 'warn' : 'bad', title: 'Rendement', value: pct(net),
      text: `Rendement net ${pct(net)} (brut ${pct(brut)}) sur ${nf(cout)} MAD investis (12 derniers mois).${valeur > cout ? ` Sur la valeur estimée (${nf(valeur)} MAD) : ${pct((revC - chargesEx) / valeur)}.` : ''}`,
      advice: net < 0.06 ? 'Pistes : relever les loyers sous la moyenne, réduire la vacance, renégocier les charges (agence, entretien).' : 'Au-dessus de 6 % net : bon niveau pour de l’immobilier locatif.' });
  }
  // plus-value latente si valeur estimée connue
  if (valeur > 0 && cout > 0) out.push({ id: 'plusvalue', kind: valeur >= cout ? 'good' : 'warn', title: 'Valeur estimée', value: `${valeur >= cout ? '+' : '−'}${nf(Math.abs(valeur - cout))} MAD`, text: `Valeur estimée ${nf(valeur)} MAD pour ${nf(cout)} MAD investis : ${valeur >= cout ? 'plus-value' : 'moins-value'} latente de ${pct(Math.abs(valeur / cout - 1))}.`, advice: 'Mets la valeur à jour dans la fiche du projet (au moins une fois par an).' });
  // poids des charges
  if (revC > 0) {
    const r = chargesEx / revC;
    out.push({ id: 'charges', kind: r <= 0.35 ? 'good' : r <= 0.55 ? 'warn' : 'bad', title: 'Poids des charges', value: pct(r), text: `Les charges d’exploitation absorbent ${pct(r)} des revenus (${nf(chargesEx)} MAD sur ${nf(revC)} MAD).`, advice: r > 0.35 ? 'Regarde le détail des charges ci-dessous : agence, entretien, eau & électricité, frais bancaires.' : 'Niveau de charges sain.' });
  }
  // refacturation de l'eau / électricité
  const eau = sumW(win, (t) => t.categorie === 'Eau & électricité' && t.sens === 'Dépense');
  if (eau > 0) {
    const r = refact / eau;
    out.push({ id: 'refact', kind: r >= 0.95 ? 'good' : r >= 0.75 ? 'warn' : 'bad', title: 'Eau & électricité refacturées', value: pct(r), text: `Tu refactures ${nf(refact)} MAD de charges pour ${nf(eau)} MAD d’eau et d’électricité payés (${pct(r)}).`, advice: r < 0.95 ? `Manque à gagner d’environ ${nf(Math.max(0, eau - refact))} MAD par an : ajuste le forfait de charges des locataires.` : 'Les consommations sont bien répercutées.' });
  }
  // vacance
  const occ = occupancy(ctx, lots, addMonths(cur, -11), cur);
  if (occ.rate != null) out.push({ id: 'vacance', kind: occ.rate >= 0.92 ? 'good' : occ.rate >= 0.8 ? 'warn' : 'bad', title: 'Occupation sur 12 mois', value: pct(occ.rate), text: `Occupation de ${pct(occ.rate)} sur 12 mois ; ${occ.vacantDays} jours-lots vacants, soit environ ${nf(occ.vacancyLoss)} MAD de loyers non perçus.`, advice: occ.rate < 0.92 ? 'Anticipe les départs (préavis, annonces) pour limiter les mois vides.' : 'Excellente occupation.' });
  // loyers sous la moyenne
  const actifs = lots.map((l) => ({ l, t: ctx.data.tenants.find((x) => x.lot === l.nom && (!x.sortie || x.sortie >= ctx.today)) })).filter((x) => x.t);
  if (actifs.length > 2) {
    const avg = sum(actifs, (x) => x.t.loyer) / actifs.length;
    const low = actifs.filter((x) => x.t.loyer < avg * 0.9);
    if (low.length) out.push({ id: 'loyers_bas', kind: 'info', title: 'Loyers sous la moyenne', value: `${low.length} lot${low.length > 1 ? 's' : ''}`, text: `${low.map((x) => `${x.l.nom.replace(/^\d+\.\s*/, '')} (${nf(x.t.loyer)} MAD)`).join(', ')} : loyer inférieur de plus de 10 % à la moyenne de l’immeuble (${nf(avg)} MAD).`, advice: 'À la prochaine révision ou au prochain locataire, aligne ces loyers (vérifie le plafond légal de révision de ton contrat).' });
  }
  // cautions détenues
  const cautionRecue = sumW(txs, (t) => t.categorie === 'Caution reçue' && t.sens === 'Revenu'), cautionRendue = sumW(txs, (t) => t.categorie === 'Restitution caution' && t.sens === 'Dépense');
  const detenue = cautionRecue - cautionRendue;
  if (cautionRecue > 0) out.push({ id: 'cautions', kind: 'info', title: 'Cautions à restituer', value: `${nf(Math.max(0, detenue))} MAD`, text: `Cautions reçues ${nf(cautionRecue)} MAD, restituées ${nf(cautionRendue)} MAD : ${nf(Math.max(0, detenue))} MAD appartiennent aux locataires et ne sont pas des revenus.`, advice: 'Garde cette somme disponible : elle doit être restituée aux départs. Retire-la mentalement de la trésorerie distribuable.' });
  // mauvais payeurs
  const late = new Map();
  for (const l of lots) for (let i = 1; i <= 12; i++) {
    const mo = addMonths(cur, -i), c = rentCell(ctx, l.nom, mo);
    if (c.tenant && c.expected > 0) { const e = late.get(c.tenant.nom) || { n: 0, late: 0 }; e.n++; if (c.status === 'late' || c.status === 'part') e.late++; late.set(c.tenant.nom, e); }
  }
  const bad = [...late.entries()].filter(([, e]) => e.n >= 3 && e.late / e.n >= 0.25).sort((a, b) => b[1].late - a[1].late);
  if (bad.length) out.push({ id: 'payeurs', kind: 'warn', title: 'Locataires souvent en retard', value: `${bad.length}`, text: bad.slice(0, 3).map(([n, e]) => `${n} : ${e.late} loyer${e.late > 1 ? 's' : ''} sur ${e.n}`).join(' · '), advice: 'Propose un prélèvement ou un virement permanent, et relance dès le 5 du mois.' });
  // dette
  const dette = sumW(txs, (t) => t.categorie === 'Prêt reçu' && t.sens === 'Revenu') - sumW(txs, (t) => t.categorie === 'Remboursement prêt' && t.sens === 'Dépense');
  if (dette > 1) out.push({ id: 'dette', kind: cout > 0 && dette / cout > 0.5 ? 'warn' : 'info', title: 'Prêts à rembourser', value: `${nf(dette)} MAD`, text: `${nf(dette)} MAD de prêts restent à rembourser${cout > 0 ? ` (${pct(dette / cout)} du capital investi)` : ''}.` });
  // prévision de trésorerie à 6 mois
  const loy = sum(lots, (l) => { const t = ctx.data.tenants.find((x) => x.lot === l.nom && (!x.sortie || x.sortie >= ctx.today)); return t ? t.loyer + (t.charges || 0) : 0; });
  const avgCh = chargesEx / 12;
  if (loy > 0) out.push({ id: 'prevision', kind: loy - avgCh >= 0 ? 'good' : 'bad', title: 'Cash-flow mensuel attendu', value: `${loy - avgCh >= 0 ? '+' : '−'}${nf(Math.abs(loy - avgCh))} MAD`, text: `Loyers + charges attendus ${nf(loy)} MAD/mois − charges moyennes ${nf(avgCh)} MAD/mois ⇒ ${nf(loy - avgCh)} MAD/mois (${nf((loy - avgCh) * 6)} MAD sur 6 mois si tout est payé).` });
  // associés
  if (balances && !balances.balanced && balances.owes.length) {
    const o = balances.owes[0];
    out.push({ id: 'associes', kind: 'warn', title: 'Équilibre entre associés', value: `${nf(o.amount)} MAD`, text: `${o.from} a retiré ${nf(o.amount)} MAD de plus que sa part : à reverser à ${o.to} pour que les retraits soient proportionnels aux parts.`, advice: 'Fais le versement dans le compte du projet (ou compense sur les prochains retraits).' });
  }
  // récupération du capital
  if (recovery && recovery.apports > 0) out.push({ id: 'capital', kind: recovery.pctWithCash >= 1 ? 'good' : 'info', title: 'Capital récupéré', value: pct(recovery.pctRecovered), text: recovery.years == null ? `Capital récupéré : ${pct(recovery.pctRecovered)} (${nf(recovery.retraits)} MAD sur ${nf(recovery.apports)} MAD). Au rythme actuel, le capital ne peut pas être récupéré (cash-flow libre ≤ 0).` : recovery.years === 0 ? 'Le capital investi est entièrement récupéré.' : `Capital récupéré : ${pct(recovery.pctRecovered)}. Au rythme actuel (${nf(recovery.annualFree)} MAD/an), il manque ${nf(recovery.remaining)} MAD : retour complet vers ${recovery.yearPayback} (dans ${recovery.years.toFixed(1).replace('.', ',')} an${recovery.years >= 2 ? 's' : ''}).` });
  return out;
}
