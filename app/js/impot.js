// Moteur de calcul de l'impôt sur le revenu (France) — PUR : aucun DOM, aucune constante fiscale en dur.
// Tous les seuils / taux viennent du barème de l'année (impot-data.js ou table commune `bareme_fiscal`, voir resolveBareme).
// Résultat INDICATIF : estimation à confronter au simulateur officiel (impots.gouv.fr) avant toute décision.
import { BAREMES, indexBareme } from './impot-data.js';

export const DEFAULT_INDEXATION = 0.02;   // indexation annuelle supposée tant que le barème officiel d'une année n'est pas publié
const r2 = (v) => Math.round(v * 100) / 100;
const r0 = (v) => Math.round(v);
const num = (v) => { const n = Number(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return isFinite(n) ? n : 0; };
const pos = (v) => Math.max(0, num(v));
const MICRO_LABEL = { microBnc: 'micro-BNC', microBicServices: 'micro-BIC services', microBicVente: 'micro-BIC vente' };
const clone = (o) => JSON.parse(JSON.stringify(o));
function deepMerge(a, b) {
  if (b == null || typeof b !== 'object' || Array.isArray(b)) return b === undefined ? a : b;
  const out = { ...(a && typeof a === 'object' && !Array.isArray(a) ? a : {}) };
  for (const k of Object.keys(b)) out[k] = deepMerge(out[k], b[k]);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Barème d'une année : 1) ligne de la table commune `bareme_fiscal` (prioritaire, fusionnée avec le barème embarqué si partielle)
//                      2) barème embarqué  3) projection automatique par indexation de la dernière année connue (statut « estime »)
// `table` = lignes { annee, data, statut, source } de la table bareme_fiscal ; `indexation` = taux annuel de projection.
// ---------------------------------------------------------------------------------------------
export function resolveBareme(annee, { table = [], indexation = DEFAULT_INDEXATION } = {}) {
  annee = Math.round(num(annee));
  const rows = (table || []).filter((r) => r && r.data && typeof r.data === 'object');
  const known = new Map(Object.entries(BAREMES).map(([y, b]) => [Number(y), b]));
  for (const r of rows) if (Array.isArray(r.data.tranches)) known.set(Number(r.annee), { ...clone(r.data), annee: Number(r.annee), statut: r.statut || 'officiel', source: r.source || 'table bareme_fiscal' });
  const years = [...known.keys()].sort((a, b) => a - b);
  const apply = (base) => {
    const row = rows.find((r) => Number(r.annee) === base.annee);
    if (!row) return base;
    const merged = deepMerge(base, clone(row.data));
    merged.annee = base.annee; merged.statut = row.statut || base.statut; merged.source = row.source || base.source;
    return merged;
  };
  if (known.has(annee)) return apply(clone(known.get(annee)));
  if (annee < years[0]) {
    const b = clone(known.get(years[0]));
    return { ...b, annee, statut: 'estime', source: `Barème ${years[0]} utilisé faute de données pour ${annee} (année trop ancienne)` };
  }
  let prev = clone(known.get(years[years.length - 1]));
  for (let y = prev.annee + 1; y <= annee; y++) {
    const next = apply({ ...clone(indexBareme(prev, y, indexation)) });
    prev = known.has(y) ? clone(known.get(y)) : next;
  }
  return apply(prev);
}

// ---------------------------------------------------------------------------------------------
// Nombre de parts
// ---------------------------------------------------------------------------------------------
export function computeParts(input) {
  const couple = input.situation === 'marie';
  const base = couple ? 2 : 1;
  const full = Math.round(pos(input.enfantsCharge)) + Math.round(pos(input.enfantsMajeursRattaches));
  const alt = Math.round(pos(input.enfantsAlternee));
  let enfants = 0;
  const detail = [];
  let rank = 0;
  for (let i = 0; i < full; i++) { rank++; enfants += rank <= 2 ? 0.5 : 1; }
  for (let i = 0; i < alt; i++) { rank++; enfants += rank <= 2 ? 0.25 : 0.5; }
  if (full + alt) detail.push(`${full + alt} enfant${full + alt > 1 ? 's' : ''} à charge (${full} en résidence principale${alt ? `, ${alt} en garde alternée` : ''}) : +${enfants} part${enfants > 1 ? 's' : ''}`);
  // parent isolé (case T) : divorcé/séparé/célibataire/veuf vivant seul avec au moins un enfant à charge ; un veuf avec enfant en bénéficie d'office
  let isole = 0;
  const seul = !couple;
  const veufAvecEnfant = input.situation === 'veuf' && full + alt > 0;
  if (seul && (input.parentIsole || veufAvecEnfant) && full + alt > 0) { isole = full > 0 ? 0.5 : 0.25; detail.push(`parent isolé : +${isole} part`); }
  let caseL = 0;
  if (seul && !isole && input.elevéSeul5ans && full + alt === 0) { caseL = 0.5; detail.push('a élevé seul un enfant pendant 5 ans (case L) : +0,5 part'); }
  const extra = Math.max(0, num(input.demiPartsExtra));
  if (extra) detail.push(`demi-parts supplémentaires déclarées (invalidité, ancien combattant…) : +${extra}`);
  const total = base + enfants + isole + caseL + extra;
  return { total, base, enfants, isole, caseL, extra, couple, detail };
}

// Impôt « brut » par parts (barème progressif par tranches)
export function taxPerPart(q, tranches) {
  let tax = 0, prev = 0;
  for (const t of tranches) {
    const top = t.jusqua == null ? Infinity : t.jusqua;
    if (q > prev) tax += (Math.min(q, top) - prev) * t.taux;
    if (q <= top) break;
    prev = top;
  }
  return tax;
}
function marginalRate(q, tranches) {
  for (const t of tranches) if (t.jusqua == null || q <= t.jusqua) return t.taux;
  return tranches[tranches.length - 1].taux;
}

// IR sur une base imposable : quotient familial, plafonnement de l'avantage, avant décote
function irOnBase(base, P, B) {
  if (base <= 0) return { tax: 0, taxN: 0, taxBase: 0, avantage: 0, plafond: 0, plafonne: false };
  const taxN = P.total * taxPerPart(base / P.total, B.tranches);
  const taxBase = P.base * taxPerPart(base / P.base, B.tranches);
  const avantage = taxBase - taxN;
  const half = (x) => x / 0.5;
  const plafond = half(Math.max(0, P.total - P.base - P.isole - P.caseL)) * B.qf.demiPart
    + (P.isole ? B.qf.parentIsole * (P.isole / 0.5) : 0) + (P.caseL ? B.qf.demiPartIsole : 0);
  const plafonne = avantage > plafond + 1e-9;
  return { tax: plafonne ? taxBase - plafond : taxN, taxN, taxBase, avantage, plafond, plafonne };
}

// ---------------------------------------------------------------------------------------------
// Calcul complet
// ---------------------------------------------------------------------------------------------
// input : voir FIELDS / inputFromFlat ; entreprises : tableau d'objets « fiscalIncome » (contrat docs/07_Contrats_modules.md)
export function computeTax(input, B) {
  const warnings = [], steps = [];
  const step = (label, value, kind = 'plus', note = '', unit = 'eur') => steps.push({ label, value: r2(value), kind, note, unit });
  const P = computeParts(input);
  const ents = Array.isArray(input.entreprises) ? input.entreprises : [];
  const estimated = B.statut === 'estime' || ents.some((e) => e && e.estimated);
  if (B.statut === 'estime') warnings.push(`Barème ${B.annee} estimé (${B.source}).`);

  // --- Revenus d'activité : salaires (abattement 10 % ou frais réels, par déclarant)
  const salDir = ents.reduce((s, e) => s + pos(e.salaireNetImposable), 0);
  const nets = [pos(input.salaire1) + salDir, pos(input.salaire2)];
  const reels = [pos(input.fraisReels1), pos(input.fraisReels2)];
  let salNet = 0, salAbatt = 0;
  nets.forEach((n, i) => {
    if (!n) return;
    const ab = reels[i] > 0 ? Math.min(n, reels[i]) : Math.min(n, Math.max(B.abattement10.min, Math.min(B.abattement10.max, n * 0.10)));
    salNet += n; salAbatt += ab;
  });
  const salImp = salNet - salAbatt;
  // --- Pensions / retraites : 10 % (minimum par pensionné, plafond par foyer)
  const pens = [pos(input.pensions1), pos(input.pensions2)].filter((x) => x > 0);
  let pensAb = 0;
  for (const p of pens) pensAb += Math.min(p, Math.max(B.abattementPensions.min, p * 0.10));
  pensAb = Math.min(pensAb, B.abattementPensions.max * (pens.length ? 1 : 0));
  const pensNet = pens.reduce((a, b) => a + b, 0), pensImp = pensNet - pensAb;
  // --- BNC / BIC
  const microDefs = [['microBnc', 'bnc'], ['microBicServices', 'bicServices'], ['microBicVente', 'bicVente']];
  let benefBareme = 0, vlBase = 0, microDetail = [];
  const vlManuel = !!input.versementLiberatoire;
  for (const [k, def] of microDefs) {
    const ca = pos(input[k]); if (!ca) continue;
    const m = B.micro[def];
    const ab = Math.min(ca, Math.max(m.min, ca * m.taux));
    microDetail.push(`${MICRO_LABEL[k]} : CA ${r0(ca)} − abattement ${r0(ab)} (${Math.round(m.taux * 100)} %, min ${m.min})`);
    if (vlManuel) vlBase += ca - ab; else benefBareme += ca - ab;
  }
  benefBareme += num(input.bncReel) + num(input.bicReel);
  let cotisTns = pos(input.cotisationsTns);
  let divEnt = 0;
  for (const e of ents) {
    if (!e) continue;
    const b = num(e.bnc) + num(e.bic);
    if (e.versementLiberatoire) vlBase += b; else benefBareme += b;
    cotisTns += pos(e.cotisationsDeductibles);
    divEnt += pos(e.dividendesBruts);
    for (const n of e.notes || []) if (n) warnings.push(`${e.nom || 'Entreprise'} : ${n}`);
  }
  // --- Revenus fonciers France
  let fonFr = 0, fonFrPS = 0, fonFrNote = '';
  const loyers = pos(input.foncierFranceLoyers), charges = pos(input.foncierFranceCharges);
  if (loyers || charges) {
    if (input.foncierFranceMode === 'reel') {
      const res = loyers - charges;
      fonFr = res >= 0 ? res : -Math.min(-res, B.deficitFoncierMax);
      fonFrPS = Math.max(0, res);
      if (res < -B.deficitFoncierMax) warnings.push(`Déficit foncier : seuls ${B.deficitFoncierMax} € s'imputent sur le revenu global, le reste se reporte sur 10 ans.`);
      fonFrNote = `réel : ${r0(loyers)} − ${r0(charges)}`;
    } else {
      if (loyers > B.micro.foncier.seuil) warnings.push(`Micro-foncier impossible au-delà de ${B.micro.foncier.seuil} € de loyers : passe au régime réel.`);
      fonFr = loyers * (1 - B.micro.foncier.taux); fonFrPS = fonFr;
      fonFrNote = `micro-foncier : ${r0(loyers)} − ${Math.round(B.micro.foncier.taux * 100)} %`;
    }
  }
  // --- Revenus fonciers de source étrangère (ex. Maroc)
  const etrNet = num(input.foncierEtrangerNet);
  const etrOpt = input.foncierEtrangerOption || 'taux_effectif';
  const etrTaux = etrNet > 0 && etrOpt === 'taux_effectif';
  const etrBase = etrNet > 0 && etrOpt === 'credit_impot' ? etrNet : 0;     // imposé en France avec crédit d'impôt
  if (etrNet > 0 && etrOpt === 'ignorer') warnings.push('Revenus étrangers ignorés dans le calcul : ils doivent pourtant être déclarés (2042, éventuellement 2047).');
  if (etrNet > 0 && etrOpt === 'taux_effectif') warnings.push('Revenus fonciers marocains : exonérés en France (convention du 29/05/1970, art. 9 et 25) mais retenus pour fixer le taux (méthode du taux effectif). Fais valider la case/le formulaire (2042-C, 2047) avec l\'administration ou un conseiller.');
  if (etrNet > 0 && etrOpt === 'credit_impot') warnings.push('Option « crédit d\'impôt » : le revenu étranger est imposé en France et l\'impôt payé au Maroc est imputé dans la limite de l\'impôt français correspondant. Vérifie que cette méthode s\'applique à ton cas.');

  // --- Capital
  const divManuel = pos(input.dividendes), dividendes = divManuel + divEnt, interets = pos(input.interets);
  const pvBrute = pos(input.plusValues), mv = pos(input.moinsValuesReportables);
  const pvNette = Math.max(0, pvBrute - mv), mvRestantes = Math.max(0, mv - pvBrute);
  const capitalBrut = dividendes + interets + pvNette;
  const psCapital = dividendes * B.ps.dividendes + interets * B.ps.interets + pvNette * B.ps.plusValues;
  const psFoncier = fonFrPS * B.ps.fonciers;

  // --- Déductions du revenu global
  const nbMaj = Math.round(pos(input.nbEnfantsMajeursPension)) || (pos(input.pensionEnfantMajeur) > 0 ? 1 : 0);
  const pensMaj = Math.min(pos(input.pensionEnfantMajeur), B.pensionAlimentaire.enfantMajeur * Math.max(1, nbMaj));
  if (pos(input.pensionEnfantMajeur) > pensMaj) warnings.push(`Pension à un enfant majeur plafonnée à ${B.pensionAlimentaire.enfantMajeur} € par enfant.`);
  const pensAsc = pos(input.pensionAscendants);
  const heb = Math.round(pos(input.hebergementAscendants)) * B.pensionAlimentaire.forfaitHebergement;
  const pensionsTot = pensMaj + pensAsc + heb;
  const revActivite = Math.max(0, salImp + pensImp + Math.max(0, benefBareme));
  const perPlafondCalc = Math.max(B.per.plancherPct * B.per.pass, Math.min(B.per.plafondPct * (salImp + Math.max(0, benefBareme)), B.per.maxPass * B.per.pass));
  const perPlafond = pos(input.perPlafond) > 0 ? pos(input.perPlafond) : perPlafondCalc;
  const per = Math.min(pos(input.perVersements), perPlafond);
  if (pos(input.perVersements) > perPlafond) warnings.push(`Versements PER au-delà de ton plafond de déduction (${r0(perPlafond)} €) : l'excédent n'est pas déduit.`);
  const autresDed = pos(input.autresDeductions), csgDed = pos(input.csgDeductible);
  const deductions = pensionsTot + per + cotisTns + autresDed;
  if (pensAsc > 0) {
    warnings.push(`Pension versée à un ascendant : déductible sans plafond légal si elle répond à un besoin réel et reste proportionnée à tes ressources (justificatifs : virements, ressources du parent).${pensAsc > 0.5 * (revActivite + 1) ? ' Montant élevé par rapport à tes revenus : prépare des justificatifs solides.' : ''}`);
  }

  // --- Deux scénarios pour le capital : PFU (12,8 % + PS) ou barème (abattement 40 % sur dividendes)
  const reductionsInput = {
    dons66: pos(input.dons66), dons75: pos(input.dons75),
    emploi: pos(input.emploiDomicile), garde: pos(input.gardeEnfants), nbGarde: Math.max(1, Math.round(pos(input.nbEnfantsGarde) || 1)),
    autresRed: pos(input.autresReductions), autresCred: pos(input.autresCredits),
  };
  const nbEnfantsTous = Math.round(pos(input.enfantsCharge) + pos(input.enfantsAlternee) + pos(input.enfantsMajeursRattaches));
  const scenario = (bareme) => {
    const capBar = bareme ? dividendes * (1 - B.dividendes.abattement) + interets + pvNette : 0;
    const csgOk = bareme ? Math.min(csgDed, capBar) : 0;
    const revGlobal = salImp + pensImp + benefBareme + fonFr + etrBase + capBar;
    const rngAvantDed = revGlobal;
    const rni = Math.max(0, revGlobal - deductions - csgOk);
    // taux effectif : le calcul se fait sur la base élargie des revenus exonérés, puis proratisé
    const baseCalc = etrTaux ? rni + etrNet : rni;
    const o = irOnBase(baseCalc, P, B);
    let brut = o.tax;
    if (etrTaux && baseCalc > 0) brut = brut * (rni / baseCalc);
    const seuil = P.couple ? B.decote.seuilCouple : B.decote.seuilSeul, baseD = P.couple ? B.decote.baseCouple : B.decote.baseSeul;
    const decote = brut > 0 && brut < seuil ? Math.min(brut, Math.max(0, baseD - B.decote.taux * brut)) : 0;
    const apresDecote = Math.max(0, brut - decote);
    // crédit d'impôt étranger (option) : limité à l'impôt français afférent au revenu étranger
    let creditEtr = 0;
    if (etrBase > 0 && rni > 0) creditEtr = Math.min(pos(input.foncierEtrangerImpot), apresDecote * (etrBase / rni));
    // réductions (non remboursables) : dons, autres
    const dr = B.reductions.dons;
    const donsTot = Math.min(reductionsInput.dons66 + reductionsInput.dons75, dr.plafondPctRevenu * rni);
    const aide = Math.min(reductionsInput.dons75, dr.plafondAide, donsTot);
    const redDons = aide * dr.tauxAide + (donsTot - aide) * dr.taux;
    const redTotal = redDons + reductionsInput.autresRed;
    const redUtilisee = Math.min(redTotal, Math.max(0, apresDecote - creditEtr));
    // crédits d'impôt (remboursables)
    const ed = B.reductions.emploiDomicile;
    const plafEmp = Math.min(ed.plafondMax, ed.plafond + ed.majParEnfant * nbEnfantsTous);
    const credEmp = ed.taux * Math.min(reductionsInput.emploi, plafEmp);
    const credGarde = B.reductions.gardeEnfants.taux * Math.min(reductionsInput.garde, B.reductions.gardeEnfants.plafondParEnfant * reductionsInput.nbGarde);
    const credits = credEmp + credGarde + reductionsInput.autresCred;
    const irNet = apresDecote - creditEtr - redUtilisee - credits;
    const pfuIR = bareme ? 0 : capitalBrut * B.pfu.ir;
    return { bareme, capBar, csgOk, revGlobal: rngAvantDed, rni, baseCalc, o, brut, decote, apresDecote, creditEtr, redDons, redTotal, redUtilisee, credEmp, credGarde, credits, irNet, pfuIR, total: irNet + pfuIR };
  };
  const sPfu = scenario(false), sBar = scenario(true);
  let choix = input.optionCapital === 'pfu' ? 'pfu' : input.optionCapital === 'bareme' ? 'bareme' : (capitalBrut > 0 && sBar.total < sPfu.total - 0.005 ? 'bareme' : 'pfu');
  if (capitalBrut === 0) choix = 'pfu';
  const S = choix === 'bareme' ? sBar : sPfu;

  // --- CEHR (sur le revenu fiscal de référence, approché)
  const rfr = S.rni + (choix === 'pfu' ? capitalBrut : dividendes * B.dividendes.abattement) + (etrTaux ? etrNet : 0) + vlBase;   // approximation du revenu fiscal de référence
  const grille = P.couple ? B.cehr.couple : B.cehr.seul;
  let cehr = 0;
  grille.forEach((t, i) => { const next = grille[i + 1] ? grille[i + 1].de : Infinity; if (rfr > t.de) cehr += (Math.min(rfr, next) - t.de) * t.taux; });
  if (rfr > grille[0].de) warnings.push('Revenu fiscal de référence au-dessus du seuil de la CEHR ; la contribution différentielle (CDHR, impôt minimum de 20 %) n\'est pas calculée ici.');

  // --- Totaux
  const ps = psCapital + psFoncier;
  const irTotal = S.irNet + S.pfuIR;
  const total = irTotal + cehr + ps;
  const dejaPAS = pos(input.pasPreleve), dejaCap = pos(input.capitalDejaPreleve);
  const solde = total - dejaPAS - dejaCap;
  const tmi = marginalRate((etrTaux ? S.baseCalc : S.rni) / P.total, B.tranches);
  const tauxMoyen = S.rni > 0 ? irTotal / S.rni : 0;

  // --- Détail pas à pas
  if (salNet) step(`Salaires nets imposables${salDir ? ' (dont rémunération de dirigeant)' : ''}`, salNet, 'plus', 'cumul annuel « net imposable » de la fiche de paie de décembre');
  if (salAbatt) step(reels[0] > 0 || reels[1] > 0 ? 'Frais réels' : `Abattement forfaitaire de 10 % (min ${B.abattement10.min} €, max ${B.abattement10.max} €)`, -salAbatt, 'minus');
  if (pensNet) { step('Pensions / retraites', pensNet); step('Abattement de 10 % pensions', -pensAb, 'minus'); }
  if (benefBareme) step('Bénéfices BNC / BIC imposés au barème', benefBareme, 'plus', microDetail.join(' ; '));
  if (fonFr) step('Revenus fonciers France (net)', fonFr, 'plus', fonFrNote);
  if (etrBase) step('Revenus fonciers étrangers (imposés en France)', etrBase);
  if (choix === 'bareme' && S.capBar) step('Revenus de capitaux imposés au barème (dividendes après abattement 40 %, intérêts, plus-values)', S.capBar);
  if (S.revGlobal) step('Revenu brut global', S.revGlobal, 'total');
  if (pensMaj) step('Pension alimentaire enfant(s) majeur(s)', -pensMaj, 'minus');
  if (pensAsc) step('Pension alimentaire versée à un ascendant (parent)', -pensAsc, 'minus', 'sans plafond légal, sur justificatifs');
  if (heb) step('Forfait hébergement d\'un ascendant', -heb, 'minus');
  if (per) step('Versements PER déductibles', -per, 'minus', `plafond ${r0(perPlafond)} €`);
  if (cotisTns) step('Cotisations sociales déductibles (non salarié)', -cotisTns, 'minus');
  if (autresDed) step('Autres charges déductibles', -autresDed, 'minus');
  if (S.csgOk) step('CSG déductible sur revenus du capital', -S.csgOk, 'minus');
  step('Revenu net imposable', S.rni, 'total');
  step('Nombre de parts', P.total, 'info', P.detail.join(' · ') || (P.couple ? 'couple marié / pacsé' : 'personne seule'), 'parts');
  if (etrTaux) step('Base élargie aux revenus exonérés (taux effectif)', S.baseCalc, 'info', `revenus étrangers retenus pour le taux : ${r0(etrNet)} €`);
  step(`Impôt avec ${P.total} part${P.total > 1 ? 's' : ''}`, S.o.taxN, 'info', 'barème progressif appliqué au quotient familial puis multiplié par le nombre de parts');
  if (S.o.plafonne) step('Plafonnement du quotient familial', S.o.tax - S.o.taxN, 'plus', `avantage ${r0(S.o.avantage)} € > plafond ${r0(S.o.plafond)} € → impôt calculé avec ${P.base} parts moins le plafond`);
  if (etrTaux) step('Proratisation (revenu imposable ÷ base élargie)', S.brut - S.o.tax, 'info');
  step('Impôt brut', S.brut, 'total');
  if (S.decote) step('Décote', -S.decote, 'minus', 'allègement des petits impôts');
  if (S.creditEtr) step('Crédit d\'impôt étranger', -S.creditEtr, 'minus');
  if (S.redUtilisee) step('Réductions d\'impôt (dons…)', -S.redUtilisee, 'minus');
  if (S.credits) step('Crédits d\'impôt (emploi à domicile, garde d\'enfants…)', -S.credits, 'minus', 'remboursables');
  step('Impôt sur le revenu (barème)', S.irNet, 'total');
  if (S.pfuIR) step(`Prélèvement forfaitaire unique (${(B.pfu.ir * 100).toFixed(1).replace('.', ',')} %) sur ${r0(capitalBrut)} € de capitaux`, S.pfuIR);
  if (cehr) step('Contribution exceptionnelle sur les hauts revenus', cehr);
  if (ps) step('Prélèvements sociaux (capital et revenus fonciers)', ps, 'plus', `dividendes ${(B.ps.dividendes * 100).toFixed(1)} %, plus-values ${(B.ps.plusValues * 100).toFixed(1)} %, fonciers ${(B.ps.fonciers * 100).toFixed(1)} %`);
  step('Total des impôts de l\'année', total, 'total');
  if (dejaPAS) step('Prélèvement à la source déjà versé', -dejaPAS, 'minus');
  if (dejaCap) step('Prélèvements déjà opérés sur le capital', -dejaCap, 'minus');
  step(solde >= 0 ? 'Reste à payer' : 'À restituer', Math.abs(solde), 'total');
  if (vlBase) warnings.push('Versement libératoire : ces revenus d\'activité sont imposés par le versement déjà acquitté (pas au barème) mais comptent dans le revenu fiscal de référence.');
  if (mvRestantes) warnings.push(`Moins-values restantes à reporter sur 10 ans : ${r0(mvRestantes)} €.`);
  if (capitalBrut > 0) warnings.push(`Capitaux mobiliers : ${choix === 'pfu' ? 'PFU' : 'barème progressif'} retenu${input.optionCapital && input.optionCapital !== 'auto' ? ' (choix imposé)' : ' (le plus favorable)'} — écart ${r0(Math.abs(sBar.total - sPfu.total))} €.`);
  if (S.redTotal > 10000) warnings.push('Plafonnement global des niches fiscales (10 000 €) non appliqué dans cette estimation.');

  return {
    annee: B.annee, statut: B.statut, source: B.source, estimated, parts: P,
    revenus: { salaires: { net: salNet, abattement: salAbatt, imposable: salImp }, pensions: { net: pensNet, abattement: pensAb, imposable: pensImp }, benefices: benefBareme, versementLiberatoireBase: vlBase,
      fonciersFrance: fonFr, fonciersEtranger: { net: etrNet, option: etrOpt }, capital: { dividendes, interets, plusValues: pvNette, moinsValuesRestantes: mvRestantes, brut: capitalBrut }, brutGlobal: S.revGlobal },
    deductions: { pensionEnfantMajeur: pensMaj, pensionAscendants: pensAsc, hebergement: heb, per, perPlafond, cotisationsTns: cotisTns, csgDeductible: S.csgOk, autres: autresDed, total: deductions + S.csgOk },
    rni: S.rni, quotient: S.rni / P.total,
    impotParts: S.o.taxN, impotBaseParts: S.o.taxBase, avantageQF: S.o.avantage, plafondQF: S.o.plafond, plafonnementApplique: S.o.plafonne,
    impotBrut: S.brut, decote: S.decote, impotApresDecote: S.apresDecote, creditImpotEtranger: S.creditEtr,
    reductions: S.redUtilisee, credits: { emploiDomicile: S.credEmp, gardeEnfants: S.credGarde, total: S.credits }, tauxEffectif: etrTaux,
    irNet: S.irNet, pfu: { choix, irPfu: sPfu.pfuIR, totalPfu: sPfu.total, totalBareme: sBar.total, capitalBrut }, ps: { capital: psCapital, fonciers: psFoncier, total: ps }, cehr, rfr,
    irTotal, totalImpots: total, dejaPrelevePAS: dejaPAS, dejaPreleveCapital: dejaCap, solde, aPayer: Math.max(0, solde), aRestituer: Math.max(0, -solde),
    tmi, tauxMoyen, steps, warnings,
  };
}

// ---------------------------------------------------------------------------------------------
// Champs saisissables (à plat, stockés dans fiscal.data) — documentés pour l'assistant « Mes infos fiscales »
// ---------------------------------------------------------------------------------------------
export const SECTIONS = [
  { id: 'foyer', titre: 'Mon foyer', ic: 'user', aide: 'La situation de famille au 31 décembre de l\'année des revenus détermine le nombre de parts.' },
  { id: 'activite', titre: 'Salaires et pensions', ic: 'wallet', aide: 'Ce qui est imposé, c\'est le NET IMPOSABLE ANNUEL — pas le net mensuel versé sur ton compte.' },
  { id: 'entreprise', titre: 'Activité indépendante (hors module Entreprise)', ic: 'brief', aide: 'Tes entreprises créées dans Cockpit sont reprises automatiquement ; ces champs servent aux autres activités.' },
  { id: 'immo', titre: 'Immobilier', ic: 'building', aide: 'Loyers nets de tes biens. Ceux situés au Maroc suivent la convention France–Maroc.' },
  { id: 'capital', titre: 'Bourse et capitaux', ic: 'trend', aide: 'Dividendes, intérêts et plus-values : PFU ou barème, le plus favorable est retenu.' },
  { id: 'deductions', titre: 'Ce qui réduit ton revenu imposable', ic: 'percent', aide: 'Pension alimentaire (y compris à un parent), PER, cotisations… déduites du revenu global.' },
  { id: 'reductions', titre: 'Réductions et crédits d\'impôt', ic: 'heart', aide: 'Dons, emploi à domicile, garde d\'enfants : ils s\'imputent sur l\'impôt.' },
  { id: 'paye', titre: 'Déjà payé dans l\'année', ic: 'check', aide: 'Pour savoir ce qu\'il reste à payer ou à récupérer.' },
];
export const FIELDS = [
  { key: 'situation', section: 'foyer', label: 'Situation de famille au 31/12', type: 'select', def: 'celibataire', options: [['celibataire', 'Célibataire'], ['marie', 'Marié(e) ou pacsé(e)'], ['divorce', 'Divorcé(e) ou séparé(e)'], ['veuf', 'Veuf / veuve']], hint: 'Marié ou pacsé = imposition commune (2 parts). Où : ton avis d\'imposition, « Situation du foyer ».' },
  { key: 'enfantsCharge', section: 'foyer', label: 'Enfants mineurs à charge (résidence principale chez toi)', type: 'int', def: 0, hint: 'Enfants nés après le 31/12 de l\'année N-18, vivant chez toi.' },
  { key: 'enfantsAlternee', section: 'foyer', label: 'Enfants en garde alternée', type: 'int', def: 0, hint: 'Comptent pour moitié (cases G, H).' },
  { key: 'enfantsMajeursRattaches', section: 'foyer', label: 'Enfants majeurs rattachés à ton foyer', type: 'int', def: 0, hint: 'Étudiants de moins de 25 ans… Ne cumule JAMAIS rattachement et pension alimentaire pour le même enfant.' },
  { key: 'parentIsole', section: 'foyer', label: 'Parent isolé (case T)', type: 'bool', def: 0, hint: 'Seul(e) avec au moins un enfant à charge, sans vie maritale.' },
  { key: 'elevéSeul5ans', section: 'foyer', label: 'A élevé seul un enfant pendant 5 ans (case L)', type: 'bool', def: 0, hint: 'Pour une personne seule sans enfant à charge actuellement.' },
  { key: 'demiPartsExtra', section: 'foyer', label: 'Demi-parts supplémentaires', type: 'num', def: 0, hint: 'Carte d\'invalidité, ancien combattant, etc. : 0,5 par situation. Le plafonnement général est appliqué (approximation).' },

  { key: 'salaire1', section: 'activite', label: 'Mes salaires — net imposable annuel', type: 'num', auto: true, hint: 'Où : fiche de paie de DÉCEMBRE, ligne « cumul net imposable » (ou « net fiscal annuel »). Ou ton avis d\'imposition / déclaration pré-remplie, case 1AJ. À défaut : 12 × le net fiscal mensuel.' },
  { key: 'fraisReels1', section: 'activite', label: 'Frais réels (si plus avantageux que les 10 %)', type: 'num', def: 0, hint: 'Laisse 0 pour l\'abattement forfaitaire de 10 %. Case 1AK.' },
  { key: 'salaire2', section: 'activite', label: 'Salaires du conjoint — net imposable annuel', type: 'num', def: 0, hint: 'Case 1BJ. Seulement si marié / pacsé.' },
  { key: 'fraisReels2', section: 'activite', label: 'Frais réels du conjoint', type: 'num', def: 0, hint: 'Case 1BK.' },
  { key: 'pensions1', section: 'activite', label: 'Pensions de retraite / invalidité', type: 'num', def: 0, hint: 'Case 1AS.' },
  { key: 'pensions2', section: 'activite', label: 'Pensions du conjoint', type: 'num', def: 0, hint: 'Case 1BS.' },

  { key: 'microBnc', section: 'entreprise', label: 'Micro-BNC : chiffre d\'affaires encaissé', type: 'num', def: 0, hint: 'Abattement forfaitaire de 34 % (min 305 €). Case 5HQ.' },
  { key: 'microBicServices', section: 'entreprise', label: 'Micro-BIC prestations de services : CA', type: 'num', def: 0, hint: 'Abattement de 50 %. Case 5KP.' },
  { key: 'microBicVente', section: 'entreprise', label: 'Micro-BIC vente de marchandises : CA', type: 'num', def: 0, hint: 'Abattement de 71 %. Case 5KO.' },
  { key: 'versementLiberatoire', section: 'entreprise', label: 'Versement libératoire de l\'impôt (ces micro-activités)', type: 'bool', def: 0, hint: 'L\'IR est déjà payé avec les cotisations URSSAF : ces revenus ne sont plus imposés au barème.' },
  { key: 'bncReel', section: 'entreprise', label: 'BNC au réel : bénéfice (ou déficit)', type: 'num', def: 0, hint: 'Résultat de la déclaration 2035.' },
  { key: 'bicReel', section: 'entreprise', label: 'BIC au réel : bénéfice (ou déficit)', type: 'num', def: 0, hint: 'Résultat de la liasse (2031).' },
  { key: 'cotisationsTns', section: 'entreprise', label: 'Cotisations sociales déductibles (non salarié)', type: 'num', def: 0, hint: 'Déjà incluses pour tes entreprises Cockpit.' },

  { key: 'foncierFranceMode', section: 'immo', label: 'Revenus fonciers en France — régime', type: 'select', def: 'micro', options: [['micro', 'Micro-foncier (abattement 30 %)'], ['reel', 'Régime réel']], hint: 'Micro-foncier seulement jusqu\'à 15 000 € de loyers.' },
  { key: 'foncierFranceLoyers', section: 'immo', label: 'Loyers bruts encaissés en France', type: 'num', def: 0, hint: 'Cases 4BE (micro) ou 4BA (réel).' },
  { key: 'foncierFranceCharges', section: 'immo', label: 'Charges déductibles (régime réel)', type: 'num', def: 0, hint: 'Travaux, intérêts, taxe foncière, assurance…' },
  { key: 'foncierEtrangerNet', section: 'immo', label: 'Loyers nets de source étrangère (ex. Maroc) — ma part, en €', type: 'num', auto: true, hint: 'Résultat de tes projets immobiliers × ta part, converti en euros. Pour l\'immeuble marocain : loyers + charges refacturées − charges d\'exploitation (avant impôt marocain).' },
  { key: 'foncierEtrangerOption', section: 'immo', label: 'Traitement des revenus étrangers', type: 'select', def: 'taux_effectif', options: [['taux_effectif', 'Exonérés en France, pris en compte pour le taux (convention France–Maroc)'], ['credit_impot', 'Imposés en France avec crédit d\'impôt'], ['ignorer', 'Ne pas les prendre en compte']], hint: 'Pour des loyers d\'un immeuble situé au Maroc, la convention du 29/05/1970 réserve l\'imposition au Maroc ; la France les retient seulement pour calculer le taux (« taux effectif »). À faire valider.' },
  { key: 'foncierEtrangerImpot', section: 'immo', label: 'Impôt payé à l\'étranger (option crédit d\'impôt)', type: 'num', def: 0, hint: 'Converti en euros. Utile seulement avec « crédit d\'impôt ».' },

  { key: 'dividendes', section: 'capital', label: 'Dividendes bruts perçus (hors entreprises Cockpit)', type: 'num', auto: true, hint: 'Cases 2DC. Dividendes de ton portefeuille (ordres « Dividende ») et opérations Perso « Dividendes ».' },
  { key: 'interets', section: 'capital', label: 'Intérêts perçus (livrets imposables, comptes à terme)', type: 'num', def: 0, hint: 'Case 2TR. Les livrets réglementés (A, LDDS) ne sont pas imposables.' },
  { key: 'plusValues', section: 'capital', label: 'Plus-values de cession de titres (net de l\'année)', type: 'num', auto: true, hint: 'Case 3VG. Calculée depuis tes ventes de bourse (prix de revient moyen pondéré) — hors PEA, assurance-vie.' },
  { key: 'moinsValuesReportables', section: 'capital', label: 'Moins-values reportables (10 dernières années)', type: 'num', def: 0, hint: 'Case 3VH : voir ton avis d\'imposition.' },
  { key: 'optionCapital', section: 'capital', label: 'Imposition des capitaux', type: 'select', def: 'auto', options: [['auto', 'Automatique : le plus favorable'], ['pfu', 'PFU (flat tax)'], ['bareme', 'Barème progressif (case 2OP)']], hint: 'L\'option pour le barème s\'applique à TOUS tes revenus du capital de l\'année.' },
  { key: 'csgDeductible', section: 'capital', label: 'CSG déductible (6,8 % des capitaux de l\'an passé, si barème)', type: 'num', def: 0, hint: 'Case 6DE : indiquée sur l\'avis d\'imposition de l\'année précédente.' },

  { key: 'pensionAscendants', section: 'deductions', label: 'Pension alimentaire versée à un parent (ascendant)', type: 'num', def: 0, hint: 'Case 6GU. Déductible du revenu global, sans plafond légal, si ton parent est dans le besoin et si le montant reste proportionné à tes ressources. Garde les justificatifs (virements, ressources du parent).' },
  { key: 'hebergementAscendants', section: 'deductions', label: 'Parents hébergés chez toi (nombre)', type: 'int', def: 0, hint: 'Forfait sans justificatif (pour un parent hébergé, au lieu de la pension versée).' },
  { key: 'pensionEnfantMajeur', section: 'deductions', label: 'Pension alimentaire à un enfant majeur (non rattaché)', type: 'num', def: 0, hint: 'Cases 6EL / 6EM, plafonnée par enfant.' },
  { key: 'nbEnfantsMajeursPension', section: 'deductions', label: 'Nombre d\'enfants majeurs aidés', type: 'int', def: 0, hint: 'Pour appliquer le plafond par enfant.' },
  { key: 'perVersements', section: 'deductions', label: 'Versements sur un PER (épargne retraite)', type: 'num', def: 0, hint: 'Cases 6NS… Déductibles dans la limite de ton plafond.' },
  { key: 'perPlafond', section: 'deductions', label: 'Ton plafond de déduction PER (avis d\'imposition)', type: 'num', def: 0, hint: 'Rubrique « Plafond épargne retraite » de l\'avis. Vide = calcul automatique.' },
  { key: 'autresDeductions', section: 'deductions', label: 'Autres charges déductibles', type: 'num', def: 0, hint: 'Ex. cotisations syndicales hors réductions, déficits…' },

  { key: 'dons66', section: 'reductions', label: 'Dons aux associations (66 %)', type: 'num', def: 0, hint: 'Case 7UF.' },
  { key: 'dons75', section: 'reductions', label: 'Dons aux organismes d\'aide aux personnes en difficulté (75 %)', type: 'num', def: 0, hint: 'Case 7UD.' },
  { key: 'emploiDomicile', section: 'reductions', label: 'Emploi à domicile : dépenses', type: 'num', def: 0, hint: 'Case 7DB (50 % en crédit d\'impôt).' },
  { key: 'gardeEnfants', section: 'reductions', label: 'Garde d\'enfants de moins de 6 ans hors domicile : frais nets', type: 'num', def: 0, hint: 'Case 7GA (50 %, plafond par enfant).' },
  { key: 'nbEnfantsGarde', section: 'reductions', label: 'Nombre d\'enfants gardés', type: 'int', def: 1, hint: 'Pour le plafond de 3 500 € par enfant.' },
  { key: 'autresReductions', section: 'reductions', label: 'Autres réductions d\'impôt (montant)', type: 'num', def: 0, hint: 'Montant de réduction déjà calculé (investissement locatif, PME…).' },
  { key: 'autresCredits', section: 'reductions', label: 'Autres crédits d\'impôt (montant)', type: 'num', def: 0, hint: 'Ex. borne de recharge.' },

  { key: 'pasPreleve', section: 'paye', label: 'Prélèvement à la source déjà versé dans l\'année', type: 'num', auto: false, def: 0, hint: 'Où : fiche de paie de décembre (cumul « impôt sur le revenu prélevé à la source »), ou « Total des prélèvements à la source » dans ton espace impots.gouv.fr. Taux = ligne « taux personnalisé » de ta fiche.' },
  { key: 'capitalDejaPreleve', section: 'paye', label: 'Prélèvements déjà opérés sur le capital (acompte 12,8 % + prélèvements sociaux)', type: 'num', def: 0, hint: 'Sur ton IFU (imprimé fiscal unique) de la banque / du courtier.' },
];
export const FIELD = Object.fromEntries(FIELDS.map((f) => [f.key, f]));

// Valeurs finales : saisie > calcul automatique > défaut. Renvoie { input, sources } (sources[key] = 'saisie' | 'calculée' | 'défaut')
export function inputFromFlat(saved = {}, auto = {}, entreprises = []) {
  const input = { entreprises }, sources = {};
  for (const f of FIELDS) {
    const s = saved[f.key], a = auto[f.key];
    let v, src;
    if (s !== undefined && s !== null && s !== '') { v = s; src = 'saisie'; }
    else if (a !== undefined && a !== null && f.auto) { v = a; src = 'calculée'; }
    else { v = f.def ?? 0; src = 'défaut'; }
    input[f.key] = f.type === 'select' ? String(v) : f.type === 'bool' ? (v === true || v === 1 || v === '1' ? 1 : 0) : num(v);
    sources[f.key] = src;
  }
  return { input, sources };
}

// Simulateur « et si… » : recalcule avec des variations (montants ajoutés aux champs numériques) et renvoie l'écart d'impôt
export function whatIf(input, B, deltas = {}) {
  const base = computeTax(input, B);
  const alt = { ...input };
  for (const [k, d] of Object.entries(deltas)) alt[k] = num(alt[k]) + num(d);
  const res = computeTax(alt, B);
  return { base, alt: res, ecart: res.totalImpots - base.totalImpots, ecartIR: res.irTotal - base.irTotal };
}

export const anneeRevenusEnCours = (today) => Number(String(today).slice(0, 4));
