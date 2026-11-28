// Test d'interface SANS toucher aucune base réelle : le navigateur parle à une fausse API Supabase (tests/mock-api.mjs),
// avec des données de démonstration (tests/mockdata.mjs). Parcourt tous les écrans, en 3 langues, 2 devises, bureau + iPhone.
//   node tests/ui-mock.mjs            (construit dist/ avec une configuration factice et le sert sur le port 8788)
//   node tests/ui-mock.mjs --quick    (bureau, français, une seule passe)
//   Captures d'écran : /tmp/ui-<appareil>-<langue>-<écran>.png
import { devices } from 'playwright';
import { launch } from './browser.mjs';
import { buildMockDb } from './mockdata.mjs';
import { installMockApi, makeSession, buildDist, serveDist, sessionInit } from './mock-api.mjs';

const quick = process.argv.includes('--quick');
const DIST = process.env.DIST_DIR || '/tmp/dist-ui';
buildDist(DIST);
const srv = await serveDist(Number(process.env.PORT) || 8788, DIST);
const APP = srv.url;
const session = makeSession();
const b = await launch();
let fail = 0;
const routes = ['dashboard', 'ops', 'imports', 'entreprise', 'immo', 'wealth', 'bourse', 'impot', 'goals', 'recurring', 'settings'];
const matrix = quick ? [['bureau', { viewport: { width: 1440, height: 900 } }, 'fr', 'EUR']]
  : [['bureau', { viewport: { width: 1440, height: 900 } }, 'fr', 'EUR'], ['bureau', { viewport: { width: 1440, height: 900 } }, 'en', 'MAD'], ['bureau', { viewport: { width: 1440, height: 900 } }, 'ar', 'USD'], ['iphone', devices['iPhone 14'], 'fr', 'GBP'], ['iphone', devices['iPhone 14'], 'en', 'CHF']];
for (const [dev, opts, lang, cur] of matrix) {
  const ctx = await b.newContext(opts);
  const db = buildMockDb();
  await installMockApi(ctx, db);
  await ctx.addInitScript(sessionInit, session, { lang, displayCur: cur });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|realtime|Failed to fetch|favicon|status of 4/i.test(m.text())) errs.push('console : ' + m.text().slice(0, 200)); });
  await p.goto(APP + '/');
  try { await p.waitForSelector('.page .card', { timeout: 20000 }); } catch { errs.push('application non chargée : ' + (await p.innerText('body')).slice(0, 200)); }
  for (const r of routes) {
    await p.goto(`${APP}/#/${r}`);
    await p.waitForTimeout(r === 'bourse' ? 1500 : 500);
    const bad = await p.$('.page pre');
    if (bad) errs.push(`${r} : ${(await bad.innerText()).slice(0, 400)}`);
    await p.screenshot({ path: `/tmp/ui-${dev}-${lang}-${r}.png`, fullPage: dev === 'bureau' });
  }
  const real = errs.filter((e) => !/WebSocket|realtime|Failed to fetch/i.test(e));
  console.log(`${dev} ${lang}/${cur} :`, real.length ? '❌ ' + real.join(' | ') : '✅');
  if (real.length) fail++;
  await ctx.close();
}
await b.close(); srv.close();
process.exit(fail ? 1 : 0);
