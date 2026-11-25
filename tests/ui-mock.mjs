// Test d'interface SANS toucher aucune base réelle : le navigateur parle à une fausse API Supabase
// (données = copie du fichier Excel). Parcourt tous les écrans, en 3 langues, 2 devises, bureau + iPhone.
//   node tests/ui-mock.mjs [url]   (servir dist/ avec tools/cloud/serve.mjs)
import fs from 'node:fs';
import * as XLSX from 'xlsx';
import { devices } from 'playwright';
import { launch } from './browser.mjs';
import { parseWorkbook } from '../app/js/xlsxio.js';
import { TABLES } from '../app/js/schema.js';

const APP = process.argv[2] || 'http://localhost:8788';
const SB = JSON.parse(fs.readFileSync('dist/config.js', 'utf8').match(/CONFIG = (\{[\s\S]*\});/)[1]).url;
const UID = '2b2c1079-0000-4000-8000-000000000001';
const src = parseWorkbook(XLSX, fs.readFileSync('/tmp/audit/live.xlsx'));
const now = new Date().toISOString();
const db = {};
let seq = 1;
const projetId = '7a1e0000-0000-4000-8000-0000000000a1';
for (const d of TABLES) db[d.key] = (src.data[d.key] || []).map((r) => ({ ...r, id: r.id || crypto.randomUUID(), user_id: UID, seq: seq++, version: 1, created_at: now, updated_at: now, deleted_at: null }));
db.projets = [{ id: projetId, user_id: UID, seq: seq++, version: 1, nom: 'Amal 1', type: 'Immobilier', part: 0.67, devise: 'MAD', note: '', created_at: now, updated_at: now, deleted_at: null }];
for (const k of ['lots', 'tenants']) db[k].forEach((r) => { r.projet_id = projetId; });
db.tx.forEach((t) => { if (t.activite === 'Immobilier') t.projet_id = projetId; });
// un loyer impayé le mois dernier (pour tester la relance)
{ const d = new Date(); d.setMonth(d.getMonth() - 1); const m = d.toISOString().slice(0, 7); const lot0 = db.lots[0].nom; db.tx = db.tx.filter((t) => !(t.activite === 'Immobilier' && t.categorie === 'Loyer' && t.lot === lot0 && (t.periode || t.date.slice(0, 7)) === m)); db.tenants.forEach((t) => { if (t.lot === lot0 && !t.contact) t.contact = '+212600000000'; }); }
db.ordres = [
  { id: crypto.randomUUID(), user_id: UID, seq: seq++, version: 1, date: '2025-02-10', symbole: 'CW8.PA', nom: 'Amundi MSCI World', type: 'ETF', compte: 'PEA', sens: 'Achat', quantite: 10, prix: 480, frais: 2, devise: 'EUR', note: '', created_at: now, updated_at: now, deleted_at: null },
  { id: crypto.randomUUID(), user_id: UID, seq: seq++, version: 1, date: '2025-09-15', symbole: 'AIR.PA', nom: 'Airbus SE', type: 'Action', compte: 'CTO', sens: 'Achat', quantite: 5, prix: 170, frais: 1, devise: 'EUR', note: '', created_at: now, updated_at: now, deleted_at: null },
  { id: crypto.randomUUID(), user_id: UID, seq: seq++, version: 1, date: '2026-03-01', symbole: 'AAPL', nom: 'Apple Inc.', type: 'Action', compte: 'CTO', sens: 'Achat', quantite: 3, prix: 210, frais: 1, devise: 'USD', note: '', created_at: now, updated_at: now, deleted_at: null },
];
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: UID, aal: 'aal2', role: 'authenticated', email: 'test@cockpit.test', exp: Math.floor(Date.now() / 1000) + 3600, amr: [{ method: 'totp' }] })}.sig`;
const session = { access_token: jwt, refresh_token: 'r', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: UID, email: 'test@cockpit.test', aud: 'authenticated', factors: [{ id: 'f', factor_type: 'totp', status: 'verified' }] } };

async function mockApi(ctx) {
  await ctx.route(`${SB}/**`, async (route) => {
    const u = new URL(route.request().url());
    const json = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b), headers: { 'access-control-allow-origin': '*', 'content-range': '0-*/*' } });
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (u.pathname.startsWith('/auth/v1/user')) return json(session.user);
    if (u.pathname.startsWith('/auth/v1/factors') || u.pathname.startsWith('/auth/v1/')) return json({});
    if (u.pathname === '/functions/v1/bourse') {
      const body = JSON.parse(route.request().postData() || '{}');
      if (body.action === 'quotes') return json({ quotes: [{ symbole: 'CW8.PA', nom: 'Amundi MSCI World', prix: 552.4, veille: 548, devise: 'EUR', place: 'Paris' }, { symbole: 'AIR.PA', nom: 'Airbus SE', prix: 194.36, veille: 196, devise: 'EUR', place: 'Paris' }, { symbole: 'AAPL', nom: 'Apple Inc.', prix: 245, veille: 242, devise: 'USD', place: 'NasdaqGS' }] });
      if (body.action === 'search') return json({ results: [{ symbole: 'CW8.PA', nom: 'Amundi MSCI World', place: 'Paris', type: 'ETF' }] });
      return json({ ok: true });
    }
    if (u.pathname.startsWith('/functions/')) return json({ ok: true, sent: 0 });
    if (u.pathname.startsWith('/rest/v1/rpc/')) return json({ ok: true });
    const table = u.pathname.replace('/rest/v1/', '');
    if (table === 'fx_rates') return json([{ pair: 'MAD/EUR', rate: 0.091324, date: now.slice(0, 10), source: 'open.er-api.com' }, { pair: 'USD/EUR', rate: 0.92, date: now.slice(0, 10), source: 'test' }]);
    if (['projet_membres', 'cours_hist', 'restore_points', 'change_log', 'push_subscriptions', 'cours'].includes(table)) return json([]);
    const filtered = [...u.searchParams.keys()].some((k) => ['id', 'projet_id', 'updated_at'].includes(k));
    const off = Number(u.searchParams.get('offset') || 0);
    const range = route.request().headers()['range'];
    if (filtered || off > 0 || (range && !range.startsWith('0-'))) return json([]);
    return json(db[table] || []);
  });
}

const b = await launch();
let fail = 0;
const routes = ['dashboard', 'ops', 'freelance', 'immo', 'wealth', 'bourse', 'recurring', 'settings'];
for (const [dev, opts] of [['bureau', { viewport: { width: 1440, height: 900 } }], ['iphone', devices['iPhone 14']]]) {
  for (const [lang, cur] of [['fr', 'EUR'], ['en', 'MAD'], ['ar', 'EUR']]) {
    const ctx = await b.newContext(opts);
    await mockApi(ctx);
    await ctx.addInitScript(([s, l, c]) => { localStorage.setItem('cockpit-auth', JSON.stringify(s)); localStorage.setItem('cockpit.prefs.v1', JSON.stringify({ lang: l, displayCur: c })); }, [session, lang, cur]);
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(APP + '/');
    try { await p.waitForSelector('.page .card', { timeout: 20000 }); } catch { errs.push('application non chargée : ' + (await p.innerText('body')).slice(0, 200)); }
    for (const r of routes) {
      await p.goto(`${APP}/#/${r}`);
      await p.waitForTimeout(r === 'bourse' ? 1500 : 400);
      const bad = await p.$('.page pre');
      if (bad) errs.push(`${r} : ${(await bad.innerText()).slice(0, 300)}`);
      if (dev === 'bureau' && lang !== 'fr' || r === 'dashboard' || r === 'bourse' || r === 'immo') await p.screenshot({ path: `/tmp/ui-${dev}-${lang}-${r}.png`, fullPage: dev === 'bureau' && (r === 'dashboard' || r === 'bourse') });
    }
    // interactions : replier une carte, trier un tableau, ouvrir la saisie, la relance, une position
    await p.goto(`${APP}/#/ops`); await p.waitForTimeout(300);
    if (dev === 'bureau') { const th = await p.$('.tbl th.sortable'); if (th) { await th.click(); await th.click(); } else errs.push('pas de tri disponible'); }
    const tog = await p.$('.card .togbtn'); if (tog) { await tog.click(); await tog.click(); } else errs.push('pas de bouton replier');
    const mx = await p.$('.card .maxbtn'); if (mx) { await mx.click(); await p.keyboard.press('Escape'); }
    await p.goto(`${APP}/#/immo`); await p.waitForTimeout(400);
    const relSel = '.tbl button:has-text("Relancer"), .tbl button:has-text("Remind"), .tbl button:has-text("تذكير")';
    if (await p.$(relSel)) {
      try { await p.click(relSel, { timeout: 8000 }); await p.waitForSelector('.modal textarea', { timeout: 5000 }); await p.screenshot({ path: `/tmp/ui-${dev}-${lang}-relance.png` }); await p.keyboard.press('Escape'); }
      catch (e) { errs.push('relance : ' + e.message.split('\n')[0]); }
    } else errs.push('relance : bouton absent');
    await p.goto(`${APP}/#/bourse`); await p.waitForTimeout(1200);
    const pos = await p.$('.tbl tbody tr.click');
    if (pos) { await p.click('.tbl tbody tr.click >> nth=0'); await p.waitForTimeout(300); await p.screenshot({ path: `/tmp/ui-${dev}-${lang}-position.png` }); await p.keyboard.press('Escape'); } else errs.push('bourse : pas de position');
    const real = errs.filter((e) => !/WebSocket|realtime|Failed to fetch/i.test(e));
    console.log(`${dev} ${lang}/${cur} :`, real.length ? '❌ ' + real.join(' | ') : '✅');
    if (real.length) fail++;
    await ctx.close();
  }
}
await b.close();
process.exit(fail ? 1 : 0);
