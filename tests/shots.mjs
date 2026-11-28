// Captures d'écran d'un écran avec la fausse API : node tests/shots.mjs <route> [--mobile] [--act=Bourse] [--lang=en] [--cur=MAD] [--h=2600] [--eval="js"]
// Sortie : /tmp/shot-<route>[-m].png  (la page entière tient dans une fenêtre haute)
import { devices } from 'playwright';
import { launch } from './browser.mjs';
import { buildMockDb } from './mockdata.mjs';
import { installMockApi, makeSession, buildDist, serveDist, sessionInit } from './mock-api.mjs';
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=').slice(1).join('=') || d;
const route = process.argv[2] || 'dashboard', mobile = process.argv.includes('--mobile');
const DIST = '/tmp/dist-shots'; buildDist(DIST);
const srv = await serveDist(Number(arg('port', 8796)), DIST);
const b = await launch();
const ctx = await b.newContext(mobile ? devices['iPhone 14'] : { viewport: { width: 1440, height: Number(arg('h', 2600)) } });
const db = buildMockDb(); await installMockApi(ctx, db);
await ctx.addInitScript(sessionInit, makeSession(), { lang: arg('lang', 'fr'), displayCur: arg('cur', 'EUR'), activity: arg('act', 'Tout') });
const p = await ctx.newPage(); const errs = [];
p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|realtime|Failed to fetch|favicon/i.test(m.text())) errs.push(m.text().slice(0, 200)); });
await p.goto(srv.url + '/'); await p.waitForSelector('.page .card', { timeout: 20000 });
await p.goto(`${srv.url}/#/${route}`); await p.waitForTimeout(Number(arg('wait', 1200)));
const ev = arg('eval', ''); if (ev) { await p.evaluate(ev); await p.waitForTimeout(500); }
await p.screenshot({ path: `/tmp/shot-${route}${mobile ? '-m' : ''}.png`, fullPage: mobile });
console.log(errs.length ? 'ERREURS : ' + errs.join(' | ') : 'ok', `/tmp/shot-${route}${mobile ? '-m' : ''}.png`);
await b.close(); srv.close();
