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
  catch (e) { results.push(['❌', name, Date.now() - t, e.message]); console.log('❌', name, '\n   ', e.message.split('\n')[0]); for (const [i, pg] of (globalThis.__pages || []).entries()) { try { await pg.screenshot({ path: `/tmp/e2e-fail-${i}.png` }); } catch { /* page fermée */ } } for (const pg of globalThis.__pages || []) if (pg.errors && pg.errors.length) console.log('    erreurs de page :', pg.errors.slice(0, 3).join(' | ').slice(0, 400)); }
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
globalThis.__pages = [A.page, B.page];

await step('Connexion mot de passe + code MFA (PC)', async () => { await login(A.page); });
await step('Connexion mot de passe + code MFA (iPhone)', async () => { await login(B.page); await B.page.waitForSelector('.tabbar .fab'); });

await step('Les 7 écrans s’affichent sans erreur avec les vraies données (PC + iPhone)', async () => {
  for (const d of [A, B]) {
    for (const r of ['dashboard', 'ops', 'entreprise', 'immo', 'wealth', 'recurring', 'settings']) {
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


await step('Nouvel utilisateur par l’interface : inscription, code de sécurité, base vide et privée, déconnexion visible, suppression du compte', async () => {
  const N = await device('nouveau', devices['iPhone 14']);
  const p = N.page;
  const email = `e2e-signup-${crypto.randomBytes(3).toString('hex')}@cockpit.test`, password = crypto.randomBytes(12).toString('hex');
  await p.goto(APP + '/');
  await p.click('text=Pas encore de compte ? Créer un compte');
  await p.fill('input[type=email]', email);
  await p.fill('input[autocomplete=new-password] >> nth=0', password);
  await p.fill('input[autocomplete=new-password] >> nth=1', password);
  await p.click('button[type=submit]');
  await p.waitForSelector('code.secret', { timeout: 20000 });
  const secret = (await p.innerText('code.secret')).replace(/\s/g, '');
  await p.fill('input.otp', totp(secret));
  await p.waitForSelector('.page', { timeout: 30000 });
  await p.goto(APP + '/#/ops');
  await waitText(p, 'Aucune opération');
  await p.click('.tabbar .fab');
  await p.waitForSelector('.modal .catgrid .cat');
  const nCats = await p.locator('.modal .cat').count();
  assert.ok(nCats >= 5, 'catégories de départ présentes');
  await p.keyboard.press('Escape');
  const { data: u } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const nu = u.users.find((x) => x.email === email);
  const [{ n }] = await sql(env, `select count(*)::int n from public.tx where user_id = '${nu.id}'`);
  assert.equal(n, 0, 'aucune donnée d’un autre compte');
  // déconnexion depuis le menu « Plus »
  await p.click('.tabbar button:has-text("Plus")');
  await p.click('.morelogout');
  await p.click('.overlay:last-child .modal footer .btn.primary');
  await p.waitForSelector('input[type=email]', { timeout: 15000 });
  // reconnexion puis suppression du compte
  await p.fill('input[type=email]', email); await p.fill('input[type=password]', password); await p.click('button[type=submit]');
  await p.waitForSelector('input.otp'); await new Promise((r) => setTimeout(r, 31000 - (Date.now() % 30000)));
  await p.fill('input.otp', totp(secret));
  await p.waitForSelector('.page', { timeout: 30000 });
  await p.goto(APP + '/#/settings');
  await p.click('text=Supprimer mon compte');
  await p.fill('.modal input[placeholder=SUPPRIMER]', 'SUPPRIMER');
  await p.click('.modal footer .btn.danger');
  await p.waitForSelector('input[type=email]', { timeout: 20000 });
  const [{ c }] = await sql(env, `select count(*)::int c from auth.users where email = '${email}'`);
  assert.equal(c, 0, 'compte supprimé');
  assert.deepEqual(p.errors, []);
  await N.ctx.close();
});

await step('Taux de change réel affiché et appliqué aux nouvelles opérations en MAD', async () => {
  await A.page.keyboard.press('Escape');
  await A.page.goto(APP + '/#/settings');
  await waitText(A.page, 'Taux réel du');
  const [fx] = await sql(env, "select rate from public.fx_rates where pair = 'MAD/EUR' order by date desc limit 1");
  const { error } = await T1.client.rpc('apply_ops', { p_ops: [{ e: 'tx', op: 'upsert', item: { date: new Date().toISOString().slice(0, 10), activite: 'Immobilier', sens: 'Revenu', categorie: 'Loyer', montant: 1000, devise: 'MAD', libelle: `E2E taux ${tag}` } }] });
  if (error) throw error;
  const { data } = await T1.client.from('tx').select('taux').eq('libelle', `E2E taux ${tag}`).single();
  assert.ok(Math.abs(Number(data.taux) - Number(fx.rate)) < 0.002, `taux appliqué ${data.taux} ≈ taux réel ${fx.rate}`);
});


await step('Fonctions serveur v3 : aperçu des notifications (électricité, imports, échéances) et secteur des titres', async () => {
  const r = await T1.client.functions.invoke('rappels', { body: { preview: true, force_hour: 8 } });
  if (r.error) throw new Error('rappels : ' + (r.error.message || r.error));
  assert.ok(r.data && r.data.ok && Array.isArray(r.data.notes), 'aperçu des notifications');
  const s = await T1.client.functions.invoke('bourse', { body: { action: 'search', q: 'GOOGL' } });
  if (s.error) throw new Error('bourse : ' + (s.error.message || s.error));
  const g = s.data.results.find((x) => x.symbole === 'GOOGL');
  assert.ok(g && g.secteur, 'secteur renvoyé par la recherche : ' + JSON.stringify(g));
  const q = await T1.client.functions.invoke('bourse', { body: { action: 'quotes', symbols: ['GOOGL', 'CW8.PA'] } });
  const gq = q.data.quotes.find((x) => x.symbole === 'GOOGL');
  assert.ok(gq && gq.secteur && gq.secteur !== '-', 'secteur dans les cours : ' + JSON.stringify(gq && gq.secteur));
  for (const pair of ['USD/EUR', 'GBP/EUR', 'CHF/EUR']) {
    const { data: fx } = await T1.client.from('fx_rates').select('rate').eq('pair', pair).order('date', { ascending: false }).limit(1);
    assert.ok(fx && fx.length && fx[0].rate > 0, `taux ${pair} disponible`);
  }
});

await step('Projet partagé : lien d’invitation, l’invité voit UNIQUEMENT ce projet en lecture seule, retrait d’accès immédiat', async () => {
  // le propriétaire (T1) range ses lots dans « Amal 1 » et crée un « Projet 2 » privé
  const p1 = crypto.randomUUID(), p2 = crypto.randomUUID();
  const { error: e0 } = await T1.client.rpc('apply_ops', { p_ops: [{ e: 'projet', op: 'upsert', item: { id: p1, _insert: true, nom: `Amal test ${tag}`, part: 0.67 } }, { e: 'projet', op: 'upsert', item: { id: p2, _insert: true, nom: `Projet 2 ${tag}`, part: 1 } }, { e: 'lot', op: 'upsert', item: { nom: `Lot secret ${tag}`, projet_id: p2, loyer: 5000 } }] });
  if (e0) throw e0;
  const { data: lots } = await T1.client.from('lots').select('id,version,nom').is('projet_id', null);
  const { error: e1 } = await T1.client.rpc('apply_ops', { p_ops: lots.map((l) => ({ e: 'lot', op: 'upsert', item: { id: l.id, version: l.version, projet_id: p1 } })) });
  if (e1) throw e1;
  // partage via l'interface (PC du propriétaire)
  await closeModals(A.page);
  await A.page.goto(APP + '/#/immo');
  await A.page.click(`.pchip:has-text("Amal test ${tag}")`);
  await A.page.click('.pdetail button:has-text("Partager")');
  await A.page.fill('.modal input[placeholder="ex. Fatima (sœur)"]', 'Sœur test');
  await A.page.fill('.modal input[placeholder="33"]', '33');
  await A.page.click('.modal button:has-text("Créer un lien d’invitation")');
  const link = (await A.page.innerText('.modal .invlink code', { timeout: 15000 })).trim();
  assert.ok(/#\/invitation\?i=[0-9a-f]{64}$/.test(link), 'lien : ' + link);
  await closeModals(A.page);
  // l'invité (T2, autre compte) ouvre le lien sur son iPhone
  const G = await device('invité', devices['iPhone 14']);
  await login(G.page, T2);
  await G.page.goto(link.replace(/^https?:\/\/[^/]+/, APP));
  await waitText(G.page, 'Tu as maintenant accès', 20000);
  await waitText(G.page, `Amal test ${tag}`);
  const body = await G.page.innerText('body');
  assert.ok(!body.includes(`Projet 2 ${tag}`), 'Projet 2 invisible');
  assert.ok(body.includes('lecture seule'), 'mention lecture seule');
  assert.equal(await G.page.$('.pdetail button:has-text("Partager")'), null, 'pas de bouton Partager');
  assert.equal(await G.page.$('button:has-text("Encaisser les loyers")'), null, 'pas d’encaissement');
  // ce que la base renvoie à l'invité
  const { count: nIn } = await T2.client.from('tx').select('id', { count: 'exact', head: true }).eq('projet_id', p1);
  const { count: nAll } = await T2.client.from('tx').select('id', { count: 'exact', head: true });
  const [{ n: nOwner }] = await sql(env, `select count(*)::int n from public.tx where projet_id = '${p1}' and deleted_at is null`);
  assert.equal(nIn, nOwner, `toutes les opérations du projet visibles (${nIn}/${nOwner})`);
  assert.equal(nAll, nIn, 'aucune autre opération visible (ni perso, ni Projet 2)');
  const { data: glots } = await T2.client.from('lots').select('nom');
  assert.ok(!glots.some((l) => l.nom === `Lot secret ${tag}`));
  // lecture seule : ouvrir une opération -> pas de bouton Enregistrer ; écriture refusée côté serveur
  await G.page.goto(APP + '/#/ops');
  await G.page.click('tr.click >> nth=0');
  await G.page.waitForSelector('.readonly-banner');
  assert.equal(await G.page.$('.modal footer .btn.primary'), null);
  await G.page.keyboard.press('Escape');
  const { error: we } = await T2.client.rpc('apply_ops', { p_ops: [{ e: 'tx', op: 'upsert', item: { id: (await T2.client.from('tx').select('id').limit(1)).data[0].id, montant: 1 } }] });
  assert.ok(we, 'modification refusée');
  // sa part : 33 %
  const { data: mem } = await T2.client.from('projet_membres').select('part, role, status').single();
  assert.deepEqual([Number(mem.part), mem.role, mem.status], [0.33, 'lecteur', 'actif']);
  // retrait de l'accès par le propriétaire -> l'invité ne voit plus rien
  await A.page.goto(APP + '/#/immo');
  await A.page.click('.pdetail button:has-text("Partager")');
  await A.page.click('.modal button[title="Retirer l’accès"]');
  await A.page.click('.overlay:last-child .modal footer .btn.danger');
  await waitText(A.page, 'Accès retiré');
  await closeModals(A.page);
  const { data: after } = await T2.client.from('tx').select('id').limit(5);
  assert.equal(after.length, 0, 'plus aucun accès côté base');
  await G.page.evaluate(() => window.dispatchEvent(new Event('online')));
  await G.page.goto(APP + '/#/immo');
  await waitNoText(G.page, `Amal test ${tag}`, 30000);
  assert.deepEqual(G.page.errors, []);
  await G.ctx.close();
});

} catch (e) { results.push(['❌', 'Erreur fatale', 0, e.message]); console.error(e); } finally {
// ---------- nettoyage (toujours) ----------
if (browser) await browser.close().catch(() => {});
for (const u of [T1, T2]) {
  await sql(env, `delete from public.change_log where user_id = '${u.id}'; delete from public.restore_points where user_id = '${u.id}'; delete from public.notif_log where user_id = '${u.id}';`);
  await admin.auth.admin.deleteUser(u.id);
}
const leftovers = await sql(env, "select id from auth.users where email like 'e2e-signup-%@cockpit.test'");
for (const x of leftovers) await sql(env, `delete from public.change_log where user_id = '${x.id}'; delete from auth.users where id = '${x.id}'`);
const left = await sql(env, `select count(*)::int n from public.tx where user_id in ('${T1.id}', '${T2.id}')`);
console.log(`Nettoyage : comptes de test supprimés (${left[0].n} ligne restante)`);
}
const lines = ['| | Test | Durée |', '|---|---|---:|', ...results.map(([s, n, d, e]) => `| ${s} | ${n}${e ? ` — ${e.split('\n')[0].replace(/\|/g, '/')}` : ''} | ${(d / 1000).toFixed(1)} s |`)];
fs.writeFileSync('/tmp/e2e-results.md', lines.join('\n') + '\n');
const bad = results.filter((r) => r[0] === '❌').length;
console.log(`\n${results.length - bad}/${results.length} tests réussis`);
process.exit(bad ? 1 : 0);
