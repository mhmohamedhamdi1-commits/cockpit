// Entreprises (un projet = une entreprise) : moteur PUR — aucun DOM, importe seulement util.js.
// Utilisé par l'écran Entreprise, par le tableau de bord / la santé financière (via core.js) et par la fonction serveur de
// notifications (copié dans supabase/functions/_shared). ctx = { data, today, P, fx? } comme core.js.
//
// ───────────────────────────── Règles réglementaires (par année, source en commentaire) ─────────────────────────────
// Principe de mise à jour : AJOUTER une entrée REGLES[AAAA] (ou corriger une valeur) ; aucune logique à réécrire. Une année
// sans entrée reprend la dernière année connue, marquée « estimé ». Hiérarchie des valeurs : meta de l'entreprise > paramètre
// de l'utilisateur (params, si différent du défaut historique) > table datée ci-dessous.
// Dernière vérification des valeurs : 2026-11-28.
import { addMonths, monthEnd, monthLong, daysBetween } from './util.js';

export const REGLES = {
  2025: {
    statut: 'officiel',
    source: 'urssaf.fr / economie.gouv.fr (revenus et cotisations 2025)',
    micro: {
      // Plafonds de CA HT 2023-2025 : service-public.fr, economie.gouv.fr « seuils micro-entreprise »
      plafond: { bnc: 77700, bic_services: 77700, bic_vente: 188700 },
      abattement: { bnc: 0.34, bic_services: 0.5, bic_vente: 0.71, min: 305 },   // CGI art. 102 ter, 50-0 ; minimum 305 €
      cotisations: { bnc: 0.246, bnc_cipav: 0.232, bic_services: 0.212, bic_vente: 0.123 },
      cfp: { bnc: 0.002, bic_services: 0.001, bic_vente: 0.001 },               // 0,2 % libéral, 0,1 % commerçant (0,3 % artisan)
      vl: { bnc: 0.022, bic_services: 0.017, bic_vente: 0.01, rfrParPart: 28797 },
    },
    tva: { services: [37500, 41250], vente: [85000, 93500] },                   // CGI art. 293 B (inchangés, loi du 3 nov. 2025)
    is: { tauxReduit: 0.15, plafondReduit: 42500, taux: 0.25, caMax: 10000000, seuilDispenseAcomptes: 3000 },   // CGI art. 219
    pfu: { ir: 0.128, ps: 0.172 },
  },
  2026: {
    statut: 'officiel',
    source: 'décret n° 2026-562 du 29 juin 2026 (plafonds), décret n° 2025-943 (cotisations BNC), LFSS 2026 (PFU 31,4 %), urssaf.fr',
    micro: {
      // Plafonds 2026-2028 : économie.gouv.fr, urssaf.fr « 2026 : modification des seuils de chiffre d'affaires ou de recettes »
      plafond: { bnc: 83600, bic_services: 83600, bic_vente: 203100 },
      abattement: { bnc: 0.34, bic_services: 0.5, bic_vente: 0.71, min: 305 },
      // Cotisations 2026 : BNC non réglementé 25,6 % (décret 2025-943), CIPAV 23,2 %, services BIC 21,2 %, vente 12,3 %
      cotisations: { bnc: 0.256, bnc_cipav: 0.232, bic_services: 0.212, bic_vente: 0.123 },
      cfp: { bnc: 0.002, bic_services: 0.001, bic_vente: 0.001 },
      // Versement libératoire : 2,2 % BNC, 1,7 % services BIC, 1 % vente ; condition RFR N-2 ≤ 29 315 € par part (urssaf.fr)
      vl: { bnc: 0.022, bic_services: 0.017, bic_vente: 0.01, rfrParPart: 29315 },
    },
    tva: { services: [37500, 41250], vente: [85000, 93500] },
    // Régime réel simplifié de TVA (arrêté du 27 janv. 2026) : supprimé au 1er janvier 2027 (LF 2025 art. 38)
    tvaReel: { simplifie: { services: 286000, vente: 945000 }, simplifieSupprimeAu: '2027-01-01' },
    is: { tauxReduit: 0.15, plafondReduit: 42500, taux: 0.25, caMax: 10000000, seuilDispenseAcomptes: 3000 },
    // LFSS 2026 (loi n° 2025-1403) : CSG capital 9,2 → 10,6 % : prélèvements sociaux 18,6 %, PFU = 12,8 + 18,6 = 31,4 %
    pfu: { ir: 0.128, ps: 0.186 },
    // Ordres de grandeur (urssaf.fr, simulateurs) — ESTIMATIONS : dépendent du revenu réel et des caisses
    tns: { cotisationsSurNet: 0.45, dividendeFranchisePctCapital: 0.10 },       // gérant TNS : ≈ 45 % du revenu net
    sasu: { chargesTotalesSurNet: 0.80 },                                       // président assimilé salarié : ≈ 80 % du net (salariales + patronales)
    acre: [   // coefficient appliqué au taux normal pendant la période ACRE, selon la date de création
      { depuis: '2000-01-01', coef: 0.5 },    // création avant le 1er juillet 2026 : taux réduit de moitié
      { depuis: '2026-07-01', coef: 0.75 },   // décret n° 2026-69 du 6 février 2026 : 75 % du taux normal
    ],
  },
  2027: {
    // Plafonds 2026-2028 identiques (décret n° 2026-562) ; le reste est reconduit de 2026 en attendant les textes 2027
    statut: 'estime',
    source: 'plafonds : décret n° 2026-562 (2026-2028) ; autres valeurs reconduites de 2026 (à confirmer)',
    estimes: ['cotisations', 'cfp', 'vl.rfrParPart', 'is', 'pfu', 'tns', 'sasu'],
    reprend: 2026,
    tva: { services: [37500, 41250], vente: [85000, 93500] },
  },
};

const LEGACY_DEFAULTS = { seuil_micro: '83600', seuil_tva: '37500', seuil_tva_maj: '41250', taux_cotis: '0.256', taux_cfp: '0.002', taux_provision: '0.40' };

// Règles de l'année (repli sur la dernière année connue, marqué estimé). Fusionne les années qui « reprennent » une autre.
export function rulesFor(year) {
  const y = Number(year);
  const known = Object.keys(REGLES).map(Number).sort((a, b) => a - b);
  let base = REGLES[y];
  let estime = false;
  if (!base) { const prev = [...known].reverse().find((k) => k <= y) ?? known[0]; base = REGLES[prev]; estime = y > prev; }
  const merged = base.reprend ? { ...clone(REGLES[base.reprend]), ...clone(base) } : clone(base);
  if (base.reprend) {
    for (const k of ['micro', 'is', 'pfu', 'tns', 'sasu', 'acre', 'tvaReel']) if (!base[k]) merged[k] = clone(REGLES[base.reprend][k]);
  }
  merged.annee = y;
  merged.statut = estime ? 'estime' : base.statut;
  merged.estimes = base.estimes || [];
  return merged;
}
const clone = (o) => JSON.parse(JSON.stringify(o));

// ───────────────────────────── Formes juridiques ─────────────────────────────
// regimeIR : micro (EI micro) | reel_ir (EI au réel, EURL à l'IR) | is (société soumise à l'IS)
export const FORMES = {
  micro_bnc: { label: 'Micro-entreprise — prestations libérales (BNC)', short: 'Micro BNC', famille: 'micro', nature: 'bnc', regimeIR: 'micro', social: 'tns', individuelle: true },
  micro_bic_services: { label: 'Micro-entreprise — prestations de services commerciales/artisanales (BIC)', short: 'Micro BIC services', famille: 'micro', nature: 'bic_services', regimeIR: 'micro', social: 'tns', individuelle: true },
  micro_bic_vente: { label: 'Micro-entreprise — vente de marchandises (BIC)', short: 'Micro BIC vente', famille: 'micro', nature: 'bic_vente', regimeIR: 'micro', social: 'tns', individuelle: true },
  ei_reel_bnc: { label: 'Entreprise individuelle au réel (BNC, déclaration contrôlée)', short: 'EI réel BNC', famille: 'reel', nature: 'bnc', regimeIR: 'reel_ir', social: 'tns', individuelle: true },
  eurl_ir: { label: 'EURL — impôt sur le revenu', short: 'EURL IR', famille: 'societe', nature: 'bnc', regimeIR: 'reel_ir', social: 'tns', individuelle: false },
  eurl_is: { label: 'EURL — impôt sur les sociétés', short: 'EURL IS', famille: 'societe', nature: 'bnc', regimeIR: 'is', social: 'tns', individuelle: false },
  sasu: { label: 'SASU — président assimilé salarié', short: 'SASU', famille: 'societe', nature: 'bnc', regimeIR: 'is', social: 'assimile_salarie', individuelle: false },
  sas: { label: 'SAS (plusieurs associés)', short: 'SAS', famille: 'societe', nature: 'bnc', regimeIR: 'is', social: 'assimile_salarie', individuelle: false },
  sarl: { label: 'SARL (plusieurs associés)', short: 'SARL', famille: 'societe', nature: 'bnc', regimeIR: 'is', social: 'tns', individuelle: false },
};
export const NATURES = { bnc: 'Prestations libérales (BNC)', bic_services: 'Prestations de services BIC', bic_vente: 'Vente de marchandises (BIC)' };
export const TVA_REGIMES = { franchise: 'Franchise en base (pas de TVA)', reel_simplifie: 'Réel simplifié (jusqu’en 2026)', reel_normal: 'Réel normal (CA3)' };
export const isMicro = (meta) => FORMES[meta.forme]?.regimeIR === 'micro';

// Paramètres d'une entreprise avec valeurs par défaut (projets.meta est un objet libre ; rien n'est jamais perdu)
export function normalizeMeta(meta = {}, projet = {}, ctx = null) {
  const m = meta && typeof meta === 'object' ? meta : {};
  const forme = FORMES[m.forme] ? m.forme : 'micro_bnc';
  const F = FORMES[forme];
  const legacyStart = ctx && (ctx.data?.params || []).find((p) => p.cle === 'micro_debut');
  const part = clamp(Number(projet.part ?? 1), 0, 1);
  const rem = m.remuneration || {};
  const associes = Array.isArray(m.associes) && m.associes.length ? m.associes.map((a) => ({ nom: String(a.nom || ''), part: clamp(Number(a.part) || 0, 0, 1), moi: !!a.moi }))
    : part < 1 && !F.individuelle ? [{ nom: 'Moi', part, moi: true }, { nom: 'Autres associés', part: round2(1 - part), moi: false }] : [{ nom: 'Moi', part, moi: true }];
  return {
    forme, nature: F.nature, regimeIR: F.regimeIR, famille: F.famille, social: F.social, individuelle: F.individuelle,
    date_debut: isoDate(m.date_debut) || (m.forme == null && legacyStart && isoDate(legacyStart.valeur)) || '',
    libelle_activite: m.libelle_activite || '',
    siret: m.siret || '',
    cloture: /^\d{2}-\d{2}$/.test(m.cloture) ? m.cloture : '12-31',                       // MM-JJ, fin d'exercice (sociétés)
    premiere_cloture: isoDate(m.premiere_cloture) || '',
    tva_regime: TVA_REGIMES[m.tva_regime] ? m.tva_regime : (F.famille === 'micro' ? 'franchise' : 'reel_normal'),
    tva_periodicite: ['mensuelle', 'trimestrielle', 'annuelle'].includes(m.tva_periodicite) ? m.tva_periodicite : 'trimestrielle',
    urssaf_periodicite: m.urssaf_periodicite === 'trimestrielle' ? 'trimestrielle' : 'mensuelle',
    versement_liberatoire: !!m.versement_liberatoire && F.famille === 'micro',
    acre: !!m.acre,
    caisse: m.caisse === 'cipav' ? 'cipav' : 'ssi',
    artisan: !!m.artisan,
    tmi: clamp(Number(m.tmi ?? 0.3), 0, 0.45),                                              // tranche marginale supposée pour l'IR indicatif
    marge_estimee: clamp(Number(m.marge_estimee ?? 0.7), 0.05, 1),                          // part du CA qui reste en bénéfice (réserve d'IS)
    capital: Math.max(0, Number(m.capital ?? 1000)),
    gerant_majoritaire: m.gerant_majoritaire !== false,
    je_suis_dirigeant: m.je_suis_dirigeant !== false,
    associes,
    remuneration: { mode: ['salaire', 'dividendes', 'mixte'].includes(rem.mode) ? rem.mode : 'dividendes', salaire_net_annuel: Math.max(0, Number(rem.salaire_net_annuel) || 0),
      dividendes_annuels: Math.max(0, Number(rem.dividendes_annuels) || 0), distribution_pct: clamp(Number(rem.distribution_pct ?? 1), 0, 1) },
    checklist: m.checklist && typeof m.checklist === 'object' ? m.checklist : {},
    provision_pct: m.provision_pct != null && m.provision_pct !== '' ? clamp(Number(m.provision_pct), 0, 1) : null,
  };
}
const clamp = (v, a, b) => (isFinite(v) ? Math.min(b, Math.max(a, v)) : a);
const round2 = (v) => Math.round(v * 100) / 100;
const isoDate = (s) => (/^\d{4}-\d{2}-\d{2}/.test(String(s || '')) ? String(s).slice(0, 10) : '');

// ───────────────────────────── Dates (sans fuseau) ─────────────────────────────
const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const addDaysISO = (date, n) => new Date(new Date(date + 'T12:00:00Z').getTime() + n * 864e5).toISOString().slice(0, 10);
const wday = (date) => new Date(date + 'T12:00:00Z').getUTCDay();
export const bizNext = (date) => { let d = date; while (wday(d) === 0 || wday(d) === 6) d = addDaysISO(d, 1); return d; };   // jours fériés non gérés
const lastDay = (ym) => monthEnd(ym);
const secondBizDayAfterMay1 = (y) => { let cur = iso(y, 5, 1), n = 0; while (n < 2) { cur = addDaysISO(cur, 1); if (wday(cur) !== 0 && wday(cur) !== 6) n++; } return cur; };
const addMonthsISO = (date, n) => { const ym = addMonths(date.slice(0, 7), n); const d = Math.min(+date.slice(8, 10), +lastDay(ym).slice(8, 10)); return `${ym}-${pad(d)}`; };
const quarterOf = (ym) => Math.floor((+ym.slice(5, 7) - 1) / 3) + 1;

// ───────────────────────────── Accès aux données ─────────────────────────────
const rateOf = (ctx, cur) => (!cur || cur === 'EUR' ? 1 : cur === 'MAD' ? (ctx.P && ctx.P.taux) || 0.093 : (ctx.fx && ctx.fx[cur]) || 1);
export const entreprisesOf = (ctx) => (ctx.data.projets || []).filter((p) => p.type === 'Entreprise').sort((a, b) => (a.seq || 0) - (b.seq || 0));
// Les lignes sans entreprise (anciennes données) sont rattachées à la première entreprise
function owns(ctx, projet) {
  const first = (entreprisesOf(ctx)[0] || {}).id;
  return (r) => (r.projetId ? r.projetId === projet.id : first === projet.id);
}
const paramRaw = (ctx, key) => { const p = (ctx.data.params || []).find((x) => x.cle === key); return p ? String(p.valeur) : null; };
// Surcharge utilisateur d'un paramètre historique : seulement s'il diffère du défaut d'origine
function paramOverride(ctx, key) {
  const v = paramRaw(ctx, key);
  if (v == null || v === '' || v === LEGACY_DEFAULTS[key]) return null;
  const n = parseFloat(v.replace(',', '.'));
  return isFinite(n) ? n : null;
}
const NON_FRAIS = new Set(['Cotisations URSSAF', 'Cotisations sociales dirigeant', 'Versement libératoire (IR)', 'Impôt sur les sociétés', 'Salaire dirigeant', 'Dividendes versés', 'TVA reversée']);

// Plafonds / seuils applicables à une entreprise pour une année
export function seuilsOf(ctx, projet, year) {
  const R = rulesFor(year), m = normalizeMeta(projet.meta, projet, ctx), n = m.nature;
  const tvaPair = n === 'bic_vente' ? R.tva.vente : R.tva.services;
  const f = microFactor(m, year);
  const o = { micro: paramOverride(ctx, 'seuil_micro'), tva: paramOverride(ctx, 'seuil_tva'), tvaMaj: paramOverride(ctx, 'seuil_tva_maj') };
  const useOverride = n === 'bnc' || n === 'bic_services';
  return {
    factor: f,
    plafondBase: isMicro(m) ? ((useOverride && o.micro) || R.micro.plafond[n]) : null,
    plafondCA: isMicro(m) ? ((useOverride && o.micro) || R.micro.plafond[n]) * f : null,
    tvaSeuil: m.tva_regime === 'franchise' ? ((useOverride && o.tva) || tvaPair[0]) * f : null,
    tvaSeuilMaj: m.tva_regime === 'franchise' ? ((useOverride && o.tvaMaj) || tvaPair[1]) * f : null,
    estime: R.statut === 'estime',
  };
}
// 1re année : seuils proratisés au nombre de jours d'activité (Jan. 1er = 1)
export function microFactor(meta, year) {
  const start = meta.date_debut;
  if (!start) return 1;
  const sy = +start.slice(0, 4);
  if (+year < sy) return 0;
  if (+year > sy) return 1;
  const days = Math.round((new Date(`${year}-12-31T00:00:00Z`) - new Date(start + 'T00:00:00Z')) / 864e5) + 1;
  return Math.min(1, days / 365);
}
export const started = (meta, today) => !meta.date_debut || meta.date_debut <= today;

// Encaissements HT de l'année (EUR) : factures payées + opérations « Prestations » saisies à la main
export function encaissements(ctx, projet, year) {
  const own = owns(ctx, projet), y = String(year), out = [];
  const m = normalizeMeta(projet.meta, projet, ctx);
  const clients = new Map((ctx.data.clients || []).filter(own).map((c) => [c.nom, c]));
  for (const i of ctx.data.invoices || []) {
    if (!own(i) || i.statut !== 'Payée') continue;
    if (m.date_debut && i.periode < m.date_debut.slice(0, 7)) continue;
    const c = clients.get(i.client);
    if (c && c.micro === 'Non') continue;
    const d = i.paiement || i.emission || `${i.periode}-01`;
    if (d.slice(0, 4) === y) out.push({ date: d, ht: i.ht * rateOf(ctx, i.devise), ttc: i.ttc * rateOf(ctx, i.devise), source: 'facture', id: i.id });
  }
  for (const t of ctx.data.tx || []) {
    if (t.activite !== 'Entreprise' || !own(t) || t.sens !== 'Revenu' || t.categorie !== 'Prestations' || /^FAC/.test(t.ref || '') || t.date.slice(0, 4) !== y) continue;
    if (m.date_debut && t.date < m.date_debut) continue;
    out.push({ date: t.date, ht: t.montantEur, ttc: t.montantEur, source: 'saisie', id: t.id });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

// ───────────────────────────── Suivi annuel / mensuel ─────────────────────────────
// Remplace core.freelanceYear. paid = encaissé, billed = facturé non payé, planned = planifié ; (micro, tva, tvaMaj : alias historiques)
export function entrepriseYear(ctx, projet, year) {
  const y = String(year), m = normalizeMeta(projet.meta, projet, ctx), own = owns(ctx, projet);
  const S = seuilsOf(ctx, projet, y);
  const clients = new Map((ctx.data.clients || []).filter(own).map((c) => [c.nom, c]));
  const from = m.date_debut ? m.date_debut.slice(0, 7) : '';
  const months = Array.from({ length: 12 }, (_, k) => ({ month: `${y}-${pad(k + 1)}`, facture: 0, encaisse: 0, planifie: 0 }));
  let billed = 0, planned = 0;
  const enc = encaissements(ctx, projet, y);
  const paid = enc.reduce((s, e) => s + e.ht, 0);
  for (const e of enc) months[+e.date.slice(5, 7) - 1].encaisse += e.ht;
  for (const i of ctx.data.invoices || []) {
    if (!own(i) || (from && i.periode < from)) continue;
    const c = clients.get(i.client);
    if (c && c.micro === 'Non') continue;
    const ht = i.ht * rateOf(ctx, i.devise);
    if (i.statut === 'Envoyée' && (i.emission || `${i.periode}-01`).slice(0, 4) === y) { billed += ht; months[+(i.emission || `${i.periode}-01`).slice(5, 7) - 1].facture += ht; }
    else if (i.statut === 'Payée' && (i.emission || `${i.periode}-01`).slice(0, 4) === y) months[+(i.emission || `${i.periode}-01`).slice(5, 7) - 1].facture += ht;
    else if (i.statut === 'Planifiée' && i.periode.slice(0, 4) === y) { planned += ht; months[+i.periode.slice(5, 7) - 1].planifie += ht; }
  }
  let cum = 0;
  for (const mo of months) { cum += mo.encaisse; mo.cumul = cum; }
  const done = paid + billed, total = paid + billed + planned;
  return {
    year: y, paid, billed, planned, total, done, factor: S.factor, months,
    plafondCA: S.plafondCA, tvaSeuil: S.tvaSeuil, tvaSeuilMaj: S.tvaSeuilMaj, estime: S.estime,
    micro: S.plafondCA ?? Infinity, tva: S.tvaSeuil ?? Infinity, tvaMaj: S.tvaSeuilMaj ?? Infinity,   // alias de core.freelanceYear
    resteAvantPlafond: S.plafondCA != null ? S.plafondCA - done : null,
    resteAvantTva: S.tvaSeuil != null ? S.tvaSeuil - done : null,
  };
}

// Coefficient ACRE applicable à une date de création (null si pas d'ACRE)
export function acreInfo(meta, year) {
  if (!meta.acre || !meta.date_debut) return null;
  const arr = rulesFor(year).acre || rulesFor(2026).acre;
  let coef = 1;
  for (const a of arr) if (meta.date_debut >= a.depuis) coef = a.coef;
  const q = quarterOf(meta.date_debut.slice(0, 7));
  const endQ = q + 3;                                               // fin du 3e trimestre civil suivant le début d'activité
  const y0 = +meta.date_debut.slice(0, 4);
  const endYear = y0 + Math.floor((endQ - 1) / 4), eq = ((endQ - 1) % 4) + 1;
  return { coef, fin: monthEnd(`${endYear}-${pad(eq * 3)}`) };
}
const acreCoefAt = (info, date) => (info && date <= info.fin ? info.coef : 1);

// Taux micro applicables (cotisations, CFP, VL) pour une année
export function tauxMicro(ctx, projet, year) {
  const R = rulesFor(year).micro || rulesFor(2026).micro, m = normalizeMeta(projet.meta, projet, ctx);
  const n = m.nature;
  const oc = paramOverride(ctx, 'taux_cotis'), ocfp = paramOverride(ctx, 'taux_cfp');
  let cot = n === 'bnc' ? (m.caisse === 'cipav' ? R.cotisations.bnc_cipav : R.cotisations.bnc) : R.cotisations[n];
  if (oc != null && n === 'bnc') cot = oc;
  let cfp = R.cfp[n]; if (m.artisan && n !== 'bnc') cfp = 0.003;
  if (ocfp != null) cfp = ocfp;
  return { cotisations: cot, cfp, vl: m.versement_liberatoire ? R.vl[n] : 0, abattement: R.abattement[n], abattementMin: R.abattement.min, vlRfrParPart: R.vl.rfrParPart };
}

// IS : 15 % jusqu'à 42 500 € (proratisé si l'exercice dure moins de 12 mois) puis 25 % — PME détenues à 75 % par des personnes physiques, CA < 10 M€
export function calculIS(year, benefice, { moisExercice = 12, pmeReduit = true } = {}) {
  const R = rulesFor(year).is || rulesFor(2026).is;
  if (benefice <= 0) return { is: 0, tranche15: 0, tranche25: 0, plafond: R.plafondReduit };
  const plafond = R.plafondReduit * Math.min(12, moisExercice) / 12;
  const t15 = pmeReduit ? Math.min(benefice, plafond) : 0, t25 = benefice - t15;
  return { is: round2(t15 * R.tauxReduit + t25 * R.taux), tranche15: t15, tranche25: t25, plafond };
}
// Flat tax (PFU) sur des dividendes : IR 12,8 % + prélèvements sociaux (17,2 % → 18,6 % depuis 2026)
export function flatTax(year, dividendes) {
  const R = rulesFor(year).pfu || rulesFor(2026).pfu;
  const ir = dividendes * R.ir, ps = dividendes * R.ps;
  return { ir: round2(ir), ps: round2(ps), total: round2(ir + ps), taux: R.ir + R.ps, net: round2(dividendes - ir - ps) };
}

// ───────────────────────────── Finances d'une entreprise sur une année ─────────────────────────────
// Estimation des charges et de la fiscalité (EUR). Tout est « estimé » : voir docs/09_Entreprise.md
export function entrepriseFinance(ctx, projet, year) {
  const y = String(year), m = normalizeMeta(projet.meta, projet, ctx), own = owns(ctx, projet), R = rulesFor(y);
  const enc = encaissements(ctx, projet, y);
  const ca = enc.reduce((s, e) => s + e.ht, 0);
  const tx = (ctx.data.tx || []).filter((t) => t.activite === 'Entreprise' && own(t));
  const inYear = tx.filter((t) => t.date.slice(0, 4) === y);
  const frais = inYear.filter((t) => t.sens === 'Dépense' && t.nature === 'Courant' && !NON_FRAIS.has(t.categorie)).reduce((s, t) => s + t.montantEur, 0);
  const sumCat = (cat) => inYear.filter((t) => t.sens === 'Dépense' && t.categorie === cat).reduce((s, t) => s + t.montantEur, 0);
  const cotisationsPayees = sumCat('Cotisations URSSAF') + sumCat('Cotisations sociales dirigeant');
  const vlPaye = sumCat('Versement libératoire (IR)'), isPaye = sumCat('Impôt sur les sociétés');
  const salaireRecord = sumCat('Salaire dirigeant'), dividendesRecord = sumCat('Dividendes versés');
  const tresorerie = tx.reduce((s, t) => s + (t.sens === 'Revenu' ? 1 : -1) * t.montantEur, 0);
  const details = []; const notes = []; let estimated = R.statut === 'estime';
  const out = { year: y, forme: m.forme, regimeIR: m.regimeIR, part: Number(projet.part ?? 1), ca, frais, cotisationsPayees, vlPaye, isPaye, tresorerie, details, notes,
    urssaf: 0, cfp: 0, versementLiberatoire: 0, cotisationsTNS: 0, salaire: null, is: 0, irIndicatif: 0, resultatAvantImpot: 0, resultatNet: 0,
    dividendes: null, total: 0, resteAMettreDeCote: 0 };
  const add = (key, label, amount, note = '', base = null, rate = null) => { if (amount > 0.004 || key === 'info') details.push({ key, label, amount: round2(amount), note, base, rate }); };

  if (m.regimeIR === 'micro') {
    const T = tauxMicro(ctx, projet, y), acre = acreInfo(m, y);
    let urssaf = 0; for (const e of enc) urssaf += e.ht * T.cotisations * acreCoefAt(acre, e.date);
    const cfp = ca * T.cfp, vl = ca * T.vl;
    const abatt = Math.max(ca * T.abattement, ca > 0 ? T.abattementMin : 0);
    const imposable = Math.max(0, ca - abatt);
    out.urssaf = urssaf; out.cfp = cfp; out.versementLiberatoire = vl;
    out.microImposable = imposable; out.microAbattement = { taux: T.abattement, montant: Math.min(abatt, ca) };
    out.irIndicatif = m.versement_liberatoire ? 0 : imposable * m.tmi * out.part;
    add('urssaf', `Cotisations sociales (${acre && acre.coef < 1 ? `ACRE ×${acre.coef}, ` : ''}${(T.cotisations * 100).toFixed(1).replace('.', ',')} % du CA)`, urssaf, 'Déclarées et payées à l’URSSAF avec le CA encaissé', ca, T.cotisations);
    add('cfp', 'Contribution à la formation professionnelle', cfp, 'Prélevée avec les cotisations', ca, T.cfp);
    if (vl) add('vl', `Versement libératoire de l’impôt (${(T.vl * 100).toFixed(1).replace('.', ',')} %)`, vl, 'Remplace l’impôt sur le revenu de ce CA ; sous condition de revenu du foyer', ca, T.vl);
    else add('ir', `Impôt sur le revenu — indicatif (TMI ${Math.round(m.tmi * 100)} % × CA après abattement ${Math.round(T.abattement * 100)} %)`, out.irIndicatif, 'Estimation : le calcul exact est dans l’écran Impôt (barème, quotient familial, autres revenus)', imposable, m.tmi);
    out.resultatAvantImpot = ca - urssaf - cfp;   // en micro, les frais ne sont pas déductibles : le revenu est le CA moins les cotisations
    out.resultatNet = ca - urssaf - cfp - vl - out.irIndicatif;
    out.total = urssaf + cfp + vl + out.irIndicatif;
    out.dividendes = null;
    notes.push('Micro-entreprise : les frais réels ne sont pas déductibles (abattement forfaitaire). Les cotisations se calculent sur le CA encaissé.');
    if (T.vl && !m.versement_liberatoire) notes.push('Le versement libératoire est possible si le revenu fiscal de référence du foyer (N-2) ne dépasse pas ' + Math.round(T.vlRfrParPart) + ' € par part.');
  } else if (m.regimeIR === 'reel_ir') {
    const avant = ca - frais;
    const tns = R.tns || rulesFor(2026).tns;
    const cot = avant > 0 ? avant * tns.cotisationsSurNet / (1 + tns.cotisationsSurNet) : 0;
    out.cotisationsTNS = cot; out.resultatAvantImpot = avant;
    out.irIndicatif = Math.max(0, avant - cot) * m.tmi * out.part;
    add('tns', `Cotisations sociales du dirigeant (≈ ${Math.round(tns.cotisationsSurNet / (1 + tns.cotisationsSurNet) * 100)} % du bénéfice avant cotisations)`, cot, 'Ordre de grandeur (SSI) : dépend du revenu, de la caisse et des régularisations', avant);
    add('ir', `Impôt sur le revenu — indicatif (TMI ${Math.round(m.tmi * 100)} %)`, out.irIndicatif, 'Le bénéfice est imposé à l’IR au nom de l’exploitant (ma part)', Math.max(0, avant - cot), m.tmi);
    out.resultatNet = avant - cot - Math.max(0, avant - cot) * m.tmi;
    out.total = cot + out.irIndicatif;
    estimated = true;
    notes.push('EURL à l’IR / EI au réel : bénéfice imposé à l’IR ; cotisations TNS estimées à ≈ 45 % du revenu net (à affiner avec l’URSSAF/SSI).');
  } else {
    // Société à l'IS : rémunération du dirigeant, IS, dividendes, flat tax sur MES parts
    const plan = m.remuneration;
    const salaireNet = salaireRecord > 0 ? salaireRecord : plan.salaire_net_annuel;
    const sasu = m.social === 'assimile_salarie';
    const coefSalaire = sasu ? 1 + (R.sasu || rulesFor(2026).sasu).chargesTotalesSurNet : 1 + (R.tns || rulesFor(2026).tns).cotisationsSurNet;
    const coutSalaire = salaireRecord > 0 ? salaireRecord : salaireNet * coefSalaire;
    out.salaire = { net: salaireNet, cout: coutSalaire, recorded: salaireRecord > 0 };
    const avantIS = ca - frais - coutSalaire;
    const mois = exerciceMonths(m, y);
    const IS = calculIS(y, avantIS, { moisExercice: mois });
    out.is = IS.is; out.resultatAvantImpot = avantIS; out.resultatNet = avantIS - IS.is;
    const reserve = Math.max(0, Math.min(0.05 * Math.max(0, out.resultatNet), 0.1 * m.capital));
    const distribuable = Math.max(0, out.resultatNet - reserve) * plan.distribution_pct;
    const divPlan = dividendesRecord > 0 ? dividendesRecord : (plan.dividendes_annuels > 0 ? plan.dividendes_annuels : distribuable);
    const mesDiv = divPlan * out.part;
    const ft = flatTax(y, mesDiv);
    const tns = R.tns || rulesFor(2026).tns;
    const excedent = m.social === 'tns' && m.gerant_majoritaire ? Math.max(0, mesDiv - tns.dividendeFranchisePctCapital * m.capital * out.part) : 0;
    const cotDiv = excedent * tns.cotisationsSurNet;
    out.dividendes = { distribuable, reserveLegale: reserve, distribues: divPlan, mesParts: mesDiv, flatTax: ft, cotisationsExcedent10pct: cotDiv, net: ft.net - cotDiv, recorded: dividendesRecord > 0 };
    out.chargesSalaire = salaireRecord > 0 ? 0 : coutSalaire - salaireNet;     // charges sociales estimées sur la rémunération prévue
    out.total = IS.is + out.chargesSalaire;                                   // à mettre de côté côté entreprise (la flat tax est personnelle)
    add('is', `Impôt sur les sociétés (15 % jusqu’à ${Math.round(IS.plafond).toLocaleString('fr-FR')} €, puis 25 %)`, IS.is, 'Acomptes trimestriels puis solde après la clôture', Math.max(0, avantIS));
    if (coutSalaire > 0) add('salaire', sasu ? 'Charges sociales sur la rémunération (salariales + patronales, ≈ 80 % du net)' : 'Cotisations sociales du gérant (≈ 45 % du net)', coutSalaire - salaireNet, salaireRecord > 0 ? 'Salaire enregistré : charges déjà incluses' : 'Estimation à partir du salaire net prévu', salaireNet);
    if (mesDiv > 0) {
      add('flat', `Flat tax sur mes dividendes (${(ft.taux * 100).toFixed(1).replace('.', ',')} % : ${(R.pfu || rulesFor(2026).pfu).ir * 100} % IR + ${((R.pfu || rulesFor(2026).pfu).ps * 100).toFixed(1).replace('.', ',')} % prél. sociaux)`, ft.total, `Sur ${Math.round(mesDiv).toLocaleString('fr-FR')} € de dividendes (ma part ${Math.round(out.part * 100)} %). Option pour le barème possible (écran Impôt).`, mesDiv, ft.taux);
      if (cotDiv > 0) add('divtns', 'Cotisations sociales sur les dividendes au-delà de 10 % du capital (gérant majoritaire)', cotDiv, 'Règle des 10 % du capital social (TNS)', excedent, tns.cotisationsSurNet);
    }
    estimated = true;
    notes.push(`Résultat avant IS = CA ${Math.round(ca).toLocaleString('fr-FR')} € − frais − coût de la rémunération. Dividendes = résultat net − réserve légale (5 % jusqu’à 10 % du capital) × taux de distribution.`);
  }
  const payeDeja = cotisationsPayees + vlPaye + isPaye;
  out.payeDeja = payeDeja;
  out.resteAMettreDeCote = Math.max(0, out.total - payeDeja);
  out.estimated = estimated;
  return out;
}
function exerciceMonths(m, y) {
  if (!m.date_debut || m.date_debut.slice(0, 4) !== String(y)) return 12;
  const [mm, dd] = m.cloture.split('-').map(Number);
  const end = m.premiere_cloture && m.premiere_cloture.slice(0, 4) === String(y) ? m.premiere_cloture : iso(+y, mm, dd);
  return Math.max(1, Math.min(12, Math.round(daysBetween(m.date_debut, end) / 30.4375)));
}

// Montants à mettre de côté pour UN paiement reçu (ht en EUR ; ttc pour la TVA à reverser)
export function reserveOnPayment(ctx, projet, { ht, ttc = ht, date, year }) {
  const m = normalizeMeta(projet.meta, projet, ctx), y = String(year || date.slice(0, 4)), items = [];
  const part = Number(projet.part ?? 1);
  if (ttc - ht > 0.005) items.push({ key: 'tva', label: 'TVA collectée à reverser', amount: ttc - ht });
  if (m.regimeIR === 'micro') {
    const T = tauxMicro(ctx, projet, y), acre = acreInfo(m, y);
    items.push({ key: 'urssaf', label: 'Cotisations URSSAF + formation', amount: ht * (T.cotisations * acreCoefAt(acre, date) + T.cfp) });
    if (T.vl) items.push({ key: 'vl', label: 'Versement libératoire (impôt)', amount: ht * T.vl });
    else items.push({ key: 'ir', label: 'Impôt sur le revenu (indicatif)', amount: ht * (1 - T.abattement) * m.tmi * part });
  } else if (m.regimeIR === 'reel_ir') {
    const tns = rulesFor(y).tns || rulesFor(2026).tns, b = ht * m.marge_estimee;
    const cot = b * tns.cotisationsSurNet / (1 + tns.cotisationsSurNet);
    items.push({ key: 'tns', label: 'Cotisations dirigeant (estimées)', amount: cot });
    items.push({ key: 'ir', label: 'Impôt sur le revenu (indicatif)', amount: (b - cot) * m.tmi * part });
  } else {
    const f = entrepriseFinance(ctx, projet, y);
    const eff = f.resultatAvantImpot > 0 ? f.is / f.resultatAvantImpot : 0.15, b = ht * m.marge_estimee, is = b * eff;
    items.push({ key: 'is', label: 'Impôt sur les sociétés (estimé sur la marge)', amount: is });
    if (m.regimeIR === 'is' && m.social === 'assimile_salarie' || m.social === 'tns') items.push({ key: 'flat', label: 'Flat tax si tout le bénéfice est distribué (ma part)', amount: flatTax(y, (b - is) * part).total });
  }
  const total = items.reduce((s, i) => s + i.amount, 0);
  return { items: items.map((i) => ({ ...i, amount: round2(i.amount) })), total: round2(total), net: round2(ttc - total) };
}

// ───────────────────────────── fiscalIncome : contrat avec le module Impôt ─────────────────────────────
export function fiscalIncome(ctx, projet, year) {
  const f = entrepriseFinance(ctx, projet, year), m = normalizeMeta(projet.meta, projet, ctx), part = Number(projet.part ?? 1);
  const notes = [...f.notes];
  const base = { projetId: projet.id, nom: projet.nom, forme: m.forme, regimeIR: m.regimeIR, part, ca: f.ca, bnc: 0, bic: 0, microAbattement: null,
    versementLiberatoire: false, salaireNetImposable: 0, dividendesBruts: 0, cotisationsDeductibles: 0, estimated: f.estimated, notes };
  const bucket = m.nature === 'bnc' ? 'bnc' : 'bic';
  if (m.regimeIR === 'micro') {
    const T = tauxMicro(ctx, projet, year);
    const ca = f.ca * part, abatt = Math.max(ca * T.abattement, ca > 0 ? T.abattementMin : 0);
    base[bucket] = round2(Math.max(0, ca - abatt));
    base.microAbattement = { taux: T.abattement, montant: round2(Math.min(abatt, ca)) };
    base.versementLiberatoire = !!m.versement_liberatoire;
    base.caMicro = round2(ca);                                      // CA brut (ma part) : sert au revenu fiscal de référence
    if (base.versementLiberatoire) notes.push('Versement libératoire : l’IR de ce CA est déjà payé ; le revenu compte dans le RFR mais sort du barème.');
  } else if (m.regimeIR === 'reel_ir') {
    base[bucket] = round2(Math.max(0, f.resultatAvantImpot * part));
    base.cotisationsDeductibles = round2(f.cotisationsTNS * part);
  } else {
    base.salaireNetImposable = round2(m.je_suis_dirigeant && f.salaire ? f.salaire.net : 0);
    base.dividendesBruts = round2(f.dividendes ? f.dividendes.mesParts : 0);
  }
  return base;
}

// ───────────────────────────── Planning de déclarations et de paiements ─────────────────────────────
// Libellés et dates générés selon le régime. `approx` : la date exacte dépend du département/SIREN/calendrier officiel de l'année.
export const DECL_LABELS = {
  urssaf: 'Déclaration du CA à l’URSSAF (+ paiement des cotisations)', cfe_decl: 'CFE : déclaration initiale (formulaire 1447-C)', cfe_paiement: 'CFE : paiement',
  ir_2042: 'Déclaration de revenus (2042 + 2042-C-PRO)', tva_ca3: 'TVA : déclaration CA3', tva_ca12: 'TVA : déclaration annuelle CA12', tva_acompte_juillet: 'TVA : acompte de juillet (CA12)', tva_acompte_decembre: 'TVA : acompte de décembre (CA12)',
  is_acompte: 'IS : acompte (relevé 2571)', is_solde: 'IS : solde (relevé 2572)', liasse: 'Liasse fiscale / déclaration de résultat', ag: 'Approbation des comptes (assemblée)', greffe: 'Dépôt des comptes au greffe',
  das2: 'DAS2 : honoraires versés à des tiers (> 1 200 €)', dsn: 'DSN et cotisations sur salaire', pfnl: 'Prélèvement à la source sur dividendes (12,8 %)',
};
function periodsBetween(from, to) { const out = []; for (let k = from; k <= to; k = addMonths(k, 1)) out.push(k); return out; }

// Échéances DONT LA DATE LIMITE tombe dans l'année civile `year` (calendrier de l'entreprise)
export function deadlinesFor(projet, year, ctx = null) {
  const m = normalizeMeta(projet.meta, projet, ctx), out = [];
  const Y = Number(year), start = m.date_debut || '';
  const startYM = start.slice(0, 7), startY = start ? +start.slice(0, 4) : null;
  const push = (code, periode, date, o = {}) => {
    if (date.slice(0, 4) !== String(Y)) return;
    out.push({ projetId: projet.id, nom: projet.nom, code, periode, label: o.label || DECL_LABELS[code] || code, date, approx: !!o.approx, conditional: !!o.conditional, kind: o.kind || 'declaration', note: o.note || '' });
  };
  const live = (ym) => !startYM || ym >= startYM;     // la période est postérieure au démarrage
  // — URSSAF / SSI (micro) : mensuel ou trimestriel
  if (m.regimeIR === 'micro') {
    if (m.urssaf_periodicite === 'mensuelle') {
      for (const P of periodsBetween(`${Y - 1}-12`, `${Y}-11`)) if (live(P)) push('urssaf', P, bizNext(lastDay(addMonths(P, 1))), { label: `Déclaration URSSAF — CA de ${monthLong(P)}${m.versement_liberatoire ? ' (+ versement libératoire)' : ''}`, kind: 'paiement' });
    } else {
      for (const Q of [`${Y - 1}-T4`, `${Y}-T1`, `${Y}-T2`, `${Y}-T3`]) {
        const [qy, qq] = Q.split('-T').map(Number); const endYM = `${qy}-${pad(qq * 3)}`;
        if (!live(endYM)) continue;
        const due = qq === 1 ? iso(qy, 4, 30) : qq === 2 ? iso(qy, 7, 31) : qq === 3 ? iso(qy, 10, 31) : iso(qy + 1, 1, 31);
        push('urssaf', Q, bizNext(due), { label: `Déclaration URSSAF — CA du trimestre T${qq} ${qy}${m.versement_liberatoire ? ' (+ versement libératoire)' : ''}`, kind: 'paiement' });
      }
    }
  }
  // — CFE (toutes entreprises) : déclaration initiale l'année de création, paiement dès l'année suivante (exonération la 1re année)
  if (startY) {
    push('cfe_decl', String(startY), iso(startY, 12, 31), { label: 'CFE : déclaration initiale (1447-C) — exonération la 1re année' });
    for (let cy = startY + 1; cy <= Y; cy++) push('cfe_paiement', String(cy), bizNext(iso(cy, 12, 15)), { kind: 'paiement', label: `CFE ${cy} : paiement`, note: 'Exonération si CA ≤ 5 000 € ; réduction de 50 % la 2e année dans certains cas' });
  }
  // — Impôt sur le revenu du foyer : revenus professionnels (micro, EI, EURL IR) ou salaire/dividendes (IS)
  if (!startY || Y - 1 >= startY) push('ir_2042', String(Y - 1), iso(Y, 5, 28), { approx: true, label: `Déclaration de revenus ${Y - 1} (2042 + 2042-C-PRO)${m.regimeIR === 'is' ? ' : salaires et dividendes' : ''}`, note: 'Date limite selon le département (fin mai – début juin)' });
  // — TVA (franchise : aucune déclaration)
  if (m.tva_regime !== 'franchise') {
    const simplifie = m.tva_regime === 'reel_simplifie';
    if (simplifie && Y <= 2026) {
      if (live(`${Y - 1}-12`)) push('tva_ca12', String(Y - 1), secondBizDayAfterMay1(Y));
      push('tva_acompte_juillet', String(Y), iso(Y, 7, 15), { kind: 'paiement' });
      push('tva_acompte_decembre', String(Y), iso(Y, 12, 15), { kind: 'paiement' });
    } else {
      // Réel simplifié supprimé au 1er janvier 2027 (LF 2025 art. 38) : dernière CA12 le 4 mai 2027, puis CA3 (trimestrielle par défaut)
      if (simplifie && Y === 2027) push('tva_ca12', '2026', secondBizDayAfterMay1(2027), { label: 'TVA : dernière CA12 (exercice 2026)', note: 'Le régime simplifié est supprimé au 1er janvier 2027' });
      const from = simplifie ? '2027-01' : '0000-00';
      const okP = (ym) => live(ym) && ym >= from;
      const note = 'Date entre le 15 et le 24 selon le SIREN / le département';
      if (m.tva_periodicite === 'mensuelle') {
        for (const P of periodsBetween(`${Y - 1}-12`, `${Y}-11`)) if (okP(P)) { const n = addMonths(P, 1); push('tva_ca3', P, bizNext(iso(+n.slice(0, 4), +n.slice(5, 7), 20)), { approx: true, kind: 'paiement', label: `TVA CA3 — ${monthLong(P)}`, note }); }
      } else {
        for (const Q of [`${Y - 1}-T4`, `${Y}-T1`, `${Y}-T2`, `${Y}-T3`]) {
          const [qy, qq] = Q.split('-T').map(Number);
          if (!okP(`${qy}-${pad(qq * 3)}`)) continue;
          const due = qq === 4 ? iso(qy + 1, 1, 20) : iso(qy, qq * 3 + 1, 20);
          push('tva_ca3', Q, bizNext(due), { approx: true, kind: 'paiement', label: `TVA CA3 — T${qq} ${qy}`, note });
        }
      }
    }
  }
  // — Entreprise au réel (EI réel, EURL IR) : déclaration de résultat ; sociétés à l'IS : IS, liasse, comptes
  if (m.regimeIR === 'reel_ir') {
    for (const ey of [Y - 1]) if (!startY || ey >= startY) push('liasse', String(ey), secondBizDayAfterMay1(Y), { label: `Déclaration de résultat ${ey} (2035 / 2031) — avec la 2042-C-PRO`, note: 'Déposée en ligne avec la déclaration de revenus des professionnels' });
    if (m.social === 'tns') push('das2', String(Y - 1), secondBizDayAfterMay1(Y), { conditional: true, approx: true });
  }
  if (m.regimeIR === 'is') {
    const [cm, cd] = m.cloture.split('-').map(Number);
    const firstEnd = m.premiere_cloture || (start ? (iso(startY, cm, cd) >= start ? iso(startY, cm, cd) : iso(startY + 1, cm, cd)) : '');
    // exercices clos dans [Y-1, Y]
    const closings = [];
    for (const cy of [Y - 1, Y]) { const e = iso(cy, cm, Math.min(cd, +lastDay(`${cy}-${pad(cm)}`).slice(8, 10))); if (!firstEnd || e >= firstEnd) closings.push(e); }
    for (const e of closings) {
      const ey = +e.slice(0, 4), isFirst = firstEnd && e === firstEnd;
      const sm5 = addMonths(e.slice(0, 7), 5), solde = bizNext(`${sm5}-15`);   // 15 jours après la fin du 4e mois suivant la clôture (31/12 → 15 mai)
      push('is_solde', e, solde, { kind: 'paiement', label: `IS : solde de l'exercice clos le ${e.split('-').reverse().join('/')} (relevé 2572)` });
      const liasse = cm === 12 && cd === 31 ? secondBizDayAfterMay1(ey + 1) : bizNext(addMonthsISO(e, 3));
      push('liasse', e, liasse, { label: `Liasse fiscale (2065 + 2050…) — exercice clos le ${e.split('-').reverse().join('/')}`, note: 'Dépôt en ligne (EDI-TDFC)' });
      push('das2', e, liasse, { conditional: true, approx: true });
      const ag = bizNext(addMonthsISO(e, 6));
      push('ag', e, ag, { label: `Approbation des comptes de l'exercice clos le ${e.split('-').reverse().join('/')} (6 mois max)`, note: 'Procès-verbal ou décision de l\'associé unique' });
      push('greffe', e, bizNext(addMonthsISO(ag, 1)), { approx: true, label: `Dépôt des comptes au greffe — exercice ${e.split('-').reverse().join('/')}`, note: '1 mois après l’approbation (2 mois si dépôt en ligne)' });
    }
    // acomptes d'IS de l'exercice N (15 du 3e, 6e, 9e et 12e mois de l'exercice), pas pour le 1er exercice
    for (const e of [iso(Y, cm, Math.min(cd, +lastDay(`${Y}-${pad(cm)}`).slice(8, 10))), iso(Y + 1, cm, Math.min(cd, +lastDay(`${Y + 1}-${pad(cm)}`).slice(8, 10)))]) {
      if (firstEnd && e <= firstEnd) continue;
      const startEx = addDaysISO(addMonthsISO(e, -12), 1), sm = startEx.slice(0, 7);
      [2, 5, 8, 11].forEach((off, k) => { const ym = addMonths(sm, off); push('is_acompte', `${e}#${k + 1}`, bizNext(`${ym}-15`), { kind: 'paiement', label: `IS : acompte n° ${k + 1} de l'exercice clos le ${e.split('-').reverse().join('/')}`, note: 'Pas d’acompte si l’IS de l’exercice précédent est inférieur à 3 000 €' }); });
    }
    if (m.social === 'assimile_salarie' && (m.remuneration.salaire_net_annuel > 0 || m.remuneration.mode !== 'dividendes')) {
      for (const P of periodsBetween(`${Y - 1}-12`, `${Y}-11`)) if (live(P)) push('dsn', P, bizNext(`${addMonths(P, 1)}-15`), { kind: 'paiement', label: `DSN et cotisations — ${monthLong(P)}`, note: 'Le 5 ou le 15 du mois suivant selon l’effectif' });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.code.localeCompare(b.code)));
}

// Clé d'une échéance dans la table `declarations`
export const declKey = (d) => `${d.projetId || ''}|${d.code}|${d.periode}`;
function doneMap(ctx) { const m = new Map(); for (const r of ctx.data.declarations || []) m.set(`${r.projetId || ''}|${r.code}|${r.periode}`, r); return m; }

// Échéances à venir (et en retard récentes) de toutes les entreprises, non cochées « faites » incluses avec done=true
export function upcomingDeadlines(ctx, today, days = 45, { includeDone = false, lateDays = 30 } = {}) {
  const done = doneMap(ctx), out = [];
  const Y = +today.slice(0, 4);
  for (const p of entreprisesOf(ctx)) {
    const m = normalizeMeta(p.meta, p, ctx);
    const seen = new Set();
    for (const y of [Y - 1, Y, Y + 1]) for (const d of deadlinesFor(p, y, ctx)) {
      const key = `${d.code}|${d.periode}`; if (seen.has(key)) continue; seen.add(key);
      const inDays = daysBetween(today, d.date);
      if (inDays > days || inDays < -lateDays) continue;
      const rec = done.get(declKey(d));
      if (rec && !includeDone) continue;
      if (d.conditional && !rec) continue;                       // échéances « si applicable » : affichées dans l'écran, pas dans les alertes
      if (m.date_debut && d.date < m.date_debut) continue;
      out.push({ ...d, inDays, late: inDays < 0 && !rec, done: !!rec, recordId: rec ? rec.id : null, statut: rec ? rec.statut : '' });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

// ───────────────────────────── Alertes (mêmes formes que core.computeAlerts) ─────────────────────────────
export function entrepriseAlerts(ctx) {
  const out = [], today = ctx.today, cur = today.slice(0, 7);
  const eur0 = (v) => `${Math.round(v).toLocaleString('fr-FR')} €`;
  for (const p of entreprisesOf(ctx)) {
    const m = normalizeMeta(p.meta, p, ctx);
    const nom = entreprisesOf(ctx).length > 1 ? ` (${p.nom})` : '';
    if (m.date_debut && m.date_debut > today) {
      const j = daysBetween(today, m.date_debut);
      if (j <= 30) out.push({ id: `ent_demarrage:${p.id}`, kind: 'info', ic: 'brief', title: `${p.nom} démarre dans ${j} jour${j > 1 ? 's' : ''}`, sub: `Début d’activité le ${m.date_debut.split('-').reverse().join('/')} : vérifie ta checklist de lancement`, go: '#/entreprise', label: 'Préparer' });
      continue;
    }
    const y = String(Math.max(+today.slice(0, 4), m.date_debut ? +m.date_debut.slice(0, 4) : 0));
    const fy = entrepriseYear(ctx, p, y);
    if (fy.tvaSeuilMaj != null && fy.done >= fy.tvaSeuilMaj) out.push({ id: `seuil_tva_maj:${p.id}`, kind: 'bad', ic: 'alert', title: `Seuil majoré de TVA dépassé${nom}`, sub: `${eur0(fy.done)} de CA ${y} : la TVA est due dès maintenant (seuil ${eur0(fy.tvaSeuilMaj)})`, go: '#/entreprise', label: 'Voir' });
    else if (fy.tvaSeuil != null && fy.done >= fy.tvaSeuil) out.push({ id: `seuil_tva:${p.id}`, kind: 'warn', ic: 'alert', title: `Franchise de TVA dépassée${nom}`, sub: `${eur0(fy.done)} de CA ${y} (seuil ${eur0(fy.tvaSeuil)}) : TVA due au 1er janvier`, go: '#/entreprise', label: 'Voir' });
    else if (fy.plafondCA != null && fy.total > fy.plafondCA) out.push({ id: `seuil_micro:${p.id}`, kind: 'info', ic: 'info', title: `Plafond micro ${y} dépassé en projection${nom}`, sub: `${eur0(fy.total)} planifiés vs ${eur0(fy.plafondCA)} de plafond`, go: '#/entreprise', label: 'Détails' });
    else if (fy.plafondCA != null && fy.done >= 0.85 * fy.plafondCA) out.push({ id: `seuil_micro:${p.id}`, kind: 'warn', ic: 'alert', title: `Plafond micro à 85 %${nom}`, sub: `${eur0(fy.done)} sur ${eur0(fy.plafondCA)} : prépare la sortie du régime micro`, go: '#/entreprise', label: 'Voir' });
    // jours travaillés : fin de mois (à partir du 25) tant que le mois n'est pas facturé
    const day = +today.slice(8, 10);
    if (day >= 25 && !fixedInvoiceForMonth(ctx, p, cur)) out.push({ id: `ent_jours:${p.id}:${cur}`, kind: 'info', ic: 'calendar', title: `Jours travaillés en ${monthLong(cur).split(' ')[0]} ?${nom}`, sub: 'Renseigne les jours par client pour préparer la facture', go: `#/entreprise?jours=${cur}`, label: 'Facturer' });
  }
  for (const d of upcomingDeadlines(ctx, today, 7)) {
    out.push({ id: `decl:${d.projetId}:${d.code}:${d.periode}`, kind: d.late || d.inDays <= 2 ? 'warn' : 'info', ic: 'calendar', title: `${d.late ? 'En retard : ' : ''}${d.label}`, sub: `${d.nom} — ${d.late ? `échéance dépassée de ${-d.inDays} j` : d.inDays === 0 ? 'aujourd’hui' : `le ${d.date.split('-').reverse().join('/')} (dans ${d.inDays} j)`}`, go: '#/entreprise', label: 'Voir' });
  }
  return out;
}
// Une facture du mois est-elle déjà envoyée/payée pour au moins un client ? (sert à ne pas redemander les jours)
function fixedInvoiceForMonth(ctx, projet, month) {
  const own = owns(ctx, projet);
  return (ctx.data.invoices || []).some((i) => own(i) && i.periode === month && i.statut !== 'Planifiée');
}

// ───────────────────────────── Santé de l'entreprise (indicateurs) ─────────────────────────────
export function entrepriseHealth(ctx, projets = entreprisesOf(ctx)) {
  const ind = [], today = ctx.today;
  const eur0 = (v) => `${Math.round(v).toLocaleString('fr-FR')} €`;
  for (const p of projets) {
    const m = normalizeMeta(p.meta, p, ctx);
    if (m.date_debut && m.date_debut > today) continue;
    const tag = projets.length > 1 ? ` — ${p.nom}` : '';
    const y = today.slice(0, 4), fy = entrepriseYear(ctx, p, y), fin = entrepriseFinance(ctx, p, y);
    const own = owns(ctx, p);
    // 1. plafond de CA / franchise de TVA
    if (fy.plafondCA != null && fy.plafondCA > 0) {
      const r = fy.total / fy.plafondCA;
      ind.push({ id: `ent_plafond:${p.id}`, label: `Plafond de CA${tag}`, value: r, fmt: 'pct', level: r < 0.8 ? 'good' : r < 1 ? 'warn' : 'bad',
        text: r < 0.8 ? `${eur0(fy.total)} projetés sur ${eur0(fy.plafondCA)} de plafond : marge confortable.` : r < 1 ? `Tu approches du plafond : il reste ${eur0(Math.max(0, fy.plafondCA - fy.total))}.` : `Le CA projeté dépasse le plafond micro de ${eur0(fy.total - fy.plafondCA)}.` });
    } else if (fy.tvaSeuil != null) {
      const r = fy.total / fy.tvaSeuil;
      ind.push({ id: `ent_tva:${p.id}`, label: `Franchise de TVA${tag}`, value: r, fmt: 'pct', level: r < 0.8 ? 'good' : r < 1 ? 'warn' : 'bad', text: r < 1 ? `Il reste ${eur0(fy.tvaSeuil - fy.total)} avant la TVA.` : 'Seuil de franchise de TVA dépassé.' });
    }
    // 2. encaissement : factures envoyées en retard
    const late = (ctx.data.invoices || []).filter((i) => own(i) && i.statut === 'Envoyée' && i.emission && daysBetween(i.emission, today) > 30);
    if ((ctx.data.invoices || []).some(own)) ind.push({ id: `ent_retards:${p.id}`, label: `Factures en retard${tag}`, value: late.length, fmt: 'n', level: late.length ? 'bad' : 'good', text: late.length ? `${late.length} facture(s) impayée(s) depuis plus de 30 jours : relance tes clients.` : 'Aucune facture en retard de paiement.' });
    // 3. concentration clients
    const byClient = new Map();
    for (const i of ctx.data.invoices || []) if (own(i) && i.statut !== 'Planifiée') byClient.set(i.client, (byClient.get(i.client) || 0) + i.ht * rateOf(ctx, i.devise));
    const tot = [...byClient.values()].reduce((s, v) => s + v, 0);
    if (tot > 0 && byClient.size) { const [k, v] = [...byClient.entries()].sort((a, b) => b[1] - a[1])[0]; const sh = v / tot;
      ind.push({ id: `ent_clients:${p.id}`, label: `Dépendance client${tag}`, value: sh, fmt: 'pct', level: sh <= 0.6 ? 'good' : sh <= 0.85 ? 'warn' : 'bad', text: `${Math.round(sh * 100)} % du CA vient de « ${k} ».${sh > 0.85 ? ' Un 2e client réduirait le risque.' : ''}` }); }
    // 4. provision des charges : trésorerie de l'entreprise vs charges restant à payer
    if (fin.ca > 0) {
      const couv = fin.resteAMettreDeCote > 0 ? fin.tresorerie / fin.resteAMettreDeCote : 9;
      ind.push({ id: `ent_provision:${p.id}`, label: `Charges provisionnées${tag}`, value: Math.min(couv, 9), fmt: 'pct', level: couv >= 1.2 ? 'good' : couv >= 1 ? 'warn' : 'bad',
        text: couv >= 1 ? `La trésorerie (${eur0(fin.tresorerie)}) couvre les ${eur0(fin.resteAMettreDeCote)} de charges et impôts estimés restants.` : `Il manque ${eur0(fin.resteAMettreDeCote - fin.tresorerie)} pour couvrir les charges et impôts estimés : mets de côté.` });
    }
    // 5. déclarations en retard
    const lateDecl = upcomingDeadlines(ctx, today, 0, { lateDays: 90 }).filter((d) => d.projetId === p.id && d.late);
    ind.push({ id: `ent_declarations:${p.id}`, label: `Déclarations${tag}`, value: lateDecl.length, fmt: 'n', level: lateDecl.length ? 'bad' : 'good', text: lateDecl.length ? `${lateDecl.length} échéance(s) dépassée(s) non cochée(s) : ${lateDecl.slice(0, 2).map((d) => d.label).join(' ; ')}.` : 'Toutes les déclarations échues sont à jour.' });
  }
  return ind;
}

// ───────────────────────────── Facturation du mois ─────────────────────────────
// Jours ouvrés (lun-ven, hors jours fériés) d'un mois : aide à la saisie des jours travaillés
export function workingDays(month) {
  let n = 0; for (let d = 1; d <= +lastDay(month).slice(8, 10); d++) { const w = wday(`${month}-${pad(d)}`); if (w !== 0 && w !== 6) n++; }
  return n;
}
// Lignes de facturation d'un mois par client de l'entreprise
export function billingLines(ctx, projet, month) {
  const own = owns(ctx, projet);
  const clients = (ctx.data.clients || []).filter(own);
  return clients.map((c) => {
    const inv = (ctx.data.invoices || []).find((i) => own(i) && i.client === c.nom && i.periode === month);
    return { client: c, invoice: inv || null, jours: inv ? inv.jours : 0, tjm: inv ? inv.tjm : c.tjm, devise: inv ? inv.devise : c.devise, tva: inv ? inv.tva : c.tva, locked: !!inv && inv.statut !== 'Planifiée' };
  });
}
export function invoiceAmounts({ jours, tjm, tva }) {
  const ht = round2((Number(jours) || 0) * (Number(tjm) || 0));
  const tv = round2(ht * (Number(tva) || 0));
  return { ht, tva: tv, ttc: round2(ht + tv) };
}
// Mentions obligatoires d'une facture (lignes de texte) selon la forme et le régime de TVA
export function invoiceMentions(projet, inv, { today = '' } = {}) {
  const m = normalizeMeta(projet.meta, projet);
  const F = FORMES[m.forme];
  const l = [];
  if (m.tva_regime === 'franchise' || !(inv.tva > 0)) l.push('TVA non applicable, art. 293 B du CGI');
  l.push('Catégorie d’opération : prestation de services');
  const due = inv.echeance || (inv.emission ? addDaysISO(inv.emission, 30) : '');
  l.push(`Paiement à 30 jours${due ? ` (échéance : ${due.split('-').reverse().join('/')})` : ''}`);
  l.push('Pas d’escompte pour paiement anticipé');
  l.push('Pénalités de retard : trois fois le taux d’intérêt légal, exigibles sans rappel (art. L441-10 du Code de commerce)');
  l.push('Indemnité forfaitaire pour frais de recouvrement en cas de retard : 40 € (art. D441-5 du Code de commerce)');
  if (F.individuelle) l.push(`Entrepreneur individuel (EI)${m.siret ? ` — SIRET ${m.siret}` : ''}`);
  else l.push(`${projet.nom} — ${F.short}${m.capital ? ` au capital de ${Math.round(m.capital).toLocaleString('fr-FR')} €` : ''}${m.siret ? ` — SIREN/SIRET ${m.siret}` : ''}`);
  l.push('Facturation électronique : mentions SIREN du client et adresse de livraison si différente (obligatoires avec la réforme)');
  return l;
}
export function invoiceCsv(projet, invs, ctx = null) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['Numéro', 'Client', 'Période', 'Jours', 'TJM', 'Devise', 'Montant HT', 'TVA', 'Montant TTC', 'Date facture', 'Statut', 'Date paiement', 'Réf. plateforme'];
  return '\uFEFF' + [head.map(q).join(';'), ...invs.map((i) => [i.numero, i.client, i.periode, i.jours, i.tjm, i.devise, i.ht, Math.round(i.tva * 100) + ' %', i.ttc, i.emission || '', i.statut, i.paiement || '', i.refExt || ''].map(q).join(';'))].join('\n');
}
// Texte à coller dans Tiime (ou tout autre outil) pour créer la facture : une ligne par prestation
export function invoiceLinesText(projet, inv) {
  const tva = Math.round((inv.tva || 0) * 100);
  return [`Client : ${inv.client}`, `Désignation : Prestation de conseil — ${monthLong(inv.periode)}`, `Quantité : ${inv.jours} jour(s)`, `Prix unitaire HT : ${inv.tjm} ${inv.devise}`, `TVA : ${tva} %`, `Total HT : ${inv.ht} ${inv.devise}`, `Total TTC : ${inv.ttc} ${inv.devise}`].join('\n');
}

// ───────────────────────────── Vue comparative de toutes les entreprises ─────────────────────────────
// Jamais de total mélangé : chaque ligne est une entreprise. « mesParts » = ce qui me revient.
export function entreprisesSummary(ctx, year) {
  return entreprisesOf(ctx).map((p) => {
    const m = normalizeMeta(p.meta, p, ctx), f = entrepriseFinance(ctx, p, year), fy = entrepriseYear(ctx, p, year);
    return { projet: p, meta: m, part: Number(p.part ?? 1), ca: f.ca, planifie: fy.planned + fy.billed, charges: f.total, resultat: f.resultatNet, tresorerie: f.tresorerie,
      dividendesMesParts: f.dividendes ? f.dividendes.mesParts : 0, flatTax: f.dividendes ? f.dividendes.flatTax.total : 0, started: started(m, ctx.today), estimated: f.estimated };
  });
}

// ───────────────────────────── Aide à la création : obligations selon les choix ─────────────────────────────
export function obligationsResume(meta) {
  const m = normalizeMeta(meta), l = [], F = FORMES[m.forme];
  if (m.regimeIR === 'micro') {
    const R = rulesFor(m.date_debut ? m.date_debut.slice(0, 4) : 2026).micro;
    l.push(`Plafond de CA : ${Math.round(R.plafond[m.nature]).toLocaleString('fr-FR')} € HT par an${m.date_debut ? ' (proratisé la 1re année)' : ''}`);
    l.push(`Cotisations URSSAF : ${(R.cotisations[m.nature === 'bnc' && m.caisse === 'cipav' ? 'bnc_cipav' : m.nature] * 100).toFixed(1).replace('.', ',')} % du CA encaissé${m.acre ? ' (réduit pendant l’ACRE)' : ''}`);
    l.push(m.versement_liberatoire ? `Versement libératoire : ${(R.vl[m.nature] * 100).toFixed(1).replace('.', ',')} % du CA (pas d’IR en plus sur ce CA)` : `Impôt sur le revenu : abattement forfaitaire de ${Math.round(R.abattement[m.nature] * 100)} % puis barème`);
    l.push(`Déclaration du CA à l’URSSAF : ${m.urssaf_periodicite === 'mensuelle' ? 'chaque mois' : 'chaque trimestre'}, même à 0 €`);
  } else if (m.regimeIR === 'reel_ir') {
    l.push('Bénéfice imposé à l’IR (déclaration de résultat 2035) ; cotisations TNS ≈ 45 % du revenu net');
  } else {
    l.push('IS : 15 % jusqu’à 42 500 € de bénéfice puis 25 % ; acomptes trimestriels dès le 2e exercice');
    l.push(m.social === 'assimile_salarie' ? 'Président assimilé salarié : charges ≈ 80 % du net, aucune cotisation sur les dividendes' : 'Gérant TNS : cotisations ≈ 45 % ; dividendes > 10 % du capital soumis aux cotisations');
    l.push('Dividendes : flat tax 31,4 % (12,8 % IR + 18,6 % prélèvements sociaux) sur ma part, ou option pour le barème');
    l.push('Comptes annuels : approbation sous 6 mois, dépôt au greffe, liasse fiscale');
  }
  l.push(m.tva_regime === 'franchise' ? 'TVA : franchise en base (37 500 € services, 41 250 € seuil majoré)' : 'TVA : déclarations CA3 (le régime simplifié disparaît au 1er janvier 2027)');
  l.push('Facturation électronique : réception obligatoire dès le 1er septembre 2026, émission dès le 1er septembre 2027 pour les micro/PME');
  return l;
}
