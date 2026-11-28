// Scénario d'interface de l'import de relevés (fausse API, aucune base réelle) : CSV → aperçu → ajout → validation → Opérations.
//   DIST_DIR=/tmp/dist-import PORT=8794 node tests/imports-ui.mjs   (captures : /tmp/imp-<appareil>-<étape>.png)
import { devices } from 'playwright';
import path from 'node:path';
import { launch } from './browser.mjs';
import { buildMockDb } from './mockdata.mjs';
import { installMockApi, makeSession, buildDist, serveDist, sessionInit } from './mock-api.mjs';
const DIST = process.env.DIST_DIR || '/tmp/dist-import', PORT = Number(process.env.PORT) || 8794;
buildDist(DIST); const srv = await serveDist(PORT, DIST);
const b = await launch(); let fail = 0;
const ok = (c, m) => { console.log(c ? '✅' : '❌', m); if (!c) fail++; };
for (const [dev, opts] of [['bureau', { viewport: { width: 1440, height: 1000 } }], ['iphone', devices['iPhone 14']]]) {
  const ctx = await b.newContext(opts); const db = buildMockDb({ withBackup: false });
  // une opération déjà saisie qui ressemble à la ligne Netflix du relevé
  db.tx.push({ id: crypto.randomUUID(), user_id: db.tx[0].user_id, seq: 99999, version: 1, deleted_at: null, created_at: '', updated_at: '', date: '2026-11-15', activite: 'Perso', sens: 'Dépense', categorie: 'Abonnements Numériques', libelle: 'Netflix', montant: 17.99, devise: 'EUR', taux: 1, montant_eur: 17.99, nature: 'Courant', tiers: '', lot: '', periode: '2026-11', ref: '', note: '', detail: '', projet_id: null });
  await installMockApi(ctx, db); await ctx.addInitScript(sessionInit, makeSession(), { lang: 'fr' });
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|realtime|Failed to fetch|favicon|status of 404/i.test(m.text())) errs.push(m.text().slice(0, 200)); });
  await p.goto(`${srv.url}/#/imports`); await p.waitForSelector('.imp-drop');
  await p.screenshot({ path: `/tmp/imp-${dev}-1-vide.png`, fullPage: true });
  await p.setInputFiles('input.imp-file', 'tests/fixtures/revolut-perso-en.csv');
  await p.waitForSelector('.imp-preview');
  ok((await p.innerText('.imp-stats')).includes('lignes lues'), `${dev} : aperçu affiché`);
  await p.screenshot({ path: `/tmp/imp-${dev}-2-apercu.png`, fullPage: true });
  await p.click('button:has-text("Ajouter")'); await p.waitForSelector('.imp-row');
  const n = await p.locator('.imp-row').count();
  ok(n >= 8, `${dev} : ${n} lignes à valider`);
  ok(await p.locator('.imp-badge:has-text("déjà saisie")').count() === 1, `${dev} : doublon Netflix repéré`);
  const nav = await p.locator('nav.nav a[href="#/imports"] .count, .tabbar').first().innerText().catch(() => '');
  await p.screenshot({ path: `/tmp/imp-${dev}-3-liste.png`, fullPage: true });
  await p.locator('.imp-pending').scrollIntoViewIfNeeded(); await p.locator('.imp-row').nth(2).scrollIntoViewIfNeeded(); await p.screenshot({ path: `/tmp/imp-${dev}-3b-vue.png` });
  // classer une ligne à la main + sélection multiple + validation
  const unclassified = await p.locator('.imp-cat.empty').count();
  if (unclassified) { const sel = p.locator('.imp-cat.empty').first(); const values = await sel.locator('option').evaluateAll((o) => o.map((x) => x.value)); await sel.selectOption(values[1]); }
  const before = db.tx.length;
  await p.click('button:has-text("Tout valider")');
  try { await p.waitForSelector('.modal', { timeout: 1500 }); await p.screenshot({ path: `/tmp/imp-${dev}-4-categories.png` }); const ms = p.locator('.modal select'); for (let i = 0; i < await ms.count(); i++) { const vals = await ms.nth(i).locator('option').evaluateAll((o) => o.map((x) => x.value)); await ms.nth(i).selectOption(vals[1]); } await p.click('.modal footer .btn.primary'); } catch { /* pas de modale */ }
  await p.waitForTimeout(1200);
  const added = db.tx.length - before;
  ok(added === n - 1, `${dev} : ${added} opérations créées (le doublon probable Netflix est laissé de côté)`);
  ok(db.tx.filter((t) => String(t.ref).startsWith('REV:')).length === added, `${dev} : références REV: posées`);
  ok(db.import_lignes.filter((l) => l.statut === 'valide').length === added, `${dev} : lignes passées à « valide »`);
  ok(db.import_lignes.some((l) => l.statut === 'ignore'), `${dev} : mouvements internes ignorés automatiquement`);
  await p.screenshot({ path: `/tmp/imp-${dev}-5-apres.png`, fullPage: true });
  await p.goto(`${srv.url}/#/ops`); await p.waitForSelector('.txlist'); await p.waitForTimeout(400);
  const body = await p.innerText('body');
  ok(body.includes('Lidl Paris 11') || body.includes('Salaire LVMH'), `${dev} : les opérations validées apparaissent dans Opérations`);
  // ré-import du même fichier : rien de nouveau
  await p.goto(`${srv.url}/#/imports`); await p.waitForSelector('.imp-drop');
  await p.setInputFiles('input.imp-file', 'tests/fixtures/revolut-perso-en.csv'); await p.waitForSelector('.imp-preview');
  ok((await p.innerText('.imp-preview')).includes('Rien de nouveau'), `${dev} : ré-import = aucun doublon`);
  ok(errs.length === 0, `${dev} : aucune erreur JS ${errs.join(' | ')}`);
  await ctx.close();
}

// ---- PDF dans le navigateur, avec la VRAIE politique de sécurité du site (script-src 'self'; worker-src 'self') ----
{
  const fs = await import('node:fs');
  const csp = fs.readFileSync(path.join(DIST, '_headers'), 'utf8').match(/Content-Security-Policy: (.*)/)[1];
  const ctx = await b.newContext({ viewport: { width: 1300, height: 900 } }); const db = buildMockDb({ withBackup: false });
  await installMockApi(ctx, db);
  await ctx.route(`${srv.url}/**`, async (route) => { const r = await route.fetch(); await route.fulfill({ response: r, headers: { ...r.headers(), 'content-security-policy': csp } }); });
  await ctx.addInitScript(sessionInit, makeSession(), { lang: 'fr' });
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|realtime|Failed to fetch|favicon|status of 404/i.test(m.text())) errs.push(m.text().slice(0, 300)); });
  const mk = await ctx.newPage();
  await mk.setContent(`<html><body style="font-family:Arial;font-size:11px"><h1>EUR Statement</h1><table style="width:100%"><thead><tr><th style="text-align:left;white-space:nowrap">Date</th><th style="text-align:left">Description</th><th style="text-align:right;white-space:nowrap">Money out</th><th style="text-align:right;white-space:nowrap">Money in</th><th style="text-align:right;white-space:nowrap">Balance</th></tr></thead><tbody>
    <tr><td style="white-space:nowrap">Nov 3, 2026</td><td>Lidl Paris 11</td><td style="text-align:right">€23.40</td><td></td><td style="text-align:right">€1,476.60</td></tr>
    <tr><td style="white-space:nowrap">Nov 5, 2026</td><td>Salaire LVMH</td><td></td><td style="text-align:right">€3,150.00</td><td style="text-align:right">€4,626.60</td></tr></tbody></table></body></html>`);
  fs.writeFileSync('/tmp/releve-test.pdf', await mk.pdf({ format: 'A4' })); await mk.close();
  await p.goto(`${srv.url}/#/imports`); await p.waitForSelector('.imp-drop');
  await p.setInputFiles('input.imp-file', '/tmp/releve-test.pdf');
  await p.waitForSelector('.imp-preview, .imp-err', { timeout: 20000 });
  ok(await p.locator('.imp-preview').count() === 1, `PDF : lu dans le navigateur sous la CSP du site ${errs.join(' | ')} ${(await p.locator('.imp-err').allInnerTexts()).join('')}`);
  if (await p.locator('.imp-preview').count()) ok((await p.innerText('.imp-stats')).startsWith('2'), 'PDF : 2 lignes lues');
  await ctx.close();
}
await b.close(); srv.close(); process.exit(fail ? 1 : 0);
