// Parcours de recette automatisés (fausse API, aucune base réelle) : les retours de Mohamed, un par un.
//   node tests/ui-flows.mjs      → affiche ✅ / ❌ par contrôle ; code de sortie 1 s'il y a un échec
import { devices } from 'playwright';
import { launch } from './browser.mjs';
import { buildMockDb } from './mockdata.mjs';
import { installMockApi, makeSession, buildDist, serveDist, sessionInit } from './mock-api.mjs';

const DIST = process.env.DIST_DIR || '/tmp/dist-flows';
buildDist(DIST);
const srv = await serveDist(Number(process.env.PORT) || 8797, DIST);
const b = await launch();
let fails = 0, n = 0;
const ok = (cond, label, extra = '') => { n++; if (!cond) fails++; console.log(`${cond ? '✅' : '❌'} ${label}${!cond && extra ? ' — ' + extra : ''}`); };

async function session(opts = {}, prefs = {}) {
  const ctx = await b.newContext(opts.device || { viewport: { width: 1440, height: 1000 } });
  const db = opts.db || buildMockDb();
  const api = await installMockApi(ctx, db);
  await ctx.addInitScript(sessionInit, makeSession(), { lang: 'fr', displayCur: 'EUR', ...prefs });
  const p = await ctx.newPage(); p.errs = [];
  p.on('pageerror', (e) => p.errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|realtime|Failed to fetch|favicon|status of 4/i.test(m.text())) p.errs.push(m.text().slice(0, 200)); });
  await p.goto(srv.url + '/'); await p.waitForSelector('.page .card', { timeout: 20000 });
  return { ctx, p, db, api };
}
const go = async (p, r, wait = 600) => { await p.goto(`${srv.url}/#/${r}`); await p.waitForTimeout(wait); };
const text = (p, sel) => p.$$eval(sel, (els) => els.map((e) => e.textContent)).catch(() => []);

try {
  // ---------- 2. carte agrandie : ni flou, ni voile orphelin après un rafraîchissement ----------
  {
    const { ctx, p } = await session();
    await p.click('.card .maxbtn >> nth=0'); await p.waitForTimeout(300);
    ok(await p.$('.card.maxed'), '2. carte agrandie');
    ok(await p.evaluate(() => getComputedStyle(document.body, '::after').content === 'none' || getComputedStyle(document.body, '::after').content === 'normal'), '2. aucun voile flou sur la page');
    ok(await p.evaluate(() => !document.querySelector('.card.maxed') || getComputedStyle(document.querySelector('.card.maxed')).backdropFilter === 'none'), '2. la carte n\'est pas floutée');
    await p.evaluate(async () => { const m = await import('/js/state.js'); m.emit(); m.emit(); });   // la synchro redessine l'écran
    await p.waitForTimeout(500);
    ok(await p.$('.card.maxed'), '2. la carte reste agrandie après un rafraîchissement de l\'écran');
    ok(await p.evaluate(() => document.body.classList.contains('has-max')), '2. état cohérent après rafraîchissement');
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    ok(!(await p.$('.card.maxed')) && await p.evaluate(() => !document.body.classList.contains('has-max')), '2. Échap referme proprement');
    await p.click('.card .maxbtn >> nth=0'); await p.goto(`${srv.url}/#/ops`); await p.waitForTimeout(400);
    ok(await p.evaluate(() => !document.body.classList.contains('has-max') && !document.querySelector('.card.maxed')), '2. changer d\'écran referme la carte');
    ok(!p.errs.length, '2. aucune erreur JS', p.errs.join('|')); await ctx.close();
  }
  // ---------- 1 + 4. santé selon le filtre, score expliqué ----------
  {
    const { ctx, p } = await session();
    const sub = () => p.$eval('.card:has(h2:text("Santé financière")) > header .sub', (e) => e.textContent);
    for (const [seg, word] of [['Perso', 'perso'], ['Immobilier', 'immobilier'], ['Entreprise', 'entreprise'], ['Bourse', 'bourse'], ['Tout', 'toutes']]) {
      await p.click(`.top .seg button:has-text("${seg}")`); await p.waitForTimeout(400);
      ok((await sub()).includes(word), `1. santé filtrée : ${seg}`, await sub());
    }
    await p.click('.top .seg button:has-text("Tout")'); await p.waitForTimeout(300);
    const groups = await text(p, '.card:has(h2:text("Santé financière")) .hgrp');
    ok(groups.length >= 2, '1. « Tout » regroupe les recommandations par domaine', groups.join('|'));
    await p.click('button:has-text("Comprendre mon score")'); await p.waitForSelector('.modal');
    const mt = await p.$eval('.modal', (e) => e.textContent);
    ok(/Comment est calculé ton score de \d+ \/ 100/.test(mt) && mt.includes('vert') && mt.includes('Pour gagner des points'), '4. le score est expliqué (formule, indicateurs, gains)');
    await p.keyboard.press('Escape');
    await p.click('.top .seg button:has-text("Bourse")'); await p.waitForTimeout(500);
    ok((await p.$$('.kpis .kpi')).length === 4 && (await p.$('.alloc')), '1. filtre Bourse : tableau de bord du portefeuille (KPI + répartition par secteur)');
    ok((await text(p, '.legendv')).join('').includes('Technologie'), '13. répartition par secteur (Technologie)');
    ok(!p.errs.length, '1. aucune erreur JS', p.errs.join('|')); await ctx.close();
  }
  // ---------- 16. l'entreprise n'est pas additionnée ----------
  {
    const db = buildMockDb();
    const base = db.tx.find((t) => t.activite === 'Perso');
    db.tx.push({ ...base, id: crypto.randomUUID(), activite: 'Entreprise', projet_id: db.projets[1].id, sens: 'Revenu', categorie: 'Prestations', montant: 50000, montant_eur: 50000, nature: 'Courant', date: new Date().toISOString().slice(0, 7) + '-02', periode: new Date().toISOString().slice(0, 7), devise: 'EUR', taux: 1, libelle: 'Facture Talan', tiers: '' });
    const { ctx, p } = await session({ db });
    const kpiRev = async () => (await p.$$eval('.kpis .kpi .v', (e) => e.map((x) => x.textContent)))[0];
    const withE = await kpiRev();
    ok(!/1\d\d\s?\d{3}/.test(withE.replace(/\s/g, ' ')) && parseInt(withE.replace(/\D/g, ''), 10) < 100000, '16. « Tout » : les 50 000 € de l\'entreprise ne s\'ajoutent pas aux revenus', withE);
    ok((await p.$eval('.cashlist', (e) => e.textContent)).includes('non cumulées'), '16. trésorerie : entreprises « non cumulées dans le total »');
    ok((await p.$$eval('tr.apart', (e) => e.length)) >= 1, '16. résultat par activité : l\'entreprise est une ligne à part');
    await p.click('.top .seg button:has-text("Entreprise")'); await p.waitForTimeout(400);
    ok(parseInt((await kpiRev()).replace(/\D/g, ''), 10) >= 50000, '16. filtre Entreprise : l\'entreprise s\'affiche seule', await kpiRev());
    ok(!p.errs.length, '16. aucune erreur JS', p.errs.join('|')); await ctx.close();
  }
  // ---------- immobilier ----------
  {
    const { ctx, p, db } = await session();
    await go(p, 'immo', 900);
    const titles = await text(p, '.page > .card > header h2, .page > .row2 .card > header h2');
    const iGrid = titles.findIndex((t) => /Suivi des loyers/.test(t)), iLots = titles.findIndex((t) => /^Lots$/.test(t.trim()));
    ok(iLots > iGrid && iLots === titles.length - 1, '8. les lots sont en fin de page, plus au début', titles.join('|'));
    ok(!(await p.$('.pbar ~ .pdetail .catgrid')) && !(await p.$('.pdetail .catgrid')), '8. plus de lots dans l\'en-tête du projet');
    ok(titles.some((t) => /Comptes entre associés/.test(t)), '5. comptes entre associés affichés');
    const assoc = await p.$eval('.card:has(h2:text("Comptes entre associés"))', (e) => e.textContent);
    ok(/Mohamed/.test(assoc) && /Fatima/.test(assoc) && /doit/.test(assoc) && /Peut retirer maintenant/.test(assoc), '5. qui doit quoi à qui + retrait maximum');
    ok(titles.some((t) => /Capital récupéré/.test(t)), '6. capital récupéré');
    const cap = await p.$eval('.card:has(h2:text("Capital récupéré"))', (e) => e.textContent);
    ok(/Retour complet/.test(cap) && /20(3|4)\d/.test(cap), '6. projection : année de retour du capital', cap.slice(0, 200));
    ok(titles.some((t) => /Analyses et recommandations/.test(t)), '11. analyses et recommandations');
    const kp = await p.$eval('.kpis', (e) => e.textContent);
    ok(/Taux d’occupation/.test(kp) && /\d+,\d\s%/.test(kp), '12. taux d\'occupation sur la période', kp.slice(0, 160));
    ok(!!(await p.$('button:has-text("Relancer")') || await p.$('button:has-text("Message")')), '9. bouton message / relance sur les locataires');
    // message
    const btn = (await p.$('.card:has(h2:text("Locataires")) button:has-text("Message")')) || (await p.$('.card:has(h2:text("Locataires")) button:has-text("Relancer")'));
    await btn.click(); await p.waitForSelector('.modal textarea');
    const mm = await p.$eval('.modal', (e) => e.textContent);
    ok(/WhatsApp/.test(mm) && /SMS/.test(mm) && /Type de message/.test(mm), '9. message WhatsApp / SMS avec modèles');
    await p.selectOption('.modal select', 'echeance'); await p.waitForTimeout(150);
    ok((await p.$eval('.modal textarea', (e) => e.value)).length > 20, '9. modèle de message chargé');
    await p.keyboard.press('Escape');
    // 19. lot : code incrémental
    await p.click('.card:has(h2:text("Lots")) button:has-text("Ajouter un lot")'); await p.waitForSelector('.modal');
    const ph = await p.$eval('.modal input[placeholder^="automatique"]', (e) => e.placeholder);
    ok(/automatique \(\d+\)/.test(ph), '19. le code du prochain lot est annoncé', ph);
    await p.fill('.modal input[placeholder^="ex. 2"]', 'Studio terrasse'); await p.click('.modal button:has-text("Enregistrer")'); await p.waitForTimeout(900);
    const newLot = db.lots.find((l) => l.nom === 'Studio terrasse');
    ok(newLot && /^\d+$/.test(newLot.code), '19. lot créé avec un code automatique', JSON.stringify(newLot && newLot.code));
    ok((await text(p, '.card:has(h2:text("Lots")) .cat')).some((t) => t.includes('Studio terrasse') && t.includes(newLot.code)), '19. le lot apparaît avec son code');
    // 7. suppression d'un projet : double confirmation
    await p.click('.pchip.add'); await p.waitForSelector('.modal'); await p.fill('.modal input[placeholder^="ex. Immeuble"]', 'Projet test'); await p.click('.modal button:has-text("Enregistrer")'); await p.waitForTimeout(800);
    await p.click('.pdetail button:has-text("Modifier")'); await p.waitForSelector('.modal');
    await p.click('.modal button:has-text("Supprimer")'); await p.waitForSelector('.modal:has-text("Supprimer le projet")');
    await p.click('.modal:has-text("Supprimer le projet") button:has-text("Continuer")'); await p.waitForSelector('.modal:has-text("Dernière confirmation")');
    const del = await p.$('.modal:has-text("Dernière confirmation") button:has-text("Supprimer définitivement")');
    ok(await del.isDisabled(), '7. 2ᵉ confirmation : bouton bloqué tant que le nom n\'est pas recopié');
    await p.fill('.modal:has-text("Dernière confirmation") input', 'projet test'); await p.waitForTimeout(100);
    ok(!(await del.isDisabled()), '7. nom recopié : suppression possible');
    await del.click(); await p.waitForTimeout(800);
    ok(db.projets.find((x) => x.nom === 'Projet test').deleted_at, '7. projet supprimé après la double confirmation');
    ok(!p.errs.length, 'immobilier : aucune erreur JS', p.errs.join('|')); await ctx.close();
  }
  // ---------- 15. patrimoine, 18. devises, confidentialité ----------
  {
    const { ctx, p } = await session();
    await go(p, 'wealth', 800);
    ok((await p.$eval('.page', (e) => e.textContent)).includes('Portefeuille de bourse'), '15. la bourse est ajoutée automatiquement au patrimoine');
    ok((await p.$eval('.page', (e) => e.textContent)).includes('Répartition du patrimoine'), '20. répartition du patrimoine par classe d\'actifs');
    for (const [cur, sym] of [['USD', '$'], ['GBP', '£'], ['CHF', 'CHF']]) {
      await p.selectOption('.prefsel[title="Devise d’affichage"]', cur); await p.waitForTimeout(500);
      const t = await p.$eval('.kpis .kpi .v', (e) => e.textContent);
      ok(t.includes(sym), `18. devise d'affichage ${cur}`, t);
    }
    await p.selectOption('.prefsel[title="Devise d’affichage"]', 'EUR');
    await p.click('.filebox button[title^="Masquer"]'); await p.waitForTimeout(200);
    ok(await p.evaluate(() => document.body.classList.contains('privacy')), '20. mode confidentialité (montants masqués)');
    await p.click('.filebox button[title^="Afficher"]');
    // saisie en USD
    await p.keyboard.press('n'); await p.waitForSelector('.modal');
    const curs = await text(p, '.modal .amount-row .seg button');
    ok(['€', 'MAD', '$', '£', 'CHF'].every((c) => curs.includes(c)), '18. saisie : EUR, MAD, USD, GBP, CHF', curs.join(','));
    await p.keyboard.press('Escape');
    ok(!p.errs.length, 'patrimoine : aucune erreur JS', p.errs.join('|')); await ctx.close();
  }
  // ---------- 13. secteur d'un titre ; 20. objectifs ----------
  {
    const { ctx, p, db } = await session();
    await go(p, 'bourse', 1500);
    await p.click('.card:has(h2:text("Répartition")) button:has-text("Par secteur")'); await p.waitForTimeout(300);
    ok((await text(p, '.card:has(h2:text("Répartition")) .legendv')).join('').includes('Technologie'), '13. bourse : répartition par secteur');
    await go(p, 'goals', 800);
    await p.click('button:has-text("Nouvel objectif")'); await p.waitForSelector('.modal');
    await p.fill('.modal input[placeholder^="ex. Apport"]', 'Apport appartement'); await p.fill('.modal input[inputmode="decimal"] >> nth=0', '60000');
    await p.click('.modal button:has-text("Enregistrer")'); await p.waitForTimeout(800);
    ok(db.objectifs.length === 1 && (await p.$eval('.page', (e) => e.textContent)).includes('Apport appartement'), '20. objectif créé et affiché');
    ok(!p.errs.length, 'objectifs : aucune erreur JS', p.errs.join('|')); await ctx.close();
  }
  // ---------- iPhone ----------
  {
    const { ctx, p } = await session({ device: devices['iPhone 14'] });
    for (const r of ['dashboard', 'immo', 'wealth', 'goals']) { await go(p, r, 700); ok(!(await p.$('.page pre')), `iPhone : ${r} s'affiche`); }
    ok(!p.errs.length, 'iPhone : aucune erreur JS', p.errs.join('|')); await ctx.close();
  }
} catch (e) { fails++; console.log('❌ ÉCHEC DU SCÉNARIO :', e.message.split('\n').slice(0, 3).join(' | ')); }
await b.close(); srv.close();
console.log(`\n${n - fails}/${n} contrôles réussis`);
process.exit(fails ? 1 : 0);
