// Écran Immobilier : « Ma part » / « Total » dépend du projet (aucune part globale à 67 %).
// Données synthétiques (2 projets : 67 % et 50 %), fausse API Supabase, aucune base réelle.
//   node tools/cloud/pages-build.mjs (avec les variables) && node tools/cloud/serve.mjs 8788 &  puis  node tests/immo-part.mjs [url]
import fs from 'node:fs';
import { launch } from './browser.mjs';

const APP = process.argv[2] || 'http://localhost:8788';
const SB = JSON.parse(fs.readFileSync('dist/config.js', 'utf8').match(/CONFIG = (\{[\s\S]*\});/)[1]).url;
const UID = '2b2c1079-0000-4000-8000-000000000001';
const now = new Date().toISOString(), month = now.slice(0, 7), date = `${month}-01`;
let seq = 1;
const base = () => ({ id: crypto.randomUUID(), user_id: UID, seq: seq++, version: 1, created_at: now, updated_at: now, deleted_at: null, legacy_id: null });
const P1 = { ...base(), nom: 'Amal 1', type: 'Immobilier', part: 0.67, devise: 'MAD', note: '' };
const P2 = { ...base(), nom: 'Riad', type: 'Immobilier', part: 0.5, devise: 'MAD', note: '' };
const tx = (projet, sens, categorie, montant, lot = '') => ({ ...base(), date, activite: 'Immobilier', sens, categorie, detail: '', libelle: categorie, montant, devise: 'MAD', taux: 0.0913,
  montant_eur: montant * 0.0913, nature: 'Courant', tiers: '', lot, periode: month, ref: '', note: '', projet_id: projet.id });
let db = {
  projets: [P1, P2],
  lots: [{ ...base(), code: '01', nom: '01. Lot A', loyer: 1000, projet_id: P1.id }, { ...base(), code: '02', nom: '02. Lot B', loyer: 2000, projet_id: P2.id }],
  tenants: [],
  tx: [tx(P1, 'Revenu', 'Loyer', 1000, '01. Lot A'), tx(P2, 'Revenu', 'Loyer', 2000, '02. Lot B'), tx(P1, 'Dépense', 'Ménage', 100), tx(P2, 'Dépense', 'Ménage', 200)],
};
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: UID, aal: 'aal2', role: 'authenticated', email: 'test@cockpit.test', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
const session = { access_token: jwt, refresh_token: 'r', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: UID, email: 'test@cockpit.test', aud: 'authenticated', factors: [{ id: 'f', status: 'verified', factor_type: 'totp' }] } };

const b = await launch();
let fail = 0;
const check = (cond, label, got) => { console.log(`${cond ? 'OK ' : 'ÉCHEC'} ${label}${cond ? '' : ` (obtenu : ${got})`}`); if (!cond) fail++; };
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
await ctx.route(`${SB}/**`, async (route) => {
  const u = new URL(route.request().url());
  const json = (x) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x), headers: { 'access-control-allow-origin': '*', 'content-range': '0-0/*' } });
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  if (u.pathname.startsWith('/auth/v1/user')) return json(session.user);
  if (u.pathname.startsWith('/auth/v1/') || u.pathname.startsWith('/functions/') || u.pathname.startsWith('/rest/v1/rpc/')) return json({});
  const table = u.pathname.replace('/rest/v1/', '');
  if (table === 'fx_rates') return json([{ pair: 'MAD/EUR', rate: 0.0913, date: now.slice(0, 10), source: 'test' }]);
  const filtered = [...u.searchParams.keys()].some((k) => ['id', 'projet_id', 'updated_at'].includes(k));
  const range = route.request().headers()['range'];
  if (filtered || Number(u.searchParams.get('offset') || 0) > 0 || (range && !range.startsWith('0-'))) return json([]);
  return json(db[table] || []);
});
await ctx.addInitScript(([s, m]) => {
  localStorage.setItem('cockpit-auth', JSON.stringify(s));
  if (!localStorage.getItem('cockpit.prefs.v1')) localStorage.setItem('cockpit.prefs.v1', JSON.stringify({ lang: 'fr', displayCur: 'MAD', period: { from: m, to: m }, immoView: 'mine', immoProjet: '' }));
}, [session, month]);
const p = await ctx.newPage();
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto(`${APP}/#/immo`);
await p.waitForSelector('.page .kpi', { timeout: 20000 });

const num = (s) => Number(String(s).replace(/[^\d,-]/g, '').replace(',', '.'));
const read = () => p.evaluate(() => {
  const k = (t) => { const c = [...document.querySelectorAll('.kpi')].find((x) => x.querySelector('.t').textContent.includes(t)); return c ? c.querySelector('.v').textContent : ''; };
  const seg = [...document.querySelectorAll('.top .seg button, header .seg button, .seg button')].map((x) => x.textContent.trim());
  return { loyers: k('Loyers encaissés'), res: k('Résultat'), seg };
});
const setView = async (label) => { await p.locator('.seg button', { hasText: label }).first().click(); await p.waitForTimeout(300); };
const setProjet = async (label) => { await p.locator('.pchip', { hasText: label }).first().click(); await p.waitForTimeout(300); };

// Tous les projets
await setProjet('Tous les projets');
let r = await read();
check(r.seg.includes('Ma part') && !r.seg.some((x) => /67/.test(x)), 'Tous les projets : bouton « Ma part » sans pourcentage figé', r.seg.join(' | '));
check(r.seg.includes('Total (100 %)'), 'bouton « Total (100 %) » présent', r.seg.join(' | '));
await setView('Ma part'); r = await read();
check(num(r.loyers) === 1670, 'Tous / Ma part : loyers = 1000×67 % + 2000×50 % = 1 670', r.loyers);
check(num(r.res) === 1503, 'Tous / Ma part : résultat = 900×67 % + 1800×50 % = 1 503', r.res);
await setView('Total'); r = await read();
check(num(r.loyers) === 3000, 'Tous / Total : loyers = 3 000', r.loyers);
check(num(r.res) === 2700, 'Tous / Total : résultat = 2 700', r.res);
// Projet Amal 1 (67 %)
await setProjet('Amal 1'); r = await read();
check(r.seg.includes('Ma part (67 %)'), 'Amal 1 : bouton « Ma part (67 %) »', r.seg.join(' | '));
check(num(r.loyers) === 1000, 'Amal 1 / Total : loyers = 1 000', r.loyers);
await setView('Ma part'); r = await read();
check(num(r.loyers) === 670, 'Amal 1 / Ma part : loyers = 670', r.loyers);
// Projet Riad (50 %)
await setProjet('Riad'); r = await read();
check(r.seg.includes('Ma part (50 %)'), 'Riad : bouton « Ma part (50 %) »', r.seg.join(' | '));
check(num(r.loyers) === 1000, 'Riad / Ma part : loyers = 2000×50 % = 1 000', r.loyers);

const real = errs.filter((e) => !/WebSocket|realtime|Failed to fetch/i.test(e));
check(real.length === 0, 'aucune erreur JS', real.join(' | '));
await p.screenshot({ path: '/tmp/immo-part.png' });

// Projet supprimé : Riad n'est plus renvoyé par la base, mais ses opérations et son lot existent toujours
db = { ...db, projets: [P1] };
const ctx2 = await b.newContext({ viewport: { width: 1400, height: 900 } });
await ctx2.route(`${SB}/**`, async (route) => {
  const u = new URL(route.request().url());
  const json = (x) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x), headers: { 'access-control-allow-origin': '*', 'content-range': '0-0/*' } });
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  if (u.pathname.startsWith('/auth/v1/user')) return json(session.user);
  if (u.pathname.startsWith('/auth/v1/') || u.pathname.startsWith('/functions/') || u.pathname.startsWith('/rest/v1/rpc/')) return json({});
  const table = u.pathname.replace('/rest/v1/', '');
  if (table === 'fx_rates') return json([{ pair: 'MAD/EUR', rate: 0.0913, date: now.slice(0, 10), source: 'test' }]);
  const filtered = [...u.searchParams.keys()].some((k) => ['id', 'projet_id', 'updated_at'].includes(k));
  const range = route.request().headers()['range'];
  if (filtered || Number(u.searchParams.get('offset') || 0) > 0 || (range && !range.startsWith('0-'))) return json([]);
  return json(db[table] || []);
});
await ctx2.addInitScript(([s, m]) => {
  localStorage.setItem('cockpit-auth', JSON.stringify(s));
  localStorage.setItem('cockpit.prefs.v1', JSON.stringify({ lang: 'fr', displayCur: 'MAD', period: { from: m, to: m }, immoView: 'full', immoProjet: '', activity: 'Tout' }));
}, [session, month]);
const p2 = await ctx2.newPage();
const errs2 = []; p2.on('pageerror', (e) => errs2.push(e.message));
await p2.goto(`${APP}/#/immo`); await p2.waitForSelector('.page .kpi', { timeout: 20000 }); await p2.waitForTimeout(300);
const k2 = await p2.evaluate(() => { const c = [...document.querySelectorAll('.kpi')].find((x) => x.querySelector('.t').textContent.includes('Loyers encaissés')); return { loyers: c ? c.querySelector('.v').textContent : '', chips: [...document.querySelectorAll('.pchip')].map((x) => x.textContent.trim()), occ: [...document.querySelectorAll('.kpi')].find((x) => x.querySelector('.t').textContent.includes('occupation'))?.querySelector('.v').textContent }; });
check(num(k2.loyers) === 1000, 'projet Riad supprimé : loyers (Total) = 1 000, ceux de Riad ne comptent plus', k2.loyers);
check(!k2.chips.some((c) => c.includes('Riad')), 'projet Riad supprimé : plus proposé', k2.chips.join(' | '));
check((k2.occ || '').replace(/\s/g, '').endsWith('/1'), 'projet Riad supprimé : son lot ne compte plus (1 lot)', k2.occ);
await p2.goto(`${APP}/#/ops`); await p2.waitForTimeout(500);
const opsText = await p2.innerText('.page');
check(!/2\s?000/.test(opsText) && !opsText.includes('200,00'), 'projet Riad supprimé : ses opérations n’apparaissent plus dans Opérations', opsText.slice(0, 200).replace(/\n/g, ' '));
const real2 = errs2.filter((e) => !/WebSocket|realtime|Failed to fetch/i.test(e));
check(real2.length === 0, 'aucune erreur JS (projet supprimé)', real2.join(' | '));
await p2.screenshot({ path: '/tmp/immo-projet-supprime.png' });
await b.close();
console.log(fail ? `\n${fail} échec(s)` : '\nTout est OK');
process.exit(fail ? 1 : 0);
