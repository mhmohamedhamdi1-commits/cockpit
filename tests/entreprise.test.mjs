// Tests du moteur Entreprise (app/js/entreprise.js) : plafonds, cotisations, IS, flat tax, planning, fiscalIncome…
// Lancement : node --test tests/entreprise.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../app/js/entreprise.js';

const near = (a, b, tol = 0.01, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} ≠ ${b}`);
const P = { taux: 0.1 };
const proj = (o = {}) => ({ id: 'p1', seq: 1, nom: 'Ma micro', type: 'Entreprise', part: 1, devise: 'EUR', meta: { forme: 'micro_bnc', date_debut: '2027-01-01' }, ...o });
const inv = (o) => ({ id: 'i' + Math.random(), projetId: 'p1', client: 'Talan', periode: '2027-01', jours: 20, tjm: 500, devise: 'EUR', ht: 10000, tva: 0, ttc: 10000, emission: '2027-01-31', statut: 'Payée', paiement: '2027-02-10', ...o });
const tx = (o) => ({ id: 't' + Math.random(), activite: 'Entreprise', projetId: 'p1', sens: 'Revenu', categorie: 'Prestations', nature: 'Courant', ref: '', montantEur: 0, date: '2027-03-01', ...o });
const ctx = (o = {}) => ({ today: '2027-06-15', P, ...o, data: { projets: [proj()], clients: [{ id: 'c1', projetId: 'p1', nom: 'Talan', micro: 'Oui', tjm: 500, devise: 'EUR', tva: 0 }], invoices: [], tx: [], params: [], declarations: [], ...o.data } });

test('règles : 2026 officielles, 2027 plafonds reconduits (estimé), années futures reprennent la dernière année', () => {
  assert.equal(E.rulesFor(2026).micro.plafond.bnc, 83600);
  assert.equal(E.rulesFor(2026).micro.cotisations.bnc, 0.256);
  assert.equal(E.rulesFor(2025).micro.plafond.bnc, 77700);
  assert.equal(E.rulesFor(2025).pfu.ps, 0.172);
  assert.equal(E.rulesFor(2026).pfu.ps, 0.186);
  const r27 = E.rulesFor(2027);
  assert.equal(r27.statut, 'estime'); assert.equal(r27.micro.plafond.bnc, 83600); assert.equal(r27.micro.cotisations.bnc, 0.256);
  const r31 = E.rulesFor(2031);
  assert.equal(r31.statut, 'estime'); assert.equal(r31.micro.plafond.bic_vente, 203100);
  assert.equal(E.rulesFor(2026).statut, 'officiel');
});

test('normalizeMeta : valeurs par défaut, associés, forme inconnue', () => {
  const m = E.normalizeMeta({ forme: 'zzz' }, { part: 0.5 });
  assert.equal(m.forme, 'micro_bnc'); assert.equal(m.tva_regime, 'franchise'); assert.equal(m.cloture, '12-31');
  const s = E.normalizeMeta({ forme: 'sas' }, { part: 0.5 });
  assert.deepEqual(s.associes.map((a) => [a.nom, a.part, a.moi]), [['Moi', 0.5, true], ['Autres associés', 0.5, false]]);
  assert.equal(s.tva_regime, 'reel_normal');
  assert.equal(E.normalizeMeta({ forme: 'sasu', versement_liberatoire: true }, {}).versement_liberatoire, false, 'VL réservé au micro');
});

test('plafonds : micro-BNC 83 600 €, 1re année proratisée au nombre de jours', () => {
  const c = ctx();
  const s = E.seuilsOf(c, proj(), 2027);
  assert.equal(s.plafondCA, 83600); assert.equal(s.tvaSeuil, 37500); assert.equal(s.tvaSeuilMaj, 41250);
  const p2 = proj({ meta: { forme: 'micro_bnc', date_debut: '2027-07-01' } });
  const s2 = E.seuilsOf(c, p2, 2027);
  near(s2.factor, 184 / 365, 1e-9); near(s2.plafondCA, 83600 * 184 / 365, 0.01);
  assert.equal(E.seuilsOf(c, p2, 2026).factor, 0, 'avant le début : rien');
  assert.equal(E.seuilsOf(c, p2, 2028).factor, 1);
  assert.equal(E.seuilsOf(c, proj({ meta: { forme: 'micro_bic_vente', date_debut: '2027-01-01' } }), 2027).plafondCA, 203100);
  assert.equal(E.seuilsOf(c, proj({ meta: { forme: 'micro_bic_vente', date_debut: '2027-01-01' } }), 2027).tvaSeuil, 85000);
  assert.equal(E.seuilsOf(c, proj({ meta: { forme: 'sasu', tva_regime: 'reel_normal' } }), 2027).plafondCA, null, 'pas de plafond micro en société');
  assert.equal(E.seuilsOf(c, proj({ meta: { forme: 'sasu', tva_regime: 'reel_normal' } }), 2027).tvaSeuil, null);
});

test('surcharge utilisateur des paramètres historiques uniquement si différents du défaut', () => {
  const same = ctx({ data: { params: [{ cle: 'seuil_micro', valeur: '83600' }] } });
  assert.equal(E.seuilsOf(same, proj(), 2027).plafondCA, 83600);
  const custom = ctx({ data: { params: [{ cle: 'seuil_micro', valeur: '90000' }, { cle: 'taux_cotis', valeur: '0.3' }] } });
  assert.equal(E.seuilsOf(custom, proj(), 2027).plafondCA, 90000);
  assert.equal(E.tauxMicro(custom, proj(), 2027).cotisations, 0.3);
});

test('suivi annuel : payé / envoyé / planifié, client hors micro ignoré, mois par mois, plafond restant', () => {
  const c = ctx({ data: {
    clients: [{ id: 'c1', projetId: 'p1', nom: 'Talan', micro: 'Oui' }, { id: 'c2', projetId: 'p1', nom: 'Hors', micro: 'Non' }],
    invoices: [inv({ ht: 10000, paiement: '2027-02-10' }), inv({ ht: 5000, statut: 'Envoyée', paiement: null, emission: '2027-03-31', periode: '2027-03' }),
      inv({ ht: 8000, statut: 'Planifiée', paiement: null, emission: null, periode: '2027-09' }), inv({ client: 'Hors', ht: 99999 }),
      inv({ ht: 7000, periode: '2026-12', paiement: '2027-01-15', emission: '2026-12-31' })] } });
  const fy = E.entrepriseYear(c, proj(), 2027);
  // la facture de décembre 2026 est antérieure au début d'activité : exclue
  assert.equal(fy.paid, 10000); assert.equal(fy.billed, 5000); assert.equal(fy.planned, 8000); assert.equal(fy.total, 23000); assert.equal(fy.done, 15000);
  assert.equal(fy.resteAvantPlafond, 83600 - 15000); assert.equal(fy.resteAvantTva, 37500 - 15000);
  assert.equal(fy.months[1].encaisse, 10000); assert.equal(fy.months[2].facture, 5000); assert.equal(fy.months[8].planifie, 8000); assert.equal(fy.months[11].cumul, 10000);
  assert.equal(fy.micro, 83600); assert.equal(fy.tva, 37500);   // alias de core.freelanceYear
});

test('devises : un client en USD est converti (ctx.fx), MAD au paramètre', () => {
  const c = ctx({ fx: { USD: 0.9 }, data: { invoices: [inv({ devise: 'USD', ht: 1000, paiement: '2027-02-10' }), inv({ devise: 'MAD', ht: 1000, paiement: '2027-02-11' })] } });
  near(E.entrepriseYear(c, proj(), 2027).paid, 900 + 100);
});

test('micro-BNC 2027, 50 000 € encaissés : URSSAF 25,6 %, CFP 0,2 %, abattement 34 %, IR indicatif', () => {
  const c = ctx({ data: { invoices: [inv({ ht: 50000, paiement: '2027-03-10' })] } });
  const f = E.entrepriseFinance(c, proj(), 2027);
  near(f.ca, 50000); near(f.urssaf, 12800); near(f.cfp, 100); near(f.versementLiberatoire, 0);
  near(f.microImposable, 33000); near(f.irIndicatif, 9900);       // TMI 30 % par défaut
  near(f.total, 22800); near(f.resteAMettreDeCote, 22800);
  assert.equal(f.estimated, true, '2027 : estimé');
});

test('micro avec versement libératoire : 2,2 % du CA, pas d\'IR indicatif ; déjà payé déduit du reste', () => {
  const p = proj({ meta: { forme: 'micro_bnc', date_debut: '2027-01-01', versement_liberatoire: true } });
  const c = ctx({ data: { projets: [p], invoices: [inv({ ht: 50000, paiement: '2027-03-10' })], tx: [tx({ sens: 'Dépense', categorie: 'Cotisations URSSAF', montantEur: 5000, date: '2027-04-30' }), tx({ sens: 'Dépense', categorie: 'Versement libératoire (IR)', montantEur: 400, date: '2027-04-30' })] } });
  const f = E.entrepriseFinance(c, p, 2027);
  near(f.versementLiberatoire, 1100); near(f.irIndicatif, 0); near(f.total, 12800 + 100 + 1100);
  near(f.payeDeja, 5400); near(f.resteAMettreDeCote, 14000 - 5400);
});

test('ACRE : création en 2027 → 75 % du taux normal (19,2 % en BNC) jusqu\'à la fin du 3e trimestre suivant', () => {
  const p = proj({ meta: { forme: 'micro_bnc', date_debut: '2027-01-01', acre: true } });
  const info = E.acreInfo(E.normalizeMeta(p.meta, p), 2027);
  assert.equal(info.coef, 0.75); assert.equal(info.fin, '2027-12-31');
  const c = ctx({ data: { projets: [p], invoices: [inv({ ht: 10000, paiement: '2027-03-10' })] } });
  near(E.entrepriseFinance(c, p, 2027).urssaf, 1920);
  // création avant le 1er juillet 2026 : taux réduit de moitié
  const old = E.acreInfo(E.normalizeMeta({ forme: 'micro_bnc', date_debut: '2026-03-01', acre: true }, {}), 2026);
  assert.equal(old.coef, 0.5); assert.equal(old.fin, '2026-12-31');
  // un encaissement après la fin de la période ACRE est au taux plein
  const c2 = ctx({ data: { projets: [p], invoices: [inv({ ht: 10000, paiement: '2028-01-10' })] } });
  near(E.entrepriseFinance(c2, p, 2028).urssaf, 2560);
});

test('micro-BIC services 21,2 % + CFP 0,1 % ; micro-BIC vente 12,3 % ; CIPAV 23,2 %', () => {
  const t = (meta) => E.tauxMicro(ctx(), proj({ meta: { date_debut: '2027-01-01', ...meta } }), 2027);
  assert.equal(t({ forme: 'micro_bic_services' }).cotisations, 0.212); assert.equal(t({ forme: 'micro_bic_services' }).cfp, 0.001);
  assert.equal(t({ forme: 'micro_bic_services', artisan: true }).cfp, 0.003);
  assert.equal(t({ forme: 'micro_bic_vente' }).cotisations, 0.123); assert.equal(t({ forme: 'micro_bic_vente' }).abattement, 0.71);
  assert.equal(t({ forme: 'micro_bnc', caisse: 'cipav' }).cotisations, 0.232);
  assert.equal(t({ forme: 'micro_bic_services', versement_liberatoire: true }).vl, 0.017);
});

test('abattement minimal de 305 € en micro', () => {
  const c = ctx({ data: { invoices: [inv({ ht: 400, paiement: '2027-03-10' })] } });
  const fi = E.fiscalIncome(c, proj(), 2027);
  assert.equal(fi.bnc, 95); assert.equal(fi.microAbattement.montant, 305);
});

test('IS : 15 % jusqu\'à 42 500 € puis 25 % (exemple officiel : 100 000 € → 20 750 €), exercice court proratisé', () => {
  assert.equal(E.calculIS(2026, 100000).is, 20750);
  assert.equal(E.calculIS(2026, 30000).is, 4500);
  assert.equal(E.calculIS(2026, 0).is, 0); assert.equal(E.calculIS(2026, -5000).is, 0);
  // exercice de 6 mois : plafond 21 250 € → 21 250×15 % + 8 750×25 %
  assert.equal(E.calculIS(2026, 30000, { moisExercice: 6 }).is, 3187.5 + 2187.5);
  assert.equal(E.calculIS(2026, 100000, { pmeReduit: false }).is, 25000);
});

test('flat tax : 31,4 % en 2026 (12,8 + 18,6), 30 % en 2025 ; multipliée par mes parts', () => {
  assert.equal(E.flatTax(2026, 10000).total, 3140); assert.equal(E.flatTax(2026, 10000).net, 6860);
  assert.equal(E.flatTax(2025, 10000).total, 3000);
  const p = proj({ part: 0.5, meta: { forme: 'sas', date_debut: '2027-01-01', remuneration: { mode: 'dividendes', dividendes_annuels: 10000 } } });
  const c = ctx({ data: { projets: [p], invoices: [inv({ ht: 60000, paiement: '2027-03-10' })] } });
  const f = E.entrepriseFinance(c, p, 2027);
  near(f.dividendes.mesParts, 5000); near(f.dividendes.flatTax.total, 5000 * 0.314);
});

test('société à l\'IS (SASU) : rémunération, IS, dividendes distribuables, flat tax', () => {
  const p = proj({ meta: { forme: 'sasu', date_debut: '2027-01-01', capital: 1000, remuneration: { mode: 'mixte', salaire_net_annuel: 20000 } } });
  const c = ctx({ data: { projets: [p], invoices: [inv({ ht: 100000, paiement: '2027-03-10' })], tx: [tx({ sens: 'Dépense', categorie: 'Logiciels & abonnements', montantEur: 4000, date: '2027-05-01' })] } });
  const f = E.entrepriseFinance(c, p, 2027);
  near(f.salaire.cout, 20000 * 1.8);                           // net × (1 + 80 %)
  near(f.resultatAvantImpot, 100000 - 4000 - 36000);           // 60 000
  near(f.is, 42500 * 0.15 + 17500 * 0.25);                     // 10 750
  near(f.resultatNet, 60000 - 10750);
  near(f.dividendes.reserveLegale, 100);                        // 5 % du résultat plafonné à 10 % du capital (1 000 €)
  near(f.dividendes.distribuable, 49250 - 100);
  near(f.dividendes.flatTax.total, 49150 * 0.314, 0.02);
  assert.equal(f.dividendes.cotisationsExcedent10pct, 0, 'pas de cotisations sur dividendes en SASU');
  near(f.chargesSalaire, 16000); near(f.total, 10750 + 16000);
});

test('EURL à l\'IS : dividendes > 10 % du capital soumis aux cotisations TNS (gérant majoritaire)', () => {
  const p = proj({ meta: { forme: 'eurl_is', date_debut: '2027-01-01', capital: 1000, remuneration: { dividendes_annuels: 10000 } } });
  const c = ctx({ data: { projets: [p], invoices: [inv({ ht: 60000, paiement: '2027-03-10' })] } });
  const f = E.entrepriseFinance(c, p, 2027);
  near(f.dividendes.cotisationsExcedent10pct, (10000 - 100) * 0.45);
});

test('EURL à l\'IR : bénéfice avant cotisations, cotisations ≈ 45 % du net, IR indicatif', () => {
  const p = proj({ meta: { forme: 'eurl_ir', date_debut: '2027-01-01', tmi: 0.3 } });
  const c = ctx({ data: { projets: [p], invoices: [inv({ ht: 100000, paiement: '2027-03-10' })], tx: [tx({ sens: 'Dépense', categorie: 'Comptable & banque', montantEur: 20000, date: '2027-05-01' })] } });
  const f = E.entrepriseFinance(c, p, 2027);
  near(f.resultatAvantImpot, 80000); near(f.cotisationsTNS, 80000 * 0.45 / 1.45, 0.01);
  near(f.irIndicatif, (80000 - f.cotisationsTNS) * 0.3, 0.01);
});

test('fiscalIncome (contrat Impôt) : micro, EURL IR, SASU', () => {
  const micro = E.fiscalIncome(ctx({ data: { invoices: [inv({ ht: 50000, paiement: '2027-03-10' })] } }), proj(), 2027);
  assert.deepEqual([micro.regimeIR, micro.ca, micro.bnc, micro.bic, micro.versementLiberatoire, micro.salaireNetImposable, micro.dividendesBruts], ['micro', 50000, 33000, 0, false, 0, 0]);
  assert.deepEqual(micro.microAbattement, { taux: 0.34, montant: 17000 });
  const vl = E.fiscalIncome(ctx({ data: { projets: [proj({ meta: { forme: 'micro_bnc', date_debut: '2027-01-01', versement_liberatoire: true } })], invoices: [inv({ ht: 50000, paiement: '2027-03-10' })] } }), proj({ meta: { forme: 'micro_bnc', date_debut: '2027-01-01', versement_liberatoire: true } }), 2027);
  assert.equal(vl.versementLiberatoire, true); assert.equal(vl.caMicro, 50000);
  const pe = proj({ meta: { forme: 'eurl_ir', date_debut: '2027-01-01' } });
  const ir = E.fiscalIncome(ctx({ data: { projets: [pe], invoices: [inv({ ht: 100000, paiement: '2027-03-10' })] } }), pe, 2027);
  assert.equal(ir.regimeIR, 'reel_ir'); assert.equal(ir.bnc, 100000); near(ir.cotisationsDeductibles, 100000 * 0.45 / 1.45, 0.01);
  const ps = proj({ meta: { forme: 'sasu', date_debut: '2027-01-01', remuneration: { salaire_net_annuel: 24000, dividendes_annuels: 10000 } } });
  const is = E.fiscalIncome(ctx({ data: { projets: [ps], invoices: [inv({ ht: 100000, paiement: '2027-03-10' })] } }), ps, 2027);
  assert.equal(is.regimeIR, 'is'); assert.equal(is.salaireNetImposable, 24000); assert.equal(is.dividendesBruts, 10000); assert.equal(is.bnc + is.bic, 0);
  assert.ok(is.estimated);
});

test('deux entreprises à parts différentes : dividendes et flat tax calculés sur MES parts, jamais cumulés', () => {
  const a = proj({ id: 'pa', seq: 1, nom: 'A', part: 1, meta: { forme: 'sasu', date_debut: '2027-01-01', remuneration: { dividendes_annuels: 20000 } } });
  const b = proj({ id: 'pb', seq: 2, nom: 'B', part: 0.5, meta: { forme: 'sas', date_debut: '2027-01-01', remuneration: { dividendes_annuels: 20000 } } });
  const c = ctx({ data: { projets: [a, b], clients: [], invoices: [inv({ projetId: 'pa', ht: 60000, paiement: '2027-03-10' }), inv({ projetId: 'pb', ht: 60000, paiement: '2027-03-10' })] } });
  const rows = E.entreprisesSummary(c, 2027);
  assert.equal(rows.length, 2);
  near(rows[0].dividendesMesParts, 20000); near(rows[1].dividendesMesParts, 10000);
  near(rows[0].flatTax, 6280); near(rows[1].flatTax, 3140);
  assert.ok(rows.every((r) => !('total' in r)), 'pas de total mélangé');
});

test('lignes sans entreprise rattachées à la première entreprise seulement', () => {
  const a = proj({ id: 'pa', seq: 1 }), b = proj({ id: 'pb', seq: 2, nom: 'B' });
  const c = ctx({ data: { projets: [a, b], clients: [], invoices: [inv({ projetId: '', ht: 1000, paiement: '2027-03-10' })] } });
  assert.equal(E.entrepriseYear(c, a, 2027).paid, 1000); assert.equal(E.entrepriseYear(c, b, 2027).paid, 0);
});

test('reserveOnPayment : TVA, URSSAF, impôt à mettre de côté sur un paiement', () => {
  const c = ctx();
  const r = E.reserveOnPayment(c, proj(), { ht: 10000, ttc: 12000, date: '2027-03-10' });
  assert.deepEqual(r.items.map((i) => i.key), ['tva', 'urssaf', 'ir']);
  near(r.items[0].amount, 2000); near(r.items[1].amount, 10000 * 0.258); near(r.items[2].amount, 10000 * 0.66 * 0.3);
  near(r.total, 2000 + 2580 + 1980); near(r.net, 12000 - r.total);
  const vl = E.reserveOnPayment(c, proj({ meta: { forme: 'micro_bnc', date_debut: '2027-01-01', versement_liberatoire: true } }), { ht: 10000, date: '2027-03-10' });
  assert.deepEqual(vl.items.map((i) => i.key), ['urssaf', 'vl']); near(vl.items[1].amount, 220);
});

test('planning micro mensuel : fin du mois suivant, report au jour ouvré, rien avant le démarrage', () => {
  const d = E.deadlinesFor(proj(), 2027);
  const u = d.filter((x) => x.code === 'urssaf');
  assert.equal(u.length, 11, 'CA de janvier à novembre 2027 (décembre = janvier 2028)');
  assert.equal(u[0].periode, '2027-01'); assert.equal(u[0].date, '2027-03-01', '28 février 2027 est un dimanche');
  assert.equal(u[1].date, '2027-03-31');
  assert.ok(!d.some((x) => x.code === 'urssaf' && x.periode === '2026-12'));
  assert.equal(E.deadlinesFor(proj(), 2028).filter((x) => x.code === 'urssaf')[0].periode, '2027-12');
  assert.equal(E.deadlinesFor(proj(), 2028).filter((x) => x.code === 'urssaf')[0].date, '2028-01-31');
  const cfe = d.find((x) => x.code === 'cfe_decl'); assert.equal(cfe.date, '2027-12-31');
  assert.equal(E.deadlinesFor(proj(), 2028).find((x) => x.code === 'cfe_paiement').date, '2028-12-15');
  assert.ok(!d.some((x) => x.code === 'cfe_paiement'), 'exonération la 1re année');
  assert.equal(E.deadlinesFor(proj(), 2028).find((x) => x.code === 'ir_2042').periode, '2027');
  assert.ok(!d.some((x) => x.code === 'ir_2042'), 'pas de revenus 2026 à déclarer');
});

test('planning micro trimestriel : 30 avril, 31 juillet, 31 octobre, 31 janvier', () => {
  const p = proj({ meta: { forme: 'micro_bnc', date_debut: '2027-01-01', urssaf_periodicite: 'trimestrielle' } });
  const u = E.deadlinesFor(p, 2027).filter((x) => x.code === 'urssaf').map((x) => [x.periode, x.date]);
  // 31 juillet 2027 = samedi → lundi 2 août ; 31 octobre 2027 = dimanche → lundi 1er novembre (report au 1er jour ouvrable)
  assert.deepEqual(u, [['2027-T1', '2027-04-30'], ['2027-T2', '2027-08-02'], ['2027-T3', '2027-11-01']]);
  assert.equal(E.deadlinesFor(p, 2028).find((x) => x.code === 'urssaf').periode, '2027-T4');
  assert.equal(E.deadlinesFor(p, 2028).find((x) => x.code === 'urssaf').date, '2028-01-31');
});

test('planning SASU à l\'IS (clôture 31/12, début 2027) : pas d\'acompte au 1er exercice, solde 15 mai, liasse, AG, greffe', () => {
  const p = proj({ meta: { forme: 'sasu', date_debut: '2027-01-01', remuneration: { salaire_net_annuel: 12000 } } });
  const d27 = E.deadlinesFor(p, 2027), d28 = E.deadlinesFor(p, 2028);
  assert.ok(!d27.some((x) => x.code === 'is_acompte'), 'pas d\'acompte pendant le 1er exercice');
  assert.deepEqual(d28.filter((x) => x.code === 'is_acompte').map((x) => x.date), ['2028-03-15', '2028-06-15', '2028-09-15', '2028-12-15']);
  assert.equal(d28.find((x) => x.code === 'is_solde' && x.periode === '2027-12-31').date, '2028-05-15');
  assert.equal(d28.find((x) => x.code === 'liasse').date, '2028-05-03', '2e jour ouvré suivant le 1er mai 2028 (lundi)');
  assert.equal(d28.find((x) => x.code === 'ag').date, '2028-06-30');
  assert.ok(d28.find((x) => x.code === 'greffe').date > '2028-06-30');
  assert.equal(d27.filter((x) => x.code === 'dsn').length, 11, 'DSN mensuelle (salaire prévu)');
  assert.equal(d27.find((x) => x.code === 'dsn').date, '2027-02-15');
});

test('planning TVA : CA3 trimestrielle, fin du réel simplifié au 1er janvier 2027 (dernière CA12 le 4 mai 2027), franchise = rien', () => {
  const base = { forme: 'sasu', date_debut: '2025-03-01' };
  const ca3 = E.deadlinesFor(proj({ meta: { ...base, tva_regime: 'reel_normal', tva_periodicite: 'trimestrielle' } }), 2027).filter((x) => x.code === 'tva_ca3');
  assert.deepEqual(ca3.map((x) => x.periode), ['2026-T4', '2027-T1', '2027-T2', '2027-T3']);
  const simpl = (y) => E.deadlinesFor(proj({ meta: { ...base, tva_regime: 'reel_simplifie' } }), y);
  assert.equal(simpl(2026).find((x) => x.code === 'tva_ca12').date, '2026-05-05');
  assert.deepEqual(simpl(2026).filter((x) => x.code.startsWith('tva_acompte')).map((x) => x.date), ['2026-07-15', '2026-12-15']);
  assert.equal(simpl(2027).find((x) => x.code === 'tva_ca12').date, '2027-05-04');
  assert.ok(!simpl(2027).some((x) => x.code.startsWith('tva_acompte')), 'plus d\'acompte CA12 en 2027');
  assert.deepEqual(simpl(2027).filter((x) => x.code === 'tva_ca3').map((x) => x.periode), ['2027-T1', '2027-T2', '2027-T3']);
  assert.ok(!E.deadlinesFor(proj(), 2027).some((x) => x.code.startsWith('tva')), 'franchise : aucune déclaration');
});

test('upcomingDeadlines : à venir, en retard, cochées (declarations) et alertes', () => {
  const c = ctx({ today: '2027-03-27' });
  const up = E.upcomingDeadlines(c, '2027-03-27', 10).filter((d) => !d.late);
  assert.equal(up.length, 1); assert.equal(up[0].code, 'urssaf'); assert.equal(up[0].date, '2027-03-31'); assert.equal(up[0].inDays, 4);
  const late = E.upcomingDeadlines(ctx({ today: '2027-03-05' }), '2027-03-05', 0);
  assert.equal(late.length, 1); assert.equal(late[0].late, true, 'URSSAF de janvier (échéance 1er mars) non cochée');
  const done = E.upcomingDeadlines(ctx({ today: '2027-03-05', data: { declarations: [{ id: 'd1', projetId: 'p1', code: 'urssaf', periode: '2027-01', statut: 'paye' }] } }), '2027-03-05', 0);
  assert.equal(done.length, 0);
  assert.equal(E.upcomingDeadlines(ctx({ today: '2027-03-05', data: { declarations: [{ id: 'd1', projetId: 'p1', code: 'urssaf', periode: '2027-01', statut: 'paye' }] } }), '2027-03-05', 0, { includeDone: true })[0].done, true);
  const al = E.entrepriseAlerts(ctx({ today: '2027-03-29' }));
  assert.ok(al.some((a) => a.id === 'decl:p1:urssaf:2027-02'), 'alerte d\'échéance J-2');
});

test('alertes : démarrage à moins de 30 jours, plafond dépassé en projection, seuil TVA, jours travaillés fin de mois', () => {
  const d = E.entrepriseAlerts(ctx({ today: '2026-12-20' }));
  assert.ok(d.some((a) => a.id === 'ent_demarrage:p1' && /dans 12 jours/.test(a.title)));
  const big = ctx({ today: '2027-06-10', data: { invoices: [inv({ ht: 40000, paiement: '2027-03-10' }), inv({ ht: 50000, statut: 'Planifiée', periode: '2027-09', paiement: null, emission: null })] } });
  const a = E.entrepriseAlerts(big);
  assert.ok(a.some((x) => x.id === 'seuil_tva:p1'), '40 000 € > franchise 37 500 €');
  assert.ok(a.some((x) => x.id === 'seuil_tva:p1' && x.kind === 'warn'));
  const bigger = ctx({ today: '2027-06-10', data: { invoices: [inv({ ht: 42000, paiement: '2027-03-10' })] } });
  assert.ok(E.entrepriseAlerts(bigger).some((x) => x.id === 'seuil_tva_maj:p1' && x.kind === 'bad'));
  const proj2 = ctx({ today: '2027-06-10', data: { invoices: [inv({ ht: 10000, paiement: '2027-03-10' }), inv({ ht: 80000, statut: 'Planifiée', periode: '2027-09', paiement: null, emission: null })] } });
  assert.ok(E.entrepriseAlerts(proj2).some((x) => x.id === 'seuil_micro:p1'));
  const fin = E.entrepriseAlerts(ctx({ today: '2027-03-27' }));
  assert.ok(fin.some((x) => x.id === 'ent_jours:p1:2027-03' && x.go === '#/entreprise?jours=2027-03'));
});

test('santé de l\'entreprise : plafond, retards, dépendance client, provision', () => {
  const c = ctx({ today: '2027-06-10', data: { invoices: [inv({ ht: 20000, paiement: '2027-03-10' }), inv({ ht: 5000, statut: 'Envoyée', emission: '2027-04-01', paiement: null, periode: '2027-03' })],
    tx: [tx({ montantEur: 20000, date: '2027-03-10' })] } });
  const h = E.entrepriseHealth(c);
  const by = Object.fromEntries(h.map((i) => [i.id.split(':')[0], i]));
  assert.equal(by.ent_plafond.level, 'good'); assert.equal(by.ent_retards.level, 'bad'); assert.equal(by.ent_clients.value, 1);
  assert.ok(by.ent_provision, 'provision calculée'); assert.equal(by.ent_declarations.level, 'bad', 'échéances URSSAF non cochées');
  assert.equal(E.entrepriseHealth(ctx({ today: '2026-12-01' })).length, 0, 'rien avant le démarrage');
});

test('facturation : jours × TJM, TVA, mentions légales, CSV, texte pour Tiime', () => {
  assert.deepEqual(E.invoiceAmounts({ jours: 18.5, tjm: 650, tva: 0.2 }), { ht: 12025, tva: 2405, ttc: 14430 });
  const m = E.invoiceMentions(proj(), { tva: 0, emission: '2027-01-31' });
  assert.ok(m.some((l) => /293 B du CGI/.test(l)) && m.some((l) => /40 €/.test(l)) && m.some((l) => /30 jours \(échéance : 02\/03\/2027\)/.test(l)));
  assert.ok(!E.invoiceMentions(proj({ meta: { forme: 'sasu' } }), { tva: 0.2 }).some((l) => /293 B/.test(l)));
  const i = { numero: 'F-2027-001', client: 'Talan', periode: '2027-01', jours: 20, tjm: 650, devise: 'EUR', ht: 13000, tva: 0.2, ttc: 15600, emission: '2027-01-31', statut: 'Envoyée', paiement: '', refExt: 'TIIME-42' };
  assert.match(E.invoiceCsv(proj(), [i]), /F-2027-001";"Talan";"2027-01";"20";"650";"EUR";"13000";"20 %"/);
  assert.match(E.invoiceLinesText(proj(), i), /Quantité : 20 jour\(s\)[\s\S]*Total HT : 13000 EUR/);
  const c = ctx({ data: { invoices: [inv({ periode: '2027-02', jours: 10, statut: 'Planifiée', paiement: null, emission: null })] } });
  const lines = E.billingLines(c, proj(), '2027-02');
  assert.equal(lines.length, 1); assert.equal(lines[0].jours, 10); assert.equal(lines[0].locked, false);
  assert.equal(E.billingLines(c, proj(), '2027-03')[0].jours, 0);
  assert.equal(E.workingDays('2027-02'), 20);
});

test('obligationsResume : texte selon les choix', () => {
  const l = E.obligationsResume({ forme: 'micro_bnc', versement_liberatoire: true, date_debut: '2027-01-01' });
  assert.ok(l.some((x) => /83\s?600/.test(x)) && l.some((x) => /25,6 %/.test(x)) && l.some((x) => /Versement libératoire : 2,2 %/.test(x)));
  assert.ok(E.obligationsResume({ forme: 'sasu' }).some((x) => /31,4 %/.test(x)));
});
