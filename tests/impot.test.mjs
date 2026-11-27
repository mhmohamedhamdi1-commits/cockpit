// Tests du moteur Impôt (app/js/impot.js + impot-data.js). Cas chiffrés recalculés à la main à partir du barème officiel :
//  • revenus 2025 (déclaration 2026) : LF 2026 art. 4 — tranches 11 600 / 29 579 / 84 577 / 181 917 ; décote 897 € (seul) / 1 483 € (couple), taux 45,25 % ;
//    plafond QF 1 807 € par demi-part, parent isolé 4 262 €   (LégiFiscal n°4474 ; BOFiP du 07/04/2026 ; impots.gouv.fr)
//  • revenus 2024 : LF 2025 art. 2 — 11 497 / 29 315 / 83 823 / 180 294 ; QF 1 791 € ; décote 889 € / 1 470 €
//  • CEHR : exemple de la doc (célibataire, 600 000 € → 7 500 + 4 000 = 11 500 €), art. 223 sexies CGI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveBareme, computeTax, computeParts, inputFromFlat, whatIf, FIELDS, taxPerPart } from '../app/js/impot.js';
import { BAREMES } from '../app/js/impot-data.js';

const B25 = resolveBareme(2025), B24 = resolveBareme(2024);
const near = (a, b, tol = 0.02, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} attendu ${b}, reçu ${a}`);
// net imposable annuel qui donne exactement `rni` après l'abattement de 10 % (hors min/max)
const net = (rni) => rni / 0.9;
const calc = (flat, B = B25, ents = []) => computeTax(inputFromFlat(flat, {}, ents).input, B);

test('barème : tranches par part (revenus 2025)', () => {
  near(taxPerPart(30000, B25.tranches), 1977.69 + 126.30, 0.01);
  near(taxPerPart(11600, B25.tranches), 0);
  near(taxPerPart(100000, B25.tranches), 1977.69 + (84577 - 29579) * 0.30 + (100000 - 84577) * 0.41, 0.01);
});

test('célibataire, 30 000 € de revenu imposable : 2 103,99 € (sans décote)', () => {
  const r = calc({ situation: 'celibataire', salaire1: net(30000) });
  near(r.rni, 30000); near(r.impotBrut, 2103.99); near(r.irNet, 2103.99); assert.equal(r.decote, 0);
  near(r.tmi, 0.30); near(r.tauxMoyen, 2103.99 / 30000, 0.0001);
});

test('décote : célibataire à 20 000 € → 924 − (897 − 45,25 % × 924) = 445,11 €', () => {
  const r = calc({ situation: 'celibataire', salaire1: net(20000) });
  near(r.impotBrut, 924); near(r.decote, 897 - 0.4525 * 924); near(r.irNet, 445.11);
});

test('décote : couple, impôt entièrement effacé', () => {
  const r = calc({ situation: 'marie', salaire1: net(30000) });
  near(r.parts.total, 2); near(r.impotBrut, 748); near(r.irNet, 0);
});

test('décote revenus 2024 (889 €) : 20 000 € → 924 − (889 − 0,4525 × 924)', () => {
  const r = calc({ situation: 'celibataire', salaire1: net(20000) }, B24);
  // barème 2024 : (20000 − 11497) × 11 %
  const brut = (20000 - 11497) * 0.11;
  near(r.impotBrut, brut); near(r.irNet, brut - (889 - 0.4525 * brut));
});

test('couple + 2 enfants à 100 000 € : plafonnement du quotient familial (2 × 1 807 €)', () => {
  const r = calc({ situation: 'marie', enfantsCharge: 2, salaire1: net(100000) });
  near(r.parts.total, 3);
  near(r.impotParts, 3 * (1977.69 + (100000 / 3 - 29579) * 0.30));          // 9 311,98 avant plafonnement
  assert.equal(r.plafonnementApplique, true);
  near(r.impotBrut, 2 * (1977.69 + (50000 - 29579) * 0.30) - 2 * 1807);       // 16 207,98 − 3 614 = 12 593,98
  near(r.impotBrut, 12593.98, 0.05);
});

test('couple + 2 enfants à 50 000 € : pas de plafonnement', () => {
  const r = calc({ situation: 'marie', enfantsCharge: 2, salaire1: net(50000) });
  assert.equal(r.plafonnementApplique, false);
  near(r.impotBrut, 3 * taxPerPart(50000 / 3, B25.tranches));
});

test('parent isolé, 1 enfant, 40 000 € : 2 parts, plafond 1 807 + 4 262, décote', () => {
  const r = calc({ situation: 'divorce', parentIsole: 1, enfantsCharge: 1, salaire1: net(40000) });
  near(r.parts.total, 2); near(r.parts.isole, 0.5);
  near(r.impotBrut, 2 * (20000 - 11600) * 0.11);                                // 1 848
  assert.equal(r.plafonnementApplique, false);
  near(r.irNet, 1848 - (897 - 0.4525 * 1848), 0.02);                            // 1 787,20 après décote
});

test('veuf avec enfant : bénéficie d\'office de la part de parent isolé', () => {
  const P = computeParts({ situation: 'veuf', enfantsCharge: 1 });
  assert.equal(P.total, 2); assert.equal(P.isole, 0.5);
});

test('nombre de parts : couple + 3 enfants = 4 ; garde alternée = moitié ; case L', () => {
  assert.equal(computeParts({ situation: 'marie', enfantsCharge: 3 }).total, 4);
  assert.equal(computeParts({ situation: 'celibataire', enfantsAlternee: 2 }).total, 1.5);
  assert.equal(computeParts({ situation: 'celibataire', enfantsCharge: 1, enfantsAlternee: 1 }).total, 2);
  assert.equal(computeParts({ situation: 'celibataire', elevéSeul5ans: 1 }).total, 1.5);
  assert.equal(computeParts({ situation: 'marie', demiPartsExtra: 0.5 }).total, 2.5);
});

test('pension alimentaire à un parent (ascendant) : déduite du revenu global, sans plafond légal', () => {
  const sans = calc({ situation: 'celibataire', salaire1: net(30000) });
  const avec = calc({ situation: 'celibataire', salaire1: net(30000), pensionAscendants: 6000 });
  near(avec.rni, 24000);
  near(avec.irNet, (24000 - 11600) * 0.11 - (897 - 0.4525 * (24000 - 11600) * 0.11));   // 1 364 → décote 279,79 → 1 084,21
  assert.ok(sans.irNet - avec.irNet > 1000);
  const grosse = calc({ situation: 'celibataire', salaire1: net(30000), pensionAscendants: 12000 });
  near(grosse.rni, 18000);                                                              // aucun plafond
  assert.ok(grosse.warnings.some((w) => /ascendant/i.test(w)));
});

test('pension à un enfant majeur : plafonnée à 6 855 € par enfant (revenus 2025) ; forfait hébergement 4 075 €', () => {
  const r = calc({ situation: 'celibataire', salaire1: net(30000), pensionEnfantMajeur: 10000, nbEnfantsMajeursPension: 1 });
  near(r.deductions.pensionEnfantMajeur, 6855); near(r.rni, 30000 - 6855);
  const h = calc({ situation: 'celibataire', salaire1: net(30000), hebergementAscendants: 1 });
  near(h.deductions.hebergement, 4075);
});

test('salaires : abattement 10 % avec minimum (509 €) et maximum (14 555 €) ; frais réels', () => {
  near(calc({ salaire1: 3000 }).revenus.salaires.abattement, 509);
  near(calc({ salaire1: 200000 }).revenus.salaires.abattement, 14555);
  near(calc({ salaire1: 40000, fraisReels1: 6000 }).revenus.salaires.abattement, 6000);
  const deux = calc({ situation: 'marie', salaire1: 200000, salaire2: 3000 });
  near(deux.revenus.salaires.abattement, 14555 + 509, 0.01, 'abattement par déclarant');
});

test('micro-BNC : 50 000 € de CA − 34 % = 33 000 € imposables ; minimum de 305 €', () => {
  const r = calc({ situation: 'celibataire', microBnc: 50000 });
  near(r.rni, 33000); near(r.irNet, 1977.69 + (33000 - 29579) * 0.30);
  near(calc({ microBnc: 500 }).rni, 195);
});

test('versement libératoire : les revenus micro sortent du barème mais restent dans le RFR', () => {
  const r = calc({ situation: 'celibataire', microBnc: 50000, versementLiberatoire: 1 });
  near(r.rni, 0); near(r.irNet, 0); near(r.revenus.versementLiberatoireBase, 33000); near(r.rfr, 33000);
});

test('entreprise (contrat fiscalIncome) : BNC micro, dirigeant, dividendes et cotisations déductibles', () => {
  const ent = { nom: 'Ma SASU', bnc: 0, bic: 0, salaireNetImposable: 20000, dividendesBruts: 5000, cotisationsDeductibles: 0, versementLiberatoire: false, estimated: true, notes: ['hypothèse de rémunération'] };
  const r = calc({ situation: 'celibataire', salaire1: 40000 }, B25, [ent]);
  near(r.revenus.salaires.net, 60000); near(r.revenus.capital.dividendes, 5000);
  assert.equal(r.estimated, true); assert.ok(r.warnings.some((w) => /hypothèse de rémunération/.test(w)));
  const tns = calc({ situation: 'celibataire' }, B25, [{ nom: 'EURL', bnc: 40000, cotisationsDeductibles: 10000 }]);
  near(tns.rni, 30000);
});

test('dividendes : barème plus favorable à faible revenu (abattement 40 %), PFU à fort revenu', () => {
  const bas = calc({ situation: 'celibataire', salaire1: net(20000), dividendes: 10000 });
  assert.equal(bas.pfu.choix, 'bareme');
  near(bas.rni, 26000); near(bas.irNet, (26000 - 11600) * 0.11 - (897 - 0.4525 * (26000 - 11600) * 0.11), 0.02);
  near(bas.ps.capital, 10000 * 0.172);                                           // PS 17,2 % sur dividendes perçus en 2025
  const haut = calc({ situation: 'celibataire', salaire1: 100000, dividendes: 10000 });
  assert.equal(haut.pfu.choix, 'pfu'); near(haut.pfu.irPfu, 1280);
  const force = calc({ situation: 'celibataire', salaire1: 100000, dividendes: 10000, optionCapital: 'bareme' });
  assert.equal(force.pfu.choix, 'bareme');
});

test('prélèvements sociaux 2026 : dividendes à 18,6 % (LFSS 2026), fonciers à 17,2 %', () => {
  const B26 = resolveBareme(2026);
  const r = calc({ situation: 'celibataire', salaire1: 100000, dividendes: 10000, foncierFranceMode: 'micro', foncierFranceLoyers: 10000 }, B26);
  near(r.ps.capital, 1860); near(r.ps.fonciers, 10000 * 0.7 * 0.172);
  assert.equal(B26.statut, 'estime');
});

test('plus-values : moins-values reportables imputées', () => {
  const r = calc({ situation: 'celibataire', salaire1: 100000, plusValues: 5000, moinsValuesReportables: 2000 });
  near(r.revenus.capital.plusValues, 3000);
  assert.equal(calc({ plusValues: 1000, moinsValuesReportables: 3000 }).revenus.capital.moinsValuesRestantes, 2000);
});

test('revenus fonciers de source marocaine : méthode du taux effectif (convention France–Maroc)', () => {
  const sans = calc({ situation: 'celibataire', salaire1: net(20000), foncierEtrangerNet: 10000, foncierEtrangerOption: 'ignorer' });
  near(sans.irNet, 445.11);
  const r = calc({ situation: 'celibataire', salaire1: net(20000), foncierEtrangerNet: 10000, foncierEtrangerOption: 'taux_effectif' });
  const brut = (2103.99) * (20000 / 30000);                                      // barème sur 30 000 € puis × 20 000 / 30 000
  near(r.impotBrut, brut); near(r.irNet, brut - (897 - 0.4525 * brut), 0.03);
  assert.ok(r.irNet > sans.irNet + 600); assert.equal(r.ps.total, 0, 'pas de prélèvements sociaux sur ces loyers exonérés');
  assert.ok(r.warnings.some((w) => /Maroc|convention/i.test(w)));
});

test('revenus étrangers : option crédit d\'impôt limitée à l\'impôt français correspondant', () => {
  const r = calc({ situation: 'celibataire', salaire1: net(20000), foncierEtrangerNet: 10000, foncierEtrangerOption: 'credit_impot', foncierEtrangerImpot: 1000 });
  assert.ok(r.creditImpotEtranger > 0 && r.creditImpotEtranger <= 1000);
  near(r.rni, 30000);
  const beaucoup = calc({ situation: 'celibataire', salaire1: net(20000), foncierEtrangerNet: 10000, foncierEtrangerOption: 'credit_impot', foncierEtrangerImpot: 99999 });
  near(beaucoup.creditImpotEtranger, beaucoup.impotApresDecote * (10000 / 30000), 0.01);
});

test('foncier France : micro (30 %) et réel (déficit plafonné à 10 700 €)', () => {
  near(calc({ foncierFranceMode: 'micro', foncierFranceLoyers: 10000 }).rni, 7000);
  near(calc({ foncierFranceMode: 'reel', foncierFranceLoyers: 10000, foncierFranceCharges: 4000 }).rni, 6000);
  const d = calc({ salaire1: net(50000), foncierFranceMode: 'reel', foncierFranceLoyers: 1000, foncierFranceCharges: 20000 });
  near(d.rni, 50000 - 10700); assert.ok(d.warnings.some((w) => /Déficit foncier/.test(w)));
  assert.ok(calc({ foncierFranceMode: 'micro', foncierFranceLoyers: 20000 }).warnings.some((w) => /Micro-foncier impossible/.test(w)));
});

test('PER : déduction limitée au plafond (plancher 10 % du PASS)', () => {
  const r = calc({ salaire1: net(50000), perVersements: 3000 });
  near(r.deductions.per, 3000); near(r.rni, 50000 - 3000);
  const trop = calc({ salaire1: net(20000), perVersements: 20000 });
  near(trop.deductions.perPlafond, Math.max(B25.per.plancherPct * B25.per.pass, 2000)); assert.ok(trop.deductions.per < 20000);
  near(calc({ salaire1: net(50000), perVersements: 9000, perPlafond: 7000 }).deductions.per, 7000);
});

test('réductions et crédits : dons 66 %, emploi à domicile 50 % remboursable', () => {
  const d = calc({ situation: 'celibataire', salaire1: net(30000), dons66: 1000 });
  near(d.irNet, 2103.99 - 660);
  const c = calc({ situation: 'celibataire', salaire1: net(30000), emploiDomicile: 5000 });
  near(c.irNet, 2103.99 - 2500); assert.ok(c.aRestituer > 0, 'crédit remboursable → restitution');
  near(calc({ salaire1: net(30000), emploiDomicile: 20000 }).credits.emploiDomicile, 6000, 0.01, 'plafond 12 000 €');
  near(calc({ salaire1: net(30000), gardeEnfants: 5000, nbEnfantsGarde: 1 }).credits.gardeEnfants, 1750);
});

test('CEHR : célibataire à 600 000 € → 7 500 + 4 000 = 11 500 € ; couple → 3 000 €', () => {
  near(calc({ situation: 'celibataire', bncReel: 600000 }).cehr, 11500, 0.5);
  near(calc({ situation: 'marie', bncReel: 600000 }).cehr, 3000, 0.5);
  assert.equal(calc({ situation: 'celibataire', salaire1: 50000 }).cehr, 0);
});

test('prélèvement à la source déjà versé : solde à payer / à restituer', () => {
  const r = calc({ situation: 'celibataire', salaire1: net(30000), pasPreleve: 1500 });
  near(r.solde, 2103.99 - 1500); near(r.aPayer, 603.99); assert.equal(r.aRestituer, 0);
  const rest = calc({ situation: 'celibataire', salaire1: net(30000), pasPreleve: 3000 });
  near(rest.aRestituer, 896.01);
});

test('détail pas à pas : étapes ordonnées et cohérentes', () => {
  const r = calc({ situation: 'celibataire', salaire1: net(30000), pensionAscendants: 6000 });
  const labels = r.steps.map((s) => s.label);
  assert.ok(labels.indexOf('Revenu net imposable') > labels.findIndex((l) => /ascendant/.test(l)));
  assert.equal(r.steps.at(-1).kind, 'total');
});

// ----- barèmes : projection automatique et surcharge par la table commune
test('année future : projection automatique par indexation, marquée « estimé »', () => {
  const b26 = resolveBareme(2026), b27 = resolveBareme(2027, { indexation: 0.02 }), b28 = resolveBareme(2028);
  assert.equal(b26.statut, 'estime'); assert.equal(b27.statut, 'estime');
  assert.equal(b27.tranches[0].jusqua, Math.round(b26.tranches[0].jusqua * 1.02));
  assert.equal(b27.tranches[3].taux, 0.41, 'les taux ne bougent pas');
  assert.ok(b28.tranches[0].jusqua > b27.tranches[0].jusqua);
  assert.match(b27.source, /Projection/);
  assert.equal(resolveBareme(2027, { indexation: 0.05 }).tranches[0].jusqua, Math.round(b26.tranches[0].jusqua * 1.05));
  // le calcul fonctionne sans changer une ligne de code
  assert.ok(calc({ situation: 'celibataire', salaire1: 50000 }, b28).totalImpots > 0);
  // année officielle : jamais modifiée par la projection
  assert.equal(resolveBareme(2025).tranches[0].jusqua, 11600); assert.equal(resolveBareme(2025).statut, 'officiel');
  // barème 2026 : valeurs du PLF 2027
  assert.deepEqual(b26.tranches.map((t) => t.jusqua), [11844, 30200, 86353, 185737, null]); assert.equal(b26.qf.demiPart, 1845);
});

test('table commune bareme_fiscal : prioritaire, partielle ou complète, et fait basculer en « officiel »', () => {
  // surcharge partielle du plafond QF 2025
  const p = resolveBareme(2025, { table: [{ annee: 2025, data: { qf: { demiPart: 2000 } }, statut: 'officiel', source: 'test' }] });
  assert.equal(p.qf.demiPart, 2000); assert.equal(p.qf.parentIsole, 4262); assert.equal(p.tranches[0].jusqua, 11600);
  // l'année 2027 est publiée : ligne complète → officiel, et 2028 s'indexe dessus
  const row = { annee: 2027, statut: 'officiel', source: 'LF 2027', data: { ...JSON.parse(JSON.stringify(BAREMES[2025])), annee: 2027, tranches: [{ jusqua: 12000, taux: 0 }, { jusqua: 31000, taux: 0.11 }, { jusqua: 90000, taux: 0.30 }, { jusqua: 190000, taux: 0.41 }, { jusqua: null, taux: 0.45 }] } };
  const b27 = resolveBareme(2027, { table: [row] });
  assert.equal(b27.statut, 'officiel'); assert.equal(b27.tranches[0].jusqua, 12000); assert.equal(b27.source, 'LF 2027');
  assert.equal(resolveBareme(2028, { table: [row] }).tranches[0].jusqua, Math.round(12000 * 1.02));
  // changer un taux dans la table change le calcul
  const r1 = calc({ situation: 'celibataire', salaire1: net(30000) }, B25);
  const B2 = resolveBareme(2025, { table: [{ annee: 2025, data: { tranches: [{ jusqua: 11600, taux: 0 }, { jusqua: null, taux: 0.5 }] } }] });
  assert.ok(calc({ situation: 'celibataire', salaire1: net(30000) }, B2).irNet > r1.irNet);
  // lignes invalides ignorées
  assert.equal(resolveBareme(2025, { table: [null, { annee: 2025 }, { annee: 2025, data: null }] }).tranches[0].jusqua, 11600);
});

test('saisie > calcul automatique > défaut ; simulateur « et si »', () => {
  const { input, sources } = inputFromFlat({ salaire1: '', dividendes: 500 }, { salaire1: 42000, dividendes: 1, foncierEtrangerNet: 8000 });
  assert.equal(input.salaire1, 42000); assert.equal(sources.salaire1, 'calculée');
  assert.equal(input.dividendes, 500); assert.equal(sources.dividendes, 'saisie');
  assert.equal(input.foncierEtrangerNet, 8000); assert.equal(sources.situation, 'défaut');
  assert.equal(input.situation, 'celibataire'); assert.equal(input.pasPreleve, 0);
  const w = whatIf(input, B25, { pensionAscendants: 3000 });
  assert.ok(w.ecart < -500, `une pension de 3 000 € réduit l'impôt (${w.ecart})`);
  assert.ok(FIELDS.every((f) => f.key && f.section && f.label && f.hint), 'chaque champ est documenté');
});
