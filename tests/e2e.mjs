// Tests de bout en bout sur l'application déployée + la vraie base, avec des comptes de TEST jetables
// (jamais le compte réel ; données isolées par RLS ; tout est supprimé à la fin).
//   node tests/e2e.mjs <url de l'app>
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { devices } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import { launch } from './browser.mjs';
import { loadEnv, apiKeys, sql, SB_URL, serviceHeaders } from '../tools/cloud/lib.mjs';
import { parseWorkbook } from '../app/js/xlsxio.js';

const APP = (process.argv[2] || 'http://localhost:8788').replace(/\/$/, '');
const env = loadEnv();
const keys = await apiKeys(env);
const results = [];
const step = async (name, fn) => {
  const t = Date.now();
  try { await fn(); results.push(['✅', name, Date.now() - t]); console.log('✅', name); }
  catch (e) { results.push(['❌', name, Date.now() - t, e.message]); console.log('❌', name, '\n   ', e.message.split('\n')[0]); }
};

// ---------- TOTP (RFC 6238) ----------
function totp(secret, t = Date.now()) {
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = ''; for (const c of secret.replace(/=+$/, '').toUpperCase()) bits += alpha.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const ctr = Buffer.alloc(8); ctr.writeBigUInt64BE(BigInt(Math.floor(t / 30000)));
  const h = crypto.createHmac('sha1', key).update(ctr).digest();
  const o = h[h.length - 1] & 0xf;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0');
}

// ---------- comptes de test ----------
const admin = createClient(SB_URL, keys.service, { auth: { persistSession: false } });
async function makeUser(tag) {
  const email = `e2e-${tag}-${crypto.randomBytes(3).toString('hex')}@cockpit.test`;
  const password = crypto.randomBytes(18).toString('base64url');
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const c = createClient(SB_URL, keys.publishable, { auth: { persistSession: false } });
  await c.auth.signInWithPassword({ email, password });
  const { data: f, error: e2 } = await c.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'e2e' });
  if (e2) throw e2;
  const { error: e3 } = await c.auth.mfa.challengeAndVerify({ factorId: f.id, code: totp(f.totp.secret) });
  if (e3) throw e3;
  return { id: data.user.id, email, password, secret: f.totp.secret, client: c };
}
const T1 = await makeUser('owner');
const T2 = await makeUser('intrus');
console.log('Comptes de test :', T1.email, T2.email);
let browser;
try {
const rest = async (p, body) => {
  const r = await fetch(`${SB_URL}/rest/v1/${p}`, { method: 'POST', headers: serviceHeaders(keys.service), body: JSON.stringify(body) });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
};
// données réalistes : copie de ton fichier (lue en lecture seule)
const src = parseWorkbook(XLSX, fs.readFileSync(process.env.COCKPIT_XLSX || '/tmp/audit/live.xlsx'));
await rest('rpc/ck_restore', { p_uid: T1.id, p_data: src.data, p_label: 'e2e' });

browser = await launch();
async function device(name, opts) {
  const ctx = await browser.newContext({ ...opts, acceptDownloads: true });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('dialog', (d) => d.accept(T1.email));
  return { ctx, page, name };
}
async function login(p, u = T1) {
  await p.goto(APP + '/');
  await p.waitForSelector('input[type=email]');
  await p.fill('input[type=email]', u.email);
  await p.fill('input[type=password]', u.password);
  await p.click('button[type=submit]');
  await p.waitForSelector('input.otp');
  await p.fill('input.otp', totp(u.secret));
  await p.waitForSelector('.page', { timeout: 30000 });
}
const waitText = (p, text, timeout = 15000) => p.waitForFunction((t) => document.body.innerText.includes(t), text, { timeout });
const waitNoText = (p, text, timeout = 15000) => p.waitForFunction((t) => !document.body.innerText.includes(t), text, { timeout });
async function newTx(p, { amount, label, mobile }) {
  if (mobile) await p.click('.tabbar .fab'); else await p.click('.side .btn.primary');
  await p.waitForSelector('.modal input.amount');
  await p.fill('.modal input.amount', amount);
  await p.click('.modal .catgrid .cat >> nth=0');
  await p.fill('.modal input[aria-label="Libellé"]', label);
  await p.click('.modal footer .btn.primary');
  await p.waitForSelector('.modal', { state: 'detached' });
}
async function openTxByLabel(p, label) {
  await p.goto(APP + '/#/ops');
  await p.fill('input[type=search]', label);
  await p.click(`tr.click:has-text("${label}")`);
  await p.waitForSelector('.modal input.amount');
}

const A = await device('PC', { viewport: { width: 1440, height: 900 } });
const B = await device('iPhone', devices['iPhone 14']);
const tag = crypto.randomBytes(2).toString('hex');

await step('Connexion mot de passe + code MFA (PC)', async () => { await login(A.page); });
await step('Connexion mot de passe + code MFA (iPhone)', async () => { await login(B.page); await B.page.waitForSelector('.tabbar .fab'); });

await step('Les 7 écrans s’affichent sans erreur avec les vraies données (PC + iPhone)', async () => {
  for (const d of [A, B]) {
    for (const r of ['dashboard', 'ops', 'freelance', 'immo', 'wealth', 'recurring', 'settings']) {
      await d.page.goto(`${APP}/#/${r}`);
      await d.page.waitForSelector('.page .card');
      assert.equal(await d.page.$('.page pre'), null, `${d.name} ${r} : erreur d'affichage`);
      await d.page.screenshot({ path: `/tmp/e2e-${d.name}-${r}.png`, fullPage: r === 'dashboard' });
    }
    assert.deepEqual(d.page.errors, [], d.name + ' erreurs JS');
  }
  await A.page.goto(APP + '/#/ops');
  await A.page.selectOption('.filters select >> nth=0', '');
  const txt = await A.page.innerText('.page');
  assert.ok(/opérations?/.test(txt));
});

await step('Saisie sur iPhone → visible automatiquement sur le PC (temps réel)', async () => {
  await A.page.goto(APP + '/#/ops');
  await B.page.goto(APP + '/#/ops');
  await newTx(B.page, { amount: '12,34', label: `E2E café ${tag}`, mobile: true });
  await waitText(B.page, `E2E café ${tag}`);
  await A.page.fill('input[type=search]', `E2E café ${tag}`);
  await waitText(A.page, `E2E café ${tag}`, 20000);
});

await step('Saisie sur PC → visible sur iPhone', async () => {
  await newTx(A.page, { amount: '99', label: `E2E PC ${tag}` });
  await B.page.goto(APP + '/#/ops');
  await B.page.fill('input[type=search]', `E2E PC ${tag}`);
  await waitText(B.page, `E2E PC ${tag}`, 20000);
});

await step('Hors connexion sur iPhone : saisie en attente puis envoyée au retour du réseau', async () => {
  await B.ctx.setOffline(true);
  await B.page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await newTx(B.page, { amount: '5', label: `E2E hors ligne ${tag}`, mobile: true });
  await B.page.fill('input[type=search]', `E2E hors ligne ${tag}`);
  await waitText(B.page, `E2E hors ligne ${tag}`);
  const { data: before } = await T1.client.from('tx').select('id').eq('libelle', `E2E hors ligne ${tag}`);
  assert.equal(before.length, 0, 'ne doit pas encore être en base');
  await B.ctx.setOffline(false);
  await B.page.evaluate(() => window.dispatchEvent(new Event('online')));
  for (let i = 0; i < 30; i++) { const { data } = await T1.client.from('tx').select('id').eq('libelle', `E2E hors ligne ${tag}`); if (data.length === 1) return; await new Promise((r) => setTimeout(r, 1000)); }
  throw new Error('non synchronisé après 30 s');
});

await step('Modifications simultanées de champs différents : fusion automatique', async () => {
  await openTxByLabel(A.page, `E2E PC ${tag}`);           // le PC ouvre la ligne (version lue)
  await openTxByLabel(B.page, `E2E PC ${tag}`);
  await B.page.fill('.modal input.amount', '111');
  await B.page.click('.modal footer .btn.primary');
  await B.page.waitForSelector('.modal', { state: 'detached' });
  await new Promise((r) => setTimeout(r, 300));
  await A.page.click('.modal details summary');
  await A.page.fill('.modal textarea', 'note du PC');        // champ différent, version périmée
  await A.page.click('.modal footer .btn.primary');
  await A.page.waitForSelector('.modal', { state: 'detached' });
  const { data } = await T1.client.from('tx').select('montant, note, version').eq('libelle', `E2E PC ${tag}`).single();
  assert.equal(Number(data.montant), 111, 'montant de l’iPhone conservé');
  assert.equal(data.note, 'note du PC', 'note du PC conservée');
});

await step('Modifications simultanées du même champ : choix proposé, aucune perte silencieuse', async () => {
  await openTxByLabel(A.page, `E2E PC ${tag}`);
  await openTxByLabel(B.page, `E2E PC ${tag}`);
  await B.page.fill('.modal input.amount', '222');
  await B.page.click('.modal footer .btn.primary');
  await B.page.waitForSelector('.modal', { state: 'detached' });
  await new Promise((r) => setTimeout(r, 300));
  await A.page.fill('.modal input.amount', '333');
  await A.page.click('.modal footer .btn.primary');
  await A.page.waitForSelector('text=Conflit de modification');
  await A.page.click('.modal footer .btn.primary >> text=Garder ma version');
  await new Promise((r) => setTimeout(r, 1500));
  const { data } = await T1.client.from('tx').select('montant').eq('libelle', `E2E PC ${tag}`).single();
  assert.equal(Number(data.montant), 333);
});

await step('Suppression sur un appareil → disparaît de l’autre ; récupérable via l’historique', async () => {
  await openTxByLabel(B.page, `E2E café ${tag}`);
  await B.page.click('.modal footer .btn.danger');
  await B.page.click('.overlay:last-child .modal footer .btn.danger');
  await A.page.goto(APP + '/#/ops');
  await A.page.fill('input[type=search]', `E2E café ${tag}`);
  await waitText(A.page, 'Aucune opération', 20000);
  await A.page.goto(APP + '/#/settings');
  await A.page.click('text=Historique des modifications');
  await A.page.waitForSelector('text=Suppression · Opération');
  await A.page.click('tr:has-text("Suppression · Opération") >> text=Récupérer');
  await A.page.click('.overlay:last-child .modal footer .btn.primary');
  await new Promise((r) => setTimeout(r, 1500));
  const { data } = await T1.client.from('tx').select('deleted_at').eq('libelle', `E2E café ${tag}`).single();
  assert.equal(data.deleted_at, null);
});

const closeModals = async (p) => { for (let i = 0; i < 4 && await p.$('.overlay'); i++) await p.keyboard.press('Escape'); };
await step('Export Excel complet depuis l’application, relu sans erreur', async () => {
  await closeModals(A.page);
  await A.page.goto(APP + '/#/settings');
  const [dl] = await Promise.all([A.page.waitForEvent('download'), A.page.click('text=Exporter en Excel')]);
  const file = '/tmp/e2e-export.xlsx'; await dl.saveAs(file);
  const r = parseWorkbook(XLSX, fs.readFileSync(file));
  assert.deepEqual(r.errors, []);
  assert.equal(r.counts.tx, src.counts.tx + 3, 'toutes les opérations (+3 créées par le test)');
  assert.ok(r.data.tx.every((t) => t.id), 'UUID présents');
});

await step('Point de restauration : créer, modifier, revenir en arrière', async () => {
  const { data: p, error } = await T1.client.rpc('create_restore_point', { p_label: 'e2e' });
  if (error) throw error;
  await closeModals(A.page);
  await newTx(A.page, { amount: '1', label: `E2E à annuler ${tag}` });
  const { error: e2 } = await T1.client.rpc('restore_point', { p_id: p });
  if (e2) throw e2;
  const { data } = await T1.client.from('tx').select('id').eq('libelle', `E2E à annuler ${tag}`).is('deleted_at', null);
  assert.equal(data.length, 0);
});

await step('Sécurité : un autre compte ne voit ni ne modifie rien ; sans MFA rien n’est lisible ; anonyme refusé', async () => {
  const { data: mine } = await T1.client.from('tx').select('id').limit(1);
  assert.equal(mine.length, 1);
  const { data: other } = await T2.client.from('tx').select('id').limit(5);
  assert.equal(other.length, 0, 'compte intrus : 0 ligne');
  const { error: e1 } = await T2.client.rpc('apply_ops', { p_ops: [{ e: 'tx', op: 'upsert', item: { id: mine[0].id, date: '2026-01-01', activite: 'Perso', sens: 'Dépense', categorie: 'X', montant: 1 } }] });
  assert.ok(e1, 'modification par un autre compte refusée');
  const aal1 = createClient(SB_URL, keys.publishable, { auth: { persistSession: false } });
  await aal1.auth.signInWithPassword({ email: T1.email, password: T1.password });
  const { data: noMfa } = await aal1.from('tx').select('id').limit(5);
  assert.equal(noMfa.length, 0, 'session sans MFA : 0 ligne');
  const { error: e2 } = await aal1.rpc('apply_ops', { p_ops: [] });
  assert.ok(e2 && /MFA/.test(e2.message), 'écriture sans MFA refusée');
  const anon = await fetch(`${SB_URL}/rest/v1/tx?select=id&limit=1`, { headers: { apikey: keys.publishable } });
  const body = await anon.json();
  assert.ok(!anon.ok || (Array.isArray(body) && body.length === 0), 'anonyme : rien');
  const w = await fetch(`${SB_URL}/rest/v1/tx`, { method: 'POST', headers: { apikey: keys.publishable, Authorization: `Bearer ${(await T1.client.auth.getSession()).data.session.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ date: '2026-01-01', activite: 'Perso', sens: 'Dépense', categorie: 'X', montant: 1 }) });
  assert.ok(!w.ok, 'écriture directe dans la table refusée');
});

await step('Application installable (manifeste, service worker, icônes) et en-têtes de sécurité', async () => {
  const m = await (await fetch(APP + '/manifest.webmanifest')).json();
  assert.equal(m.display, 'standalone');
  const sw = await A.page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()));
  if (APP.startsWith('https')) {
    assert.ok(sw, 'service worker actif');
    const h = (await fetch(APP + '/')).headers;
    assert.ok(/default-src 'self'/.test(h.get('content-security-policy') || ''), 'CSP');
    assert.ok(h.get('strict-transport-security'), 'HSTS');
  }
});

} catch (e) { results.push(['❌', 'Erreur fatale', 0, e.message]); console.error(e); } finally {
// ---------- nettoyage (toujours) ----------
if (browser) await browser.close().catch(() => {});
for (const u of [T1, T2]) {
  await sql(env, `delete from public.change_log where user_id = '${u.id}'; delete from public.restore_points where user_id = '${u.id}'; delete from public.notif_log where user_id = '${u.id}';`);
  await admin.auth.admin.deleteUser(u.id);
}
const left = await sql(env, `select count(*)::int n from public.tx where user_id in ('${T1.id}', '${T2.id}')`);
console.log(`Nettoyage : comptes de test supprimés (${left[0].n} ligne restante)`);
}
const lines = ['| | Test | Durée |', '|---|---|---:|', ...results.map(([s, n, d, e]) => `| ${s} | ${n}${e ? ` — ${e.split('\n')[0].replace(/\|/g, '/')}` : ''} | ${(d / 1000).toFixed(1)} s |`)];
fs.writeFileSync('/tmp/e2e-results.md', lines.join('\n') + '\n');
const bad = results.filter((r) => r[0] === '❌').length;
console.log(`\n${results.length - bad}/${results.length} tests réussis`);
process.exit(bad ? 1 : 0);
