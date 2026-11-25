// Test d'affichage sans base : l'écran de connexion se charge sans erreur (bureau + iPhone)
import { launch } from './browser.mjs';
import { devices } from 'playwright';
const URL = process.argv[2] || 'http://localhost:8788/';
const b = await launch();
let fail = 0;
for (const [name, opts] of [['bureau', { viewport: { width: 1400, height: 900 } }], ['iphone', devices['iPhone 14']]]) {
  const ctx = await b.newContext(opts); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(URL); await p.waitForSelector('.auth-card', { timeout: 15000 }).catch(() => {});
  const ok = await p.$('.auth-card');
  await p.screenshot({ path: `/tmp/cockpit-smoke-${name}.png` });
  const real = errs.filter((e) => !/Failed to load resource|ERR_|placeholder|Invalid API key|401/.test(e));
  console.log(name, ok ? 'écran de connexion OK' : 'ÉCHEC', real.length ? real : '');
  if (!ok || real.length) fail++;
  await ctx.close();
}
await b.close(); process.exit(fail ? 1 : 0);
