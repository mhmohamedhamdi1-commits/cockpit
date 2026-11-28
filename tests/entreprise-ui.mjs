// Scénarios d'interface du module Entreprise (fausse API, aucune base réelle) :
// facturation du mois, paiement reçu avec montants à mettre de côté, création d'une entreprise (assistant), planning, comparatif, suppression à double confirmation.
//   DIST_DIR=/tmp/dist-entreprise PORT=8793 node tests/entreprise-ui.mjs        captures : /tmp/ent-*.png
import { devices } from 'playwright';
import { launch } from './browser.mjs';
import { buildMockDb, PROJET_ENT } from './mockdata.mjs';
import { installMockApi, makeSession, buildDist, serveDist, sessionInit } from './mock-api.mjs';

const DIST = process.env.DIST_DIR || '/tmp/dist-entreprise';
buildDist(DIST);
const srv = await serveDist(Number(process.env.PORT) || 8793, DIST);
const b = await launch();
let fail = 0;
const ok = (c, msg) => { if (!c) { fail++; console.log('  ❌', msg); } else console.log('  ✓', msg); };

async function scenario(name, opts, fn) {
  const ctx = await b.newContext(opts);
  await ctx.clock.setFixedTime(new Date('2027-06-15T10:00:00'));
  const db = buildMockDb();
  const ent = db.projets.find((p) => p.id === PROJET_ENT);
  ent.meta = { forme: 'micro_bnc', date_debut: '2027-01-01', versement_liberatoire: false };
  // 2 factures déjà payées (mars, avril) pour avoir de l'historique
  for (const [k, i] of db.invoices.slice(0, 2).entries()) Object.assign(i, { statut: 'Payée', emission: `2027-0${k + 3}-31`, paiement: `2027-0${k + 4}-10`, periode: `2027-0${k + 3}` });
  await installMockApi(ctx, db);
  const session = makeSession(); session.expires_at = 4102444800;
  await ctx.addInitScript(sessionInit, session, { lang: 'fr', displayCur: 'EUR' });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('response', (r) => { if (r.status() === 404 && !/favicon|compare\.js/.test(r.url())) errs.push('404 : ' + r.url()); });
  p.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|realtime|Failed to fetch|favicon|status of 404/i.test(m.text())) errs.push('console : ' + m.text().slice(0, 200)); });
  await p.goto(srv.url + '/#/entreprise');
  await p.waitForSelector('.page .card', { timeout: 20000 });
  await p.waitForTimeout(400);
  console.log(name);
  await fn(p, db);
  ok(!errs.length, 'aucune erreur JS' + (errs.length ? ' : ' + errs.join(' | ') : ''));
  await ctx.close();
}

await scenario('Bureau — entreprise en activité', { viewport: { width: 1440, height: 900 } }, async (p, db) => {
  await p.screenshot({ path: '/tmp/ent-desktop.png', fullPage: true });
  // liens des notifications : jours travaillés du mois, facture
  await p.goto(srv.url + '/#/entreprise?jours=2027-06');
  await p.waitForSelector('.modal :text("Facturation du mois")', { timeout: 5000 });
  ok(await p.inputValue('.modal input[type=month]') === '2027-06', 'lien « jours travaillés » ouvre la facturation de juin');
  await p.keyboard.press('Escape');
  const planned = db.invoices.find((i) => i.statut === 'Planifiée');
  await p.goto(srv.url + `/#/entreprise?inv=${planned.id}`);
  await p.waitForSelector(`.modal :text("Facture ${planned.numero}")`, { timeout: 5000 });
  ok(true, 'lien « facture » ouvre la facture');
  await p.keyboard.press('Escape');
  await p.goto(srv.url + '/#/entreprise');
  await p.waitForSelector('.ent-head');
  ok(await p.isVisible('text=Planning de déclarations 2027'), 'planning de déclarations affiché');
  ok(await p.isVisible('text=Plafonds 2027'), 'plafonds affichés');
  // --- facturation du mois
  await p.click('button:has-text("Facturation du mois")');
  await p.waitForSelector('.modal input[type=number]');
  await p.fill('.modal input[type=month]', '2027-05');
  await p.waitForTimeout(150);
  await p.fill('.modal tbody tr input >> nth=0', '18.5');
  const tot = await p.innerText('.modal .infobox');
  ok(/12\s?025/.test(tot), `facture HT calculée (18,5 j × 650 € = 12 025 €) : « ${tot.trim().slice(0, 60)} »`);
  await p.screenshot({ path: '/tmp/ent-billing.png' });
  await p.click('.modal button:has-text("Envoyée au client")');
  await p.click('.modal button:has-text("Créer les factures")');
  await p.waitForTimeout(500);
  const may = db.invoices.find((i) => i.periode === '2027-05' && !i.deleted_at);
  ok(may && may.statut === 'Envoyée' && may.jours === 18.5 && may.ht === 12025 && may.projet_id === PROJET_ENT, `facture de mai créée et envoyée (${may && may.numero} · ${may && may.ht} €)`);
  // --- paiement reçu : montants à mettre de côté affichés avant de confirmer
  await p.click(`tr:has-text("${may.numero}") button:has-text("Paiement reçu")`);
  await p.waitForSelector('.modal .cashrow');
  const res = await p.innerText('.modal');
  ok(/Cotisations URSSAF/.test(res) && /Impôt sur le revenu/.test(res) && /Total à provisionner/.test(res), 'montants à mettre de côté affichés (URSSAF, impôt, total)');
  await p.screenshot({ path: '/tmp/ent-pay.png' });
  await p.click('.modal button:has-text("Paiement reçu")');
  await p.waitForTimeout(500);
  ok(db.tx.some((t) => t.ref === `FAC${may.id}` && t.activite === 'Entreprise' && t.projet_id === PROJET_ENT && t.categorie === 'Prestations' && t.montant === 12025), 'écriture « Prestations » créée sur l’entreprise');
  ok(db.invoices.find((i) => i.id === may.id).statut === 'Payée', 'facture marquée payée');
  // --- facture imprimable
  await p.click(`tr:has-text("${may.numero}") button[title^="Voir"]`);
  await p.waitForSelector('.invoice-print');
  const doc = await p.innerText('.invoice-print');
  ok(/293 B du CGI/.test(doc) && /40 €/.test(doc) && /Talan/.test(doc), 'facture imprimable avec mentions légales');
  await p.screenshot({ path: '/tmp/ent-print.png' });
  await p.keyboard.press('Escape');
  // --- planning : cocher une échéance
  await p.click('.ent-decl-row:not(.done) >> nth=0 >> button:has-text("Fait")');
  await p.waitForTimeout(400);
  ok(db.declarations.length === 1 && db.declarations[0].code === 'urssaf', 'échéance cochée enregistrée dans « declarations »');
  await p.screenshot({ path: '/tmp/ent-desktop2.png', fullPage: true });
  // --- assistant de création d'une SASU
  await p.click('button:has-text("Nouvelle entreprise")');
  await p.waitForSelector('.ent-steps');
  await p.fill('.modal input[placeholder="ex. Hamdi Conseil"]', 'SASU Test');
  await p.selectOption('.modal select >> nth=0', 'sasu');
  await p.waitForTimeout(150);
  await p.screenshot({ path: '/tmp/ent-wizard1.png' });
  await p.click('.modal button:has-text("Suivant")');
  await p.waitForTimeout(150);
  ok(await p.isVisible('.modal :text("Régime de TVA")'), 'étape 2 : TVA et fiscalité');
  await p.screenshot({ path: '/tmp/ent-wizard2.png' });
  await p.click('.modal button:has-text("Suivant")');
  await p.waitForSelector('.modal :text("Associés et parts")');
  await p.fill('.modal input[type=number] >> nth=0', '60');
  await p.click('.modal button:has-text("Ajouter un associé")');
  await p.fill('.modal tbody tr:nth-child(2) input[type=text]', 'Fatima');
  await p.fill('.modal tbody tr:nth-child(2) input[type=number]', '40');
  await p.screenshot({ path: '/tmp/ent-wizard3.png' });
  await p.click('.modal button:has-text("Créer l’entreprise")');
  await p.waitForTimeout(600);
  const sasu = db.projets.find((x) => x.nom === 'SASU Test');
  ok(sasu && sasu.type === 'Entreprise' && sasu.meta.forme === 'sasu' && Math.abs(sasu.part - 0.6) < 1e-9 && sasu.meta.associes.length === 2, `entreprise créée (forme ${sasu && sasu.meta.forme}, ma part ${sasu && sasu.part})`);
  // --- comparatif de toutes les entreprises
  await p.click('.pchip:has-text("Toutes mes entreprises")');
  await p.waitForSelector('text=Comparatif 2027');
  ok(!(await p.innerText('.page')).includes('Total général'), 'pas de total mélangé');
  await p.screenshot({ path: '/tmp/ent-overview.png', fullPage: true });
  // --- suppression à double confirmation
  await p.click('.pchip:has-text("SASU Test")');
  await p.click('button:has-text("Modifier")');
  await p.waitForSelector('.modal button:has-text("Supprimer")');
  await p.click('.modal button:has-text("Supprimer")');
  await p.click('.modal button:has-text("Continuer")');
  await p.waitForSelector('.modal :text("Dernière confirmation")');
  const disabled = await p.isDisabled('.modal button:has-text("Supprimer définitivement")');
  ok(disabled, 'suppression bloquée tant que le nom n’est pas saisi');
  await p.fill('.modal input[placeholder="SASU Test"]', 'SASU Test');
  await p.click('.modal button:has-text("Supprimer définitivement")');
  await p.waitForTimeout(500);
  ok(!!db.projets.find((x) => x.nom === 'SASU Test').deleted_at, 'entreprise supprimée après la double confirmation');
});

await scenario('iPhone — entreprise en activité', devices['iPhone 14'], async (p) => {
  await p.waitForTimeout(300);
  await p.screenshot({ path: '/tmp/ent-iphone.png', fullPage: true });
  await p.click('button:has-text("Facturation du mois")');
  await p.waitForSelector('.modal input[type=number]');
  await p.screenshot({ path: '/tmp/ent-iphone-billing.png' });
  await p.keyboard.press('Escape');
  await p.click('button:has-text("Nouvelle entreprise")');
  await p.waitForSelector('.ent-steps');
  await p.screenshot({ path: '/tmp/ent-iphone-wizard.png' });
  ok(true, 'captures iPhone');
});

await b.close(); srv.close();
console.log(fail ? `\n${fail} échec(s)` : '\nTout est vert');
process.exit(fail ? 1 : 0);
