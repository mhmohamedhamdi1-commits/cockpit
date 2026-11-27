// Régression : l'infobulle des graphiques ne doit jamais rester affichée après un changement de vue,
// un toucher ailleurs ou un défilement (bug constaté sur iPhone et bureau, 2026-11-27).
//   node tests/tooltip.mjs      (aucune base, aucun serveur : les fichiers de app/ sont servis par Playwright)
import fs from 'node:fs';
import path from 'node:path';
import { devices } from 'playwright';
import { launch } from './browser.mjs';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../app');
const ORIGIN = 'http://cockpit.test';
const PAGE = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/style.css"></head><body>
<div style="height:3000px"><div id="view" style="max-width:700px"></div><button id="other">Autre vue</button></div>
<script type="module">
  import { barChart, seriesChart, hideTip } from '/js/charts.js';
  const pts = ['2026-07','2026-08','2026-09','2026-10'].map((key, i) => ({ key, rev: 1000 + i * 100, dep: 600 + i * 50, res: 400 + i * 50 }));
  window.draw = (kind) => {
    const v = document.getElementById('view'); v.replaceChildren();
    v.append(kind === 'series'
      ? seriesChart({ labels: pts.map((p) => ({ label: p.key })), series: [{ name: 'Revenus', color: 'green', values: pts.map((p) => p.rev) }] })
      : barChart({ points: pts, mode: 'm' }));
  };
  window.draw('bar'); window.ready = true;
</script></body></html>`;

const b = await launch();
let fail = 0;
const check = (cond, label) => { console.log(`${cond ? 'OK ' : 'ÉCHEC'} ${label}`); if (!cond) fail++; };
for (const [name, opts] of [['bureau', { viewport: { width: 1000, height: 800 } }], ['iphone', devices['iPhone 14']]]) {
  const ctx = await b.newContext(opts);
  await ctx.route(`${ORIGIN}/**`, (r) => {
    const p = new URL(r.request().url()).pathname;
    if (p === '/') return r.fulfill({ contentType: 'text/html', body: PAGE });
    const f = path.join(APP, p);
    if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: '' });
    return r.fulfill({ contentType: p.endsWith('.js') ? 'text/javascript' : p.endsWith('.css') ? 'text/css' : 'application/octet-stream', body: fs.readFileSync(f) });
  });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(ORIGIN + '/'); await p.waitForFunction(() => window.ready);
  const tipOn = () => p.evaluate(() => !!document.querySelector('.tip.on'));
  const open = async (kind = 'bar') => {
    const box = await p.locator('#view svg').first().boundingBox();
    const x = box.x + box.width * 0.45, y = box.y + box.height * 0.5;
    if (opts.hasTouch) await p.touchscreen.tap(x, y); else await p.mouse.move(x, y);
    await p.waitForTimeout(150);
  };

  await open(); check(await tipOn(), `${name} : l'infobulle s'ouvre`);
  await p.evaluate(() => window.draw('series')); await p.waitForTimeout(100);
  check(!(await tipOn()), `${name} : fermée après changement de vue (graphique remplacé)`);

  await open('series'); check(await tipOn(), `${name} : s'ouvre sur le nouveau graphique`);
  if (opts.hasTouch) await p.locator('#other').tap(); else await p.locator('#other').click();
  await p.waitForTimeout(100);
  check(!(await tipOn()), `${name} : fermée après clic / toucher ailleurs`);

  await open('series');
  if (opts.hasTouch) {   // toucher une autre barre du même graphique : l'infobulle suit, reste ouverte
    const box = await p.locator('#view svg').first().boundingBox();
    await p.touchscreen.tap(box.x + box.width * 0.85, box.y + box.height * 0.5); await p.waitForTimeout(150);
    check(await tipOn(), `${name} : reste ouverte en touchant une autre barre`);
  }
  await p.evaluate(() => window.scrollBy(0, 300)); await p.waitForTimeout(100);
  check(!(await tipOn()), `${name} : fermée au défilement`);

  check(errs.length === 0, `${name} : aucune erreur JS ${errs.join(' | ')}`);
  await ctx.close();
}
await b.close();
console.log(fail ? `\n${fail} échec(s)` : '\nTout est OK');
process.exit(fail ? 1 : 0);
