import { devices } from 'playwright';
import { launch } from './browser.mjs';
import { buildMockDb } from './mockdata.mjs';
import { installMockApi, makeSession, buildDist, serveDist, sessionInit } from './mock-api.mjs';
const DIST = '/tmp/dist-impot';
buildDist(DIST);
const srv = await serveDist(8792, DIST);
const b = await launch();
let fail = 0;
for (const [name, opts] of [['bureau', { viewport: { width: 1440, height: 900 } }], ['iphone', devices['iPhone 14']]]) {
  const ctx = await b.newContext(opts);
  const db = buildMockDb(); db.bareme_fiscal = [];
  const api = await installMockApi(ctx, db);
  await ctx.addInitScript(sessionInit, makeSession(), { lang: 'fr' });
  const p = await ctx.newPage(); const errs = [];
  p.on('response', (r) => { if (r.status() === 404) console.log('404', r.url()); }); p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|realtime|Failed to fetch|favicon/i.test(m.text())) errs.push(m.text().slice(0, 200)); });
  await p.goto(srv.url + '/#/impot'); await p.waitForSelector('.imp .kpis', { timeout: 20000 });
  await p.waitForTimeout(600);
  await p.screenshot({ path: `/tmp/impot-${name}-1.png`, fullPage: true });
  // saisie : salaire + pension parent + pas
  await p.evaluate(() => document.querySelectorAll('details.imp-sec').forEach((d) => { d.open = true; }));
  const set = async (label, v) => { const f = p.locator('.imp-field', { hasText: label }).first().locator('input').first(); await f.fill(v); };
  await set('Mes salaires', '52000'); await set('Pension alimentaire versée à un parent', '6000'); await set('Prélèvement à la source déjà versé', '5000');
  await p.waitForTimeout(300);
  const txt = await p.innerText('.imp .kpis');
  console.log(name, txt.replace(/\n+/g, ' | '));
  await p.click('button:has-text("Enregistrer mes infos fiscales")'); await p.waitForTimeout(800);
  console.log('fiscal rows after save', JSON.stringify(db.fiscal.map((r) => [r.annee, r.data])));
  await p.screenshot({ path: `/tmp/impot-${name}-2.png`, fullPage: true });
  // changer d'année
  await p.click('.seg button:has-text("2027")'); await p.waitForTimeout(500);
  console.log(name, '2027', (await p.innerText('.imp-status')).slice(0, 120));
  if (errs.length) { console.log('ERREURS', errs); fail++; }
  await ctx.close();
}
await b.close(); srv.close(); process.exit(fail ? 1 : 0);
