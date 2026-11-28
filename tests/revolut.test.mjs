// Tests de l'import de relevés Revolut : lecture CSV (EN/FR/Business), Excel, PDF, empreintes anti-doublon, classification.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as XLSX from 'xlsx';
import { parseCsv, parseCsvRows, parseAmount, parseDate, parseXlsx, parsePdfItems, parseStatementFile, kindOf, normLabel, extractPdfItems } from '../app/js/revolut.js';
import { classifyLines, findDuplicates, pickCategory, isOwnTransfer } from '../app/js/classify.js';
import { buildMockDb } from './mockdata.mjs';

const fx = (f) => fs.readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');

test('montants : formats FR/EN, séparateurs, signes, symboles', () => {
  assert.equal(parseAmount('-23.40'), -23.4);
  assert.equal(parseAmount('1,234.56'), 1234.56);
  assert.equal(parseAmount('1.234,56'), -(-1234.56));
  assert.equal(parseAmount('1 234,56'), 1234.56);
  assert.equal(parseAmount('-1 234,56'), -1234.56);
  assert.equal(parseAmount('−5,00'), -5);
  assert.equal(parseAmount('€12.50'), 12.5);
  assert.equal(parseAmount('(12.50)'), -12.5);
  assert.equal(parseAmount('1,234'), 1234);                 // virgule + 3 chiffres = milliers
  assert.equal(parseAmount('1,234', ','), 1.234);           // …sauf fichier à virgule décimale
  assert.equal(parseAmount('12,5'), 12.5);
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount('abc'), null);
  assert.equal(parseAmount(42.1), 42.1);
});

test('dates : ISO, JJ/MM/AAAA, texte FR/EN, série Excel, Date', () => {
  assert.equal(parseDate('2026-11-03 02:10:05'), '2026-11-03');
  assert.equal(parseDate('03/11/2026'), '2026-11-03');
  assert.equal(parseDate('3.11.26'), '2026-11-03');
  assert.equal(parseDate('12 nov. 2025'), '2025-11-12');
  assert.equal(parseDate('12 novembre 2025'), '2025-11-12');
  assert.equal(parseDate('Nov 12, 2025'), '2025-11-12');
  assert.equal(parseDate('12 Feb 2026'), '2026-02-12');
  assert.equal(parseDate('1 déc. 2026'), '2026-12-01');
  assert.equal(parseDate(46000), '2025-12-09');
  assert.equal(parseDate(new Date(2026, 10, 3)), '2026-11-03');
  assert.equal(parseDate('31/02/2026'), '');
  assert.equal(parseDate('n/a'), '');
});

test('CSV : délimiteur, guillemets, retours à la ligne, BOM', () => {
  const rows = parseCsvRows('﻿a;b;c\r\n"x;1";"he said ""hi""";\r\n"ligne\nmultiple";2;3\r\n');
  assert.equal(rows.delimiter, ';');
  assert.deepEqual(rows[1], ['x;1', 'he said "hi"', '']);
  assert.deepEqual(rows[2], ['ligne\nmultiple', '2', '3']);
});

test('types d\'opération Revolut (EN, FR, texte libre)', () => {
  assert.equal(kindOf('CARD_PAYMENT'), 'card'); assert.equal(kindOf('Paiement par carte'), 'card');
  assert.equal(kindOf('TOPUP'), 'topup'); assert.equal(kindOf('Rechargement'), 'topup');
  assert.equal(kindOf('EXCHANGE'), 'exchange'); assert.equal(kindOf('Change'), 'exchange');
  assert.equal(kindOf('ATM'), 'atm'); assert.equal(kindOf('FEE'), 'fee'); assert.equal(kindOf('CARD_REFUND'), 'refund');
  assert.equal(kindOf('TRANSFER'), 'transfer'); assert.equal(kindOf('Virement'), 'transfer');
  assert.equal(kindOf('', 'Exchanged to USD'), 'exchange'); assert.equal(kindOf('', 'To Fatima'), 'transfer');
});

test('CSV personnel anglais : lignes, frais séparés, états, devises, empreintes', () => {
  const r = parseCsv(fx('revolut-perso-en.csv'));
  assert.equal(r.error, undefined);
  assert.equal(r.format, 'csv-perso');
  const byLabel = (s) => r.lines.filter((l) => l.libelle.includes(s));
  // deux paiements identiques le même jour : deux lignes, deux empreintes différentes
  const lidl = byLabel('Lidl');
  assert.equal(lidl.length, 2); assert.notEqual(lidl[0].hash, lidl[1].hash);
  assert.equal(lidl[0].montant, -23.4); assert.equal(lidl[0].date, '2026-11-03'); assert.equal(lidl[0].solde, 1476.6);
  // libellé avec virgule entre guillemets
  assert.equal(byLabel('Bistrot')[0].libelle, 'Le Bistrot, Rue de la Paix');
  // frais traités comme une dépense séparée
  const fees = r.lines.filter((l) => l.kind === 'fee');
  assert.deepEqual(fees.map((f) => f.montant), [-0.5, -2]);
  assert.match(fees[0].libelle, /^Frais — Exchanged to USD/);
  // types
  assert.equal(byLabel('Exchanged')[0].kind, 'exchange'); assert.equal(byLabel('Top-Up')[0].kind, 'topup'); assert.equal(byLabel('ATM')[0].kind, 'atm'); assert.equal(byLabel('refund')[0].kind, 'refund');
  assert.equal(byLabel('Salaire')[0].montant, 3150);
  // GBP gardé, JPY signalé, PENDING et REVERTED écartés
  assert.equal(byLabel('Hotel London')[0].devise, 'GBP');
  const reasons = Object.fromEntries(r.skipped.map((s) => [s.label, s.reason]));
  assert.equal(reasons['Amazon Marketplace'], 'en cours'); assert.equal(reasons['Uber Trip'], 'annulée ou refusée'); assert.match(reasons['Cafe Tokyo'], /JPY/);
  assert.ok(!r.lines.some((l) => /Amazon|Uber|Tokyo/.test(l.libelle)));
  // ré-import : mêmes empreintes ; empreintes toutes distinctes
  const again = parseCsv(fx('revolut-perso-en.csv'));
  assert.deepEqual(again.lines.map((l) => l.hash), r.lines.map((l) => l.hash));
  assert.equal(new Set(r.lines.map((l) => l.hash)).size, r.lines.length);
});

test('relevé qui chevauche : les opérations communes ont la même empreinte', () => {
  const full = parseCsv(fx('revolut-perso-en.csv'));
  const text = fx('revolut-perso-en.csv').split('\n');
  const partial = parseCsv([text[0], ...text.slice(5)].join('\n'));   // commence plus tard
  const h = new Set(full.lines.map((l) => l.hash));
  const common = partial.lines.filter((l) => h.has(l.hash));
  assert.equal(common.length, partial.lines.length, 'toutes les lignes du relevé partiel existent déjà dans le complet');
});

test('CSV personnel français : BOM, point-virgule, virgules décimales, milliers, état annulé', () => {
  const r = parseCsv(fx('revolut-perso-fr.csv'));
  assert.equal(r.error, undefined);
  const m = Object.fromEntries(r.lines.map((l) => [l.libelle, l]));
  assert.equal(m['Carrefour Market'].montant, -1234.56); assert.equal(m['Carrefour Market'].solde, 3765.44);
  assert.equal(m['Loyer octobre'].montant, -1150);
  assert.equal(m['Remboursement ami'].montant, 45.5);
  assert.equal(m['Abonnement Revolut Premium'].kind, 'fee');
  assert.equal(r.skipped.length, 1); assert.equal(r.skipped[0].reason, 'annulée ou refusée');
  assert.ok(r.lines.every((l) => /^2026-10-\d\d$/.test(l.date)));
});

test('CSV Revolut Business : référence ajoutée au libellé, frais, refusé écarté', () => {
  const r = parseCsv(fx('revolut-business.csv'));
  assert.equal(r.format, 'csv-business');
  const m = Object.fromEntries(r.lines.map((l) => [l.libelle, l]));
  assert.equal(m['Notion Labs'].montant, -9.2); assert.equal(m['Notion Labs'].devise, 'EUR');
  assert.equal(m['Talan SAS — Facture F-2027-001'].montant, 15600);
  assert.equal(m['SNCF — Déplacement client'].montant, -120);
  assert.equal(r.lines.filter((l) => l.kind === 'fee').length, 1);           // 0,50 € sur la ligne SNCF
  assert.equal(r.lines.find((l) => l.kind === 'fee').montant, -0.5);
  assert.deepEqual(r.skipped.map((s) => s.reason), ['annulée ou refusée']);
  assert.deepEqual(r.accounts, ['Main']);
});

test('fichier inconnu : message clair, aucune ligne', () => {
  const r = parseCsv('foo,bar\n1,2\n');
  assert.ok(r.error && /Revolut/.test(r.error)); assert.equal(r.lines.length, 0);
});

test('Excel : mêmes lignes que le CSV (dates Excel, nombres natifs)', async () => {
  const rows = parseCsvRows(fx('revolut-perso-en.csv'));
  const aoa = rows.map((r, i) => (i === 0 ? r : r.map((c, ci) => (ci === 5 || ci === 6 || ci === 9 ? (c === '' ? '' : Number(c)) : c))));
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Transactions');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const viaXlsx = await parseStatementFile(buf, { name: 'releve.xlsx', XLSX });
  const viaCsv = parseCsv(fx('revolut-perso-en.csv'));
  assert.equal(viaXlsx.format, 'xlsx-perso');
  assert.deepEqual(viaXlsx.lines.map((l) => [l.date, l.libelle, l.montant, l.devise, l.hash]), viaCsv.lines.map((l) => [l.date, l.libelle, l.montant, l.devise, l.hash]));
  // vraies dates Excel (cellules date)
  const wb2 = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb2, XLSX.utils.aoa_to_sheet([['Type', 'Started Date', 'Completed Date', 'Description', 'Amount', 'Fee', 'Currency', 'State', 'Balance'], ['CARD_PAYMENT', new Date(Date.UTC(2026, 10, 3, 8)), new Date(Date.UTC(2026, 10, 4, 2)), 'Test', -5, 0, 'EUR', 'COMPLETED', 10]], { cellDates: true }), 'S');
  const r2 = parseXlsx(XLSX, XLSX.write(wb2, { type: 'array', bookType: 'xlsx', cellDates: true }));
  assert.equal(r2.lines.length, 1); assert.match(r2.lines[0].date, /^2026-11-0[34]$/); assert.equal(r2.lines[0].montant, -5);
});

test('détection du type de fichier par le contenu (sans extension)', async () => {
  const buf = new TextEncoder().encode(fx('revolut-perso-fr.csv'));
  const r = await parseStatementFile(buf, { name: 'export' });
  assert.equal(r.lines.length, 5);
  const bad = await parseStatementFile(new TextEncoder().encode('%PDF-1.4 junk'), { name: 'x.pdf' });
  assert.match(bad.error, /PDF|CSV/);
});

// ---------- PDF ----------
const HTML_PDF = `<html><head><meta charset="utf-8"><style>
body{font-family:Arial;font-size:11px;margin:30px} h1{font-size:18px} table{width:100%;border-collapse:collapse}
th{text-align:left;border-bottom:1px solid #000;padding:4px 0;white-space:nowrap} td{padding:5px 0;vertical-align:top} td:first-child,td.r{white-space:nowrap} .r{text-align:right} .small{color:#666}
</style></head><body>
<h1>EUR Statement</h1><p>Account transactions from 1 November 2026 to 30 November 2026</p>
<p>Balance summary: Opening balance €1,500.00 · Closing balance €4,820.15</p>
<table><thead><tr><th style="width:90px">Date</th><th>Description</th><th class="r" style="width:90px">Money out</th><th class="r" style="width:90px">Money in</th><th class="r" style="width:90px">Balance</th></tr></thead><tbody>
<tr><td>Nov 3, 2026</td><td>Lidl Paris 11<br><span class="small">Card: 123456******1234</span></td><td class="r">€23.40</td><td class="r"></td><td class="r">€1,476.60</td></tr>
<tr><td>Nov 5, 2026</td><td>Salaire LVMH</td><td class="r"></td><td class="r">€3,150.00</td><td class="r">€4,626.60</td></tr>
<tr><td>Nov 12, 2026</td><td>To Fatima Hamdi<br><span class="small">Reference: Cadeau anniversaire</span></td><td class="r">€250.00</td><td class="r"></td><td class="r">€4,376.60</td></tr>
<tr><td>Nov 20, 2026</td><td>Le Bistrot Rue de la Paix avec un libellé assez long pour passer à la ligne suivante dans la colonne</td><td class="r">€1,234.56</td><td class="r"></td><td class="r">€3,142.04</td></tr>
${Array.from({ length: 60 }, (_, i) => `<tr><td>Nov ${(i % 9) + 21}, 2026</td><td>Paiement test ${i + 1}</td><td class="r">€${(i + 1).toFixed(2)}</td><td class="r"></td><td class="r">€${(3000 - i).toFixed(2)}</td></tr>`).join('\n')}
</tbody></table><p>Revolut Bank UAB — Page 1</p></body></html>`;

async function makePdf() {
  const { launch } = await import('./browser.mjs');
  const b = await launch();
  try { const p = await b.newPage(); await p.setContent(HTML_PDF); return await p.pdf({ format: 'A4' }); } finally { await b.close(); }
}

test('PDF : extraction par position (colonnes, dates texte, lignes de suite, plusieurs pages)', async (t) => {
  let pdf;
  try { pdf = await makePdf(); } catch (e) { return t.skip('Chromium indisponible : ' + e.message); }
  const pdfjs = await import('../app/vendor/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(path.resolve('app/vendor/pdf.worker.min.mjs')).href;
  const r = await parseStatementFile(new Uint8Array(pdf), { name: 'releve.pdf', pdfjs });
  assert.equal(r.error, undefined, r.error);
  assert.equal(r.format, 'pdf');
  assert.equal(r.lines.length, 64);
  const m = Object.fromEntries(r.lines.map((l) => [l.libelle.slice(0, 14), l]));
  assert.equal(m['Lidl Paris 11'].montant, -23.4); assert.equal(m['Lidl Paris 11'].date, '2026-11-03'); assert.equal(m['Lidl Paris 11'].solde, 1476.6); assert.equal(m['Lidl Paris 11'].devise, 'EUR');
  assert.equal(m['Salaire LVMH'].montant, 3150);
  assert.equal(m['To Fatima Hamd'].montant, -250); assert.match(m['To Fatima Hamd'].libelle, /Cadeau anniversaire/);
  assert.equal(m['Le Bistrot Rue'].montant, -1234.56); assert.match(m['Le Bistrot Rue'].libelle, /colonne$/);
  assert.ok(!r.lines.some((l) => /Card:/.test(l.libelle)));
  assert.equal(r.lines.filter((l) => l.kind === 'transfer').length, 1);
  assert.equal(new Set(r.lines.map((l) => l.hash)).size, 64);
  const again = await parseStatementFile(new Uint8Array(pdf), { name: 'releve.pdf', pdfjs });
  assert.deepEqual(again.lines.map((l) => l.hash), r.lines.map((l) => l.hash));
});

test('PDF : mise en page inconnue → message clair', () => {
  const r = parsePdfItems([{ str: 'Bonjour', x: 10, y: 100, w: 30, page: 1 }, { str: 'Rien à voir', x: 10, y: 80, w: 50, page: 1 }]);
  assert.match(r.error, /CSV ou Excel/); assert.equal(r.lines.length, 0);
});

test('PDF : en-têtes français et dates « 12 nov. 2026 »', () => {
  const it = (str, x, y, w = str.length * 5) => ({ str, x, y, w, page: 1 });
  const items = [it('Relevé EUR', 30, 800), it('Date', 30, 700), it('Description', 120, 700), it('Argent sortant', 300, 700, 60), it('Argent entrant', 380, 700, 60), it('Solde', 470, 700, 25),
    it('12 nov. 2026', 30, 680), it('Boulangerie Paul', 120, 680), it('3,40', 340, 680, 20), it('96,60', 470, 680, 25),
    it('13 nov. 2026', 30, 660), it('Remboursement ami', 120, 660), it('1 045,50', 410, 660, 40), it('1 142,10', 450, 660, 45)];
  const r = parsePdfItems(items);
  assert.equal(r.error, undefined);
  assert.deepEqual(r.lines.map((l) => [l.date, l.montant, l.solde]), [['2026-11-12', -3.4, 96.6], ['2026-11-13', 1045.5, 1142.1]]);
  assert.equal(r.lines[0].devise, 'EUR');
});

test('PDF réel Revolut France (relevé multi-comptes) : pied de page, en-tête de page, internes, « Stop Frais », titulaire', () => {
  const it = (str, x, y, w = str.length * 5, page = 1) => ({ str, x, y, w, page });
  const page = (n, cur, rows) => [
    it(`Relevé ${cur}`, 452, 757, 60, n), it('Généré le 28 nov. 2026', 470, 744, 80, n), it('Revolut France succursale de Revolut Bank UAB', 381, 731, 150, n),
    ...(n === 1 ? [it('MOHAMED HAMDI', 40, 689, 70, n)] : []),
    it('Transactions du compte : du 1 novembre 2026 au 28 novembre 2026', 40, 307, 250, n),
    it('Date', 43, 281, 20, n), it('Description', 125, 281, 50, n), it('Argent sortant', 335, 281, 60, n), it('Argent entrant', 417, 281, 60, n), it('Solde', 535, 281, 25, n),
    ...rows,
    it('Signaler une carte perdue ou volée', 85, 110, 120, n), it('+370 5 214 3608', 85, 100, 60, n), it('Revolut Bank UAB est un établissement de crédit agréé', 267, 112, 200, n)];
  const row = (y, date, desc, out, inn, bal, sub = [], n = 1) => [it(date, 43, y, 45, n), it(desc, 125, y, desc.length * 5, n), ...(out ? [it(out, 335, y, 40, n)] : []), ...(inn ? [it(inn, 417, y, 45, n)] : []), it(bal, 522, y, 40, n), ...sub.map((t, i) => it(t, 125, y - 8 * (i + 1), t.length * 5, n))];
  const items = [
    ...page(1, 'EUR', [
      ...row(262, '1 nov. 2026', 'Paiement envoyé par M MOHAMED HAMDI', '', '1800,00€', '1808,21€', ['De : M MOHAMED HAMDI, FR3930002026000000584270E11']),
      ...row(220, '6 nov. 2026', 'Vers le compte d\'investissement', '800,00€', '', '1008,21€'),
      ...row(190, '20 nov. 2026', 'Hyper Halal', '56,64€', '', '951,57€', ['À : Stop Frais, Nanterre']),
      ...row(160, '21 nov. 2026', 'Auchan', '55,62€', '', '895,95€', ['À : Auchan 0031m, Puteaux', 'Carte : 416598******3480'])]),
    ...page(2, 'USD', [...row(262, '19 nov. 2026', 'Recharge', '', '8,35$', '9,19$', ['From investment account'], 2)])];
  const r = parsePdfItems(items);
  assert.equal(r.error, undefined);
  assert.equal(r.holder, 'MOHAMED HAMDI');
  assert.equal(r.lines.length, 5);
  const by = (d) => r.lines.find((l) => l.libelle.startsWith(d));
  assert.equal(by('Paiement envoyé').kind, 'transfer'); assert.equal(by('Paiement envoyé').montant, 1800);
  assert.ok(!/FR39/.test(by('Paiement envoyé').libelle), 'IBAN retiré du libellé');
  assert.equal(by('Vers le compte').kind, 'internal');
  assert.equal(by('Hyper Halal').kind, 'card', '« Stop Frais » est un commerçant, pas des frais');
  assert.equal(by('Hyper Halal').libelle, 'Hyper Halal');
  assert.equal(by('Auchan').libelle, 'Auchan');
  const usd = r.lines.find((l) => l.devise === 'USD'); assert.equal(usd.montant, 8.35); assert.equal(usd.kind, 'internal');
  assert.ok(r.lines.every((l) => !/Signaler|Revolut Bank|Relevé|Généré/.test(l.libelle)), 'pas de pied ni d\'en-tête de page dans les libellés');
  // titulaire connu : le virement depuis son autre compte est ignoré automatiquement
  const cls = classifyLines(r.lines, { tx: [], categories: [], ownNames: ['Mohamed Hamdi'] }, { activite: 'Perso' });
  assert.equal(cls[r.lines.indexOf(by('Paiement envoyé'))].ignore, true);
  assert.equal(cls[r.lines.indexOf(by('Vers le compte'))].ignore, true);
});

// ---------- classification ----------
const db = buildMockDb({ withBackup: false });
const mapRow = (r) => ({ ...r, projetId: r.projet_id, montantEur: r.montant_eur });
const extraCats = [{ activite: 'Entreprise', sens: 'Dépense', categorie: 'Repas & réceptions', nature: 'Courant' }, { activite: 'Perso', sens: 'Dépense', categorie: 'Cadeaux', nature: 'Courant' }, { activite: 'Perso', sens: 'Dépense', categorie: 'Virement émis', nature: 'Courant' }, { activite: 'Perso', sens: 'Revenu', categorie: 'Virement reçu', nature: 'Courant' }];
const ctx = { tx: db.tx.map(mapRow), categories: [...db.categories, ...extraCats], ownNames: ['Mohamed Hamdi'] };
const L = (libelle, montant, kind = 'card', extra = {}) => ({ date: '2026-11-10', libelle, montant, devise: 'EUR', kind, ...extra });

test('classification : virements internes ignorés, frais, règles de mots-clés, historique', () => {
  const lines = [L('Exchanged to USD', -100, 'exchange'), L('Top-Up by *1234', 500, 'topup'), L('To Mohamed Hamdi', -300, 'transfer'), L('To Fatima Hamdi', -250, 'transfer'),
    L('Frais — ATM Casablanca', -2, 'fee'), L('Netflix.com', -17.99), L('SNCF Connect', -89.9), L('Boucherie Dupont', -22), L('Salaire LVMH', 3150, 'transfer'), L('Lidl Paris 11', -23.4)];
  const c = classifyLines(lines, ctx, { activite: 'Perso' });
  assert.ok(c[0].ignore && c[1].ignore && c[2].ignore, 'change, rechargement, virement vers soi-même : ignorés');
  assert.ok(!c[3].ignore && c[3].review, 'virement vers un tiers : à vérifier');
  assert.equal(c[3].categorie, 'Virement émis');
  assert.equal(c[4].categorie, 'Frais Bancaires');
  assert.equal(c[5].categorie, 'Abonnements Numériques'); assert.equal(c[6].categorie, 'Transports en Commun');
  assert.equal(c[7].categorie, ''); assert.ok(c[7].review);
  assert.equal(c[8].categorie, 'Salaire & primes'); assert.equal(c[8].sens, 'Revenu');
  assert.equal(c[9].categorie, 'Courses'); assert.equal(c[9].how, 'historique', 'Lidl déjà catégorisé dans l\'historique');
  // l'historique prime sur les mots-clés
  const tx2 = [...ctx.tx, { id: 'h1', date: '2026-10-01', activite: 'Perso', sens: 'Dépense', categorie: 'Cadeaux', libelle: 'Boucherie Dupont', montant: 40, devise: 'EUR' }];
  const c2 = classifyLines([L('Boucherie Dupont Paris', -22)], { ...ctx, tx: tx2 }, { activite: 'Perso' });
  assert.equal(c2[0].categorie, 'Cadeaux'); assert.equal(c2[0].how, 'historique');
});

test('classification : activité Entreprise et Immobilier, catégories renommées par l\'utilisateur', () => {
  const e = classifyLines([L('Notion Labs', -9.2), L('SNCF', -120), L('Talan SAS Facture F-2027-001', 15600, 'transfer'), L('Cabinet Compta honoraires', -300, 'transfer'), L('Restaurant client', -45)], ctx, { activite: 'Entreprise' });
  assert.deepEqual(e.map((x) => x.categorie), ['Logiciels & abonnements', 'Déplacements pro', 'Prestations', 'Comptable & banque', 'Repas & réceptions']);
  const i = classifyLines([L('EDF facture', -80), L('Lydec eau', -30)], ctx, { activite: 'Immobilier' });
  assert.deepEqual(i.map((x) => x.categorie), ['Eau & électricité', 'Eau & électricité']);
  const cats = [{ activite: 'Perso', sens: 'Dépense', categorie: 'Supermarché & courses', nature: 'Courant' }];
  assert.equal(pickCategory(cats, 'Perso', 'Dépense', ['Courses']).categorie, 'Supermarché & courses');
  assert.equal(pickCategory(cats, 'Perso', 'Revenu', ['Courses']), null);
});

test('virement entre ses propres comptes : prénom ET nom requis', () => {
  assert.ok(isOwnTransfer('To MOHAMED HAMDI', ['Mohamed Hamdi']));
  assert.ok(!isOwnTransfer('To Mohamed Benali', ['Mohamed Hamdi']));
  assert.ok(!isOwnTransfer('To Fatima', ['Mohamed Hamdi']));
});

test('doublons avec les opérations déjà saisies : montant, devise, ±2 jours, libellé proche', () => {
  const tx = [
    { id: 't1', date: '2026-11-09', activite: 'Perso', sens: 'Dépense', categorie: 'Courses', libelle: 'Lidl', montant: 23.4, devise: 'EUR', ref: '' },
    { id: 't2', date: '2026-11-10', activite: 'Perso', sens: 'Dépense', categorie: 'Loisirs & Divertissements', libelle: 'Cinéma', montant: 12, devise: 'EUR', ref: '' },
    { id: 't3', date: '2026-11-01', activite: 'Perso', sens: 'Dépense', categorie: 'Courses', libelle: 'Lidl', montant: 23.4, devise: 'EUR', ref: '' },
    { id: 't4', date: '2026-11-10', activite: 'Perso', sens: 'Dépense', categorie: 'Courses', libelle: 'Lidl', montant: 23.4, devise: 'EUR', ref: 'REV:abc' },
  ];
  const lines = [L('Lidl Paris 11', -23.4), L('Lidl Paris 11', -23.4), L('Uber', -12), L('Salaire', 23.4, 'transfer'), L('Lidl', -23.4, 'card', { devise: 'USD' })];
  const d = findDuplicates(lines, tx);
  assert.equal(d[0] && d[0].id, 't1', 'même montant, 1 jour d\'écart, libellé proche');
  assert.equal(d[1], null, 'une opération existante ne correspond qu\'à une seule ligne (t3 est trop loin, t4 déjà importée)');
  assert.equal(d[2] && d[2].id, 't2', 'même date et même montant : doublon probable malgré un libellé différent');
  assert.equal(d[3], null, 'sens différent'); assert.equal(d[4], null, 'devise différente');
});

test('normLabel', () => assert.equal(normLabel('  Café — Crème, Été!! '), 'cafe creme ete'));
