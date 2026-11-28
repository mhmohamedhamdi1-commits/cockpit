// Barèmes de l'impôt sur le revenu par ANNÉE DE REVENUS (déclarés l'année suivante).
// Module de données PUR (aucun DOM) : copié tel quel dans l'Edge Function. Tous les montants sont en euros.
// Chaque barème est un objet JSON « à plat » : la même forme est acceptée dans la table `bareme_fiscal.data`
// (une ligne par année, modifiable sans redéploiement ; elle PRIME sur ce fichier, voir impot.js › resolveBareme).
//
// Statut : 'officiel' = texte publié (loi de finances promulguée) ; 'estime' = projet / indexation.
// Vérifications faites le 2026-11-28 (recoupement de plusieurs sources ; BOFiP / impots.gouv.fr / LégiFiscal / economie.gouv.fr) :
//  - Barème 2024 (revenus 2023)… non embarqué (hors périmètre) ; barème 2025 (revenus 2024) : LF 2025 art. 2, +1,8 %.
//    Tranches 11 497 / 29 315 / 83 823 / 180 294 ; plafond QF 1 791 ; décote 889 € (seul) et 1 470 € (couple), seuils 1 965 € / 3 249 € ;
//    parent isolé 4 224 € ; demi-part « élevé seul » 1 069 €.   [legifiscal.fr/reperes-fiscaux/bareme-impot-revenu.html, actualité n°4102]
//  - Barème 2026 (revenus 2025) : LF 2026 art. 4, +0,9 %. Tranches 11 600 / 29 579 / 84 577 / 181 917 ; plafond QF 1 807 ;
//    décote 897 € / 1 483 € (seuils 1 982 € / 3 277 €) ; parent isolé 4 262 € ; élevé seul 1 079 €.  [legifiscal.fr actualité n°4474, BOFiP 7/04/2026]
//  - Abattement 10 % salaires : revenus 2024 min 504 / max 14 426 ; revenus 2025 min 509 / max 14 555. Pensions : revenus 2025 min 454 / max 4 439 par foyer.
//  - Barème revenus 2026 (déclaration 2027) : PLF 2027 (texte déposé, NON VOTÉ au 28/11/2026, +2,1 %) : 11 844 / 30 200 / 86 353 / 185 737 ;
//    plafond QF 1 845 ; décote 915 € / 1 513 €. → statut « estime » ; les autres plafonds sont indexés de 2,1 %.   [legifiscal.fr actualité n°4659]
//  - Prélèvements sociaux : LFSS 2026 (loi du 30/12/2025, art. 12) : CSG sur revenus du capital 9,2 % → 10,6 % ; PS 17,2 % → 18,6 % (PFU 31,4 %)
//    pour les dividendes/intérêts perçus à compter du 01/01/2026 et pour les plus-values mobilières imposées en 2026 (revenus 2025) ;
//    revenus fonciers et assurance-vie restent à 17,2 % ; CSG déductible 6,8 %.
//    ⚠ Le taux des plus-values mobilières 2025 fait débat entre sources (17,2 % ou 18,6 %) : 18,6 % retenu (prudence), modifiable via `bareme_fiscal`.
//  - Pension alimentaire : enfant majeur 6 794 € (revenus 2024) puis 6 855 € (revenus 2025) ; forfait hébergement 4 039 € puis 4 075 € ; ascendant : pas de plafond légal
//    (besoin + proportionnalité à tes ressources).   [economie.gouv.fr, service-public.gouv.fr A15453]
//  - Micro-entreprise : abattements 34 % (BNC) / 50 % (BIC services) / 71 % (vente), minimum 305 € ; micro-foncier 30 % (recettes ≤ 15 000 €).
//  - PER (salarié) : plafond = 10 % des revenus professionnels N-1 dans la limite de 8 PASS, plancher 10 % du PASS ; le PASS retenu est celui de N-1.
//    PASS 2023 43 992 € ; 2024 46 368 € ; 2025 47 100 € ; 2026 48 060 €.
//  - Réductions / crédits : emploi à domicile 50 % (plafond 12 000 €, +1 500 €/enfant, max 15 000 €), garde hors domicile 50 % (3 500 €/enfant < 6 ans),
//    dons 66 % (≤ 20 % du revenu imposable) et 75 % (plafond 1 000 € ; 2 000 € pour les dons du 14/10/2025).
//  - CEHR (art. 223 sexies CGI) : seul 3 % de 250 000 à 500 000 €, 4 % au-delà ; couple 3 % de 500 000 à 1 000 000 €, 4 % au-delà.
//    (La CDHR — impôt minimum de 20 % — n'est PAS calculée ; avertissement affiché au-dessus des seuils.)

export const BAREMES = {
  2024: {
    annee: 2024, statut: 'officiel', source: 'LF 2025 art. 2 (+1,8 %) — impots.gouv.fr, LégiFiscal ; LFSS 2025 pour les prélèvements sociaux',
    tranches: [{ jusqua: 11497, taux: 0 }, { jusqua: 29315, taux: 0.11 }, { jusqua: 83823, taux: 0.30 }, { jusqua: 180294, taux: 0.41 }, { jusqua: null, taux: 0.45 }],
    qf: { demiPart: 1791, demiPartIsole: 1069, parentIsole: 4224 },
    decote: { seuilSeul: 1965, seuilCouple: 3249, baseSeul: 889, baseCouple: 1470, taux: 0.4525 },
    abattement10: { min: 504, max: 14426 }, abattementPensions: { min: 450, max: 4399 },
    micro: { bnc: { taux: 0.34, min: 305 }, bicServices: { taux: 0.5, min: 305 }, bicVente: { taux: 0.71, min: 305 }, foncier: { taux: 0.30, seuil: 15000 } },
    deficitFoncierMax: 10700,
    pensionAlimentaire: { enfantMajeur: 6794, forfaitHebergement: 4039 },
    per: { pass: 43992, plancherPct: 0.10, plafondPct: 0.10, maxPass: 8 },
    ps: { dividendes: 0.172, plusValues: 0.172, interets: 0.172, fonciers: 0.172, csgDeductible: 0.068 },
    pfu: { ir: 0.128 }, dividendes: { abattement: 0.40 },
    reductions: { dons: { taux: 0.66, plafondPctRevenu: 0.20, tauxAide: 0.75, plafondAide: 1000 },
      emploiDomicile: { taux: 0.5, plafond: 12000, majParEnfant: 1500, plafondMax: 15000 }, gardeEnfants: { taux: 0.5, plafondParEnfant: 3500 } },
    cehr: { seul: [{ de: 250000, taux: 0.03 }, { de: 500000, taux: 0.04 }], couple: [{ de: 500000, taux: 0.03 }, { de: 1000000, taux: 0.04 }] },
  },
  2025: {
    annee: 2025, statut: 'officiel', source: 'LF 2026 art. 4 (+0,9 %) — LégiFiscal, BOFiP du 7/04/2026 ; LFSS 2026 art. 12 pour les prélèvements sociaux',
    tranches: [{ jusqua: 11600, taux: 0 }, { jusqua: 29579, taux: 0.11 }, { jusqua: 84577, taux: 0.30 }, { jusqua: 181917, taux: 0.41 }, { jusqua: null, taux: 0.45 }],
    qf: { demiPart: 1807, demiPartIsole: 1079, parentIsole: 4262 },
    decote: { seuilSeul: 1982, seuilCouple: 3277, baseSeul: 897, baseCouple: 1483, taux: 0.4525 },
    abattement10: { min: 509, max: 14555 }, abattementPensions: { min: 454, max: 4439 },
    micro: { bnc: { taux: 0.34, min: 305 }, bicServices: { taux: 0.5, min: 305 }, bicVente: { taux: 0.71, min: 305 }, foncier: { taux: 0.30, seuil: 15000 } },
    deficitFoncierMax: 10700,
    pensionAlimentaire: { enfantMajeur: 6855, forfaitHebergement: 4075 },
    per: { pass: 46368, plancherPct: 0.10, plafondPct: 0.10, maxPass: 8 },
    ps: { dividendes: 0.172, plusValues: 0.186, interets: 0.172, fonciers: 0.172, csgDeductible: 0.068 },
    pfu: { ir: 0.128 }, dividendes: { abattement: 0.40 },
    reductions: { dons: { taux: 0.66, plafondPctRevenu: 0.20, tauxAide: 0.75, plafondAide: 2000 },
      emploiDomicile: { taux: 0.5, plafond: 12000, majParEnfant: 1500, plafondMax: 15000 }, gardeEnfants: { taux: 0.5, plafondParEnfant: 3500 } },
    cehr: { seul: [{ de: 250000, taux: 0.03 }, { de: 500000, taux: 0.04 }], couple: [{ de: 500000, taux: 0.03 }, { de: 1000000, taux: 0.04 }] },
  },
};

// Les montants en euros qui suivent l'inflation (indexés chaque année) ; les taux et pourcentages ne bougent pas.
const MONEY_PATHS = [
  ['qf', 'demiPart'], ['qf', 'demiPartIsole'], ['qf', 'parentIsole'],
  ['decote', 'seuilSeul'], ['decote', 'seuilCouple'], ['decote', 'baseSeul'], ['decote', 'baseCouple'],
  ['abattement10', 'min'], ['abattement10', 'max'], ['abattementPensions', 'min'], ['abattementPensions', 'max'],
  ['pensionAlimentaire', 'enfantMajeur'], ['pensionAlimentaire', 'forfaitHebergement'], ['per', 'pass'],
];
const clone = (o) => JSON.parse(JSON.stringify(o));

// Indexation d'un barème d'une année sur l'autre (tranches + montants indexés). Arrondi à l'euro comme l'administration.
export function indexBareme(base, annee, taux, { statut = 'estime', source } = {}) {
  const b = clone(base);
  const f = 1 + taux;
  b.annee = annee; b.statut = statut;
  b.source = source || `Projection automatique : barème ${base.annee} indexé de ${(taux * 100).toFixed(1).replace('.', ',')} % — à remplacer par le barème officiel dès sa publication`;
  b.tranches = b.tranches.map((t) => (t.jusqua == null ? t : { ...t, jusqua: Math.round(t.jusqua * f) }));
  for (const [a, k] of MONEY_PATHS) if (b[a] && typeof b[a][k] === 'number') b[a][k] = Math.round(b[a][k] * f);
  return b;
}

// Revenus 2026 (déclaration 2027) : PLF 2027 non voté → valeurs du texte déposé, le reste indexé de +2,1 %
(function addProjection() {
  const b = indexBareme(BAREMES[2025], 2026, 0.021, { source: 'PLF 2027 (texte déposé, NON VOTÉ au 28/11/2026) : barème +2,1 % ; autres plafonds indexés à +2,1 % — LégiFiscal n°4659' });
  b.tranches = [{ jusqua: 11844, taux: 0 }, { jusqua: 30200, taux: 0.11 }, { jusqua: 86353, taux: 0.30 }, { jusqua: 185737, taux: 0.41 }, { jusqua: null, taux: 0.45 }];
  b.qf.demiPart = 1845; b.decote.baseSeul = 915; b.decote.baseCouple = 1513;
  b.decote.seuilSeul = Math.round(915 / 0.4525); b.decote.seuilCouple = Math.round(1513 / 0.4525);
  b.per.pass = 47100;                                 // PASS 2025 (officiel)
  b.ps = { ...b.ps, dividendes: 0.186, plusValues: 0.186 };   // LFSS 2026 : 18,6 % sur dividendes / intérêts perçus en 2026
  b.ps.interets = 0.186;
  BAREMES[2026] = b;
})();

export const ANNEES_CONNUES = () => Object.keys(BAREMES).map(Number).sort((a, b) => a - b);
