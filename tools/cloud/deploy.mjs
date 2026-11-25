#!/usr/bin/env node
// Déploiement de Cockpit.
//   node tools/cloud/deploy.mjs supabase   base (schéma, règles, tâches planifiées), fonction de notifications, réglages d'authentification
//   node tools/cloud/deploy.mjs app        construit l'application (dist/) et la publie sur Cloudflare Pages
//   node tools/cloud/deploy.mjs worker     sauvegarde externe chiffrée (Cloudflare Worker + KV)
//   node tools/cloud/deploy.mjs lock       ferme les inscriptions (après création du compte) et republie l'app
//   node tools/cloud/deploy.mjs build      construit seulement dist/ (tests locaux)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as webpush from 'web-push';
import { ROOT, REF, SB_URL, loadEnv, setEnv, need, mgmt, sql, apiKeys, cf, randomB64, randomHex } from './lib.mjs';

const env = loadEnv();
const DIST = path.join(ROOT, 'dist');
const log = (...a) => console.log('•', ...a);
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function ensureGenerated() {
  if (!env.VAPID_PUBLIC_KEY) {
    const k = webpush.generateVAPIDKeys();
    setEnv('VAPID_PUBLIC_KEY', k.publicKey); setEnv('VAPID_PRIVATE_KEY', k.privateKey);
    env.VAPID_PUBLIC_KEY = k.publicKey; env.VAPID_PRIVATE_KEY = k.privateKey;
    log('Clés VAPID (notifications) générées');
  }
  if (!env.CRON_SECRET) { env.CRON_SECRET = randomHex(24); setEnv('CRON_SECRET', env.CRON_SECRET); }
  if (!env.BACKUP_KEY) { env.BACKUP_KEY = randomB64(32); setEnv('BACKUP_KEY', env.BACKUP_KEY); log('Clé de chiffrement des sauvegardes générée (BACKUP_KEY dans .env : à recopier dans ton gestionnaire de mots de passe)'); }
}

function run(cmd, args, extraEnv = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...extraEnv } });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} a échoué (${r.status})`);
}

async function publishableKey() {
  if (env.SUPABASE_PUBLISHABLE_KEY) return env.SUPABASE_PUBLISHABLE_KEY;
  if (env.COCKPIT_TEST_KEY) return env.COCKPIT_TEST_KEY;
  need(env, 'SUPABASE_ACCESS_TOKEN');
  const k = (await apiKeys(env)).publishable;
  setEnv('SUPABASE_PUBLISHABLE_KEY', k); env.SUPABASE_PUBLISHABLE_KEY = k;
  return k;
}

// ---------------------------------------------------------------- Supabase
async function deploySupabase() {
  need(env, 'SUPABASE_ACCESS_TOKEN');
  ensureGenerated();
  const keys = await apiKeys(env);
  if (!env.SUPABASE_PUBLISHABLE_KEY) { setEnv('SUPABASE_PUBLISHABLE_KEY', keys.publishable); env.SUPABASE_PUBLISHABLE_KEY = keys.publishable; }
  for (const f of ['0001_schema.sql', '0002_logic.sql']) { await sql(env, read('supabase/migrations/' + f)); log('Migration', f); }
  await sql(env, `do $$ begin
    if exists (select 1 from vault.secrets where name = 'cockpit_cron_secret') then
      perform vault.update_secret((select id from vault.secrets where name = 'cockpit_cron_secret'), '${env.CRON_SECRET}');
    else perform vault.create_secret('${env.CRON_SECRET}', 'cockpit_cron_secret', 'Appel planifié de la fonction rappels'); end if; end $$;`);
  await sql(env, read('supabase/migrations/0003_platform.sql').replace('__FUNCTION_URL__', `${SB_URL}/functions/v1/rappels`));
  log('Migration 0003_platform.sql (temps réel, tâches planifiées)');
  await mgmt(env, 'POST', `/v1/projects/${REF}/secrets`, [
    { name: 'VAPID_PUBLIC_KEY', value: env.VAPID_PUBLIC_KEY }, { name: 'VAPID_PRIVATE_KEY', value: env.VAPID_PRIVATE_KEY },
    { name: 'CRON_SECRET', value: env.CRON_SECRET }, { name: 'CK_SERVICE_KEY', value: keys.service },
    { name: 'APP_URL', value: env.COCKPIT_APP_URL || '' }, { name: 'VAPID_CONTACT', value: env.COCKPIT_CONTACT || 'cockpit@example.com' },
  ]);
  log('Secrets de la fonction enregistrés');
  const shared = path.join(ROOT, 'supabase/functions/_shared');
  fs.mkdirSync(shared, { recursive: true });
  for (const f of ['core.js', 'util.js', 'schema.js']) fs.copyFileSync(path.join(ROOT, 'app/js', f), path.join(shared, f));
  run('npx', ['supabase', 'functions', 'deploy', 'rappels', '--project-ref', REF, '--no-verify-jwt', '--use-api', '--yes'], { SUPABASE_ACCESS_TOKEN: env.SUPABASE_ACCESS_TOKEN });
  log('Fonction « rappels » déployée');
  await authConfig(env.COCKPIT_SIGNUP_LOCKED === '1');
}

async function authConfig(lock) {
  const cur = await mgmt(env, 'GET', `/v1/projects/${REF}/config/auth`);
  const want = {
    site_url: env.COCKPIT_APP_URL || cur.site_url,
    uri_allow_list: [env.COCKPIT_APP_URL, env.COCKPIT_APP_URL && env.COCKPIT_APP_URL + '/**', 'http://localhost:8788', 'http://localhost:8788/**'].filter(Boolean).join(','),
    mailer_autoconfirm: true,               // pas d'e-mail de confirmation : l'inscription est fermée juste après
    password_min_length: 12,
    mfa_totp_enroll_enabled: true,
    mfa_totp_verify_enabled: true,
    mfa_max_enrolled_factors: 10,
    disable_signup: !!lock,
  };
  const patch = Object.fromEntries(Object.entries(want).filter(([k]) => k in cur));
  await mgmt(env, 'PATCH', `/v1/projects/${REF}/config/auth`, patch);
  log(`Authentification configurée (inscriptions ${lock ? 'FERMÉES' : 'ouvertes'}, MFA TOTP, mot de passe ≥ 12)`);
}

// ---------------------------------------------------------------- Application
function walk(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p, base) : [path.relative(base, p).split(path.sep).join('/')];
  });
}
async function build() {
  const key = await publishableKey();
  ensureGenerated();
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, 'app'), DIST, { recursive: true });
  const buildId = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const locked = env.COCKPIT_SIGNUP_LOCKED === '1';
  fs.writeFileSync(path.join(DIST, 'config.js'), `// Généré le ${new Date().toISOString()} — configuration publique (aucun secret)
export const CONFIG = ${JSON.stringify({ url: SB_URL, key, vapid: env.VAPID_PUBLIC_KEY, backupUrl: env.COCKPIT_BACKUP_URL || '__BACKUP_URL__', allowSignup: !locked, build: buildId }, null, 2)};
`);
  const assets = ['/', ...walk(DIST).filter((f) => !['sw.js', '_headers'].includes(f) && !f.endsWith('.map')).map((f) => '/' + f)];
  const sw = fs.readFileSync(path.join(DIST, 'sw.js'), 'utf8').replace('__BUILD__', buildId).replace('__ASSETS__', JSON.stringify(assets));
  fs.writeFileSync(path.join(DIST, 'sw.js'), sw);
  const connect = ["'self'", SB_URL, SB_URL.replace('https', 'wss'), env.COCKPIT_BACKUP_URL].filter(Boolean).join(' ');
  fs.writeFileSync(path.join(DIST, '_headers'), `/*
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src ${connect}; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
  X-Frame-Options: DENY
/sw.js
  Cache-Control: no-cache
/index.html
  Cache-Control: no-cache
/config.js
  Cache-Control: no-cache
`);
  log(`Application construite dans dist/ (build ${buildId}, ${assets.length} fichiers, inscriptions ${locked ? 'fermées' : 'ouvertes'})`);
}

async function deployApp() {
  need(env, 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID');
  const acc = env.CLOUDFLARE_ACCOUNT_ID, name = env.COCKPIT_PAGES_PROJECT || 'cockpit-finances';
  let proj;
  try { proj = await cf(env, 'GET', `/accounts/${acc}/pages/projects/${name}`); }
  catch { proj = await cf(env, 'POST', `/accounts/${acc}/pages/projects`, { name, production_branch: 'main' }); log('Projet Cloudflare Pages créé :', name); }
  const url = `https://${proj.subdomain}`;
  if (env.COCKPIT_APP_URL !== url) { setEnv('COCKPIT_APP_URL', url); env.COCKPIT_APP_URL = url; if (env.SUPABASE_ACCESS_TOKEN) { await authConfig(env.COCKPIT_SIGNUP_LOCKED === '1'); await mgmt(env, 'POST', `/v1/projects/${REF}/secrets`, [{ name: 'APP_URL', value: url }]); } }
  await build();
  run('npx', ['wrangler', 'pages', 'deploy', 'dist', '--project-name', name, '--branch', 'main', '--commit-dirty=true'], { CLOUDFLARE_API_TOKEN: env.CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID: acc });
  log('Application publiée :', url);
}

// ---------------------------------------------------------------- Sauvegarde externe
async function deployWorker() {
  need(env, 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'SUPABASE_ACCESS_TOKEN', 'COCKPIT_OWNER_ID');
  ensureGenerated();
  const acc = env.CLOUDFLARE_ACCOUNT_ID, name = 'cockpit-backup';
  const nss = await cf(env, 'GET', `/accounts/${acc}/storage/kv/namespaces?per_page=100`);
  let ns = nss.find((n) => n.title === 'cockpit-backups');
  if (!ns) { ns = await cf(env, 'POST', `/accounts/${acc}/storage/kv/namespaces`, { title: 'cockpit-backups' }); log('Espace KV créé'); }
  let sub;
  try { sub = (await cf(env, 'GET', `/accounts/${acc}/workers/subdomain`)).subdomain; } catch { sub = null; }
  if (!sub) { sub = (await cf(env, 'PUT', `/accounts/${acc}/workers/subdomain`, { subdomain: `cockpit-${randomHex(3)}` })).subdomain; log('Sous-domaine workers.dev créé :', sub); }
  const dir = path.join(ROOT, 'tools/cloud/.worker');
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'tools/cloud/backup-worker.js'), path.join(dir, 'index.js'));
  fs.writeFileSync(path.join(dir, 'wrangler.toml'), `name = "${name}"
main = "index.js"
compatibility_date = "2026-11-01"
workers_dev = true
[triggers]
crons = ["30 2 * * *"]
[[kv_namespaces]]
binding = "BACKUPS"
id = "${ns.id}"
[vars]
SUPABASE_URL = "${SB_URL}"
SUPABASE_PUBLISHABLE_KEY = "${await publishableKey()}"
APP_ORIGIN = "${env.COCKPIT_APP_URL || '*'}"
`);
  const cfEnv = { CLOUDFLARE_API_TOKEN: env.CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID: acc };
  spawnSync('npx', ['wrangler', 'deploy', '--config', path.join(dir, 'wrangler.toml')], { cwd: dir, stdio: 'inherit', env: { ...process.env, ...cfEnv } });
  const keys = await apiKeys(env);
  for (const [k, v] of [['SUPABASE_SERVICE_KEY', keys.service], ['BACKUP_KEY', env.BACKUP_KEY], ['OWNER_ID', env.COCKPIT_OWNER_ID]]) {
    await cf(env, 'PUT', `/accounts/${acc}/workers/scripts/${name}/secrets`, { name: k, text: v, type: 'secret_text' });
  }
  const url = `https://${name}.${sub}.workers.dev`;
  if (env.COCKPIT_BACKUP_URL !== url) { setEnv('COCKPIT_BACKUP_URL', url); env.COCKPIT_BACKUP_URL = url; }
  log('Sauvegarde externe déployée :', url, '(chaque nuit à 02:30 UTC)');
}

// ---------------------------------------------------------------- Main
const cmd = process.argv[2];
const steps = { supabase: deploySupabase, app: deployApp, worker: deployWorker, build,
  lock: async () => { setEnv('COCKPIT_SIGNUP_LOCKED', '1'); env.COCKPIT_SIGNUP_LOCKED = '1'; await authConfig(true); await deployApp(); },
  auth: async () => authConfig(env.COCKPIT_SIGNUP_LOCKED === '1') };
if (!steps[cmd]) { console.log('Usage : node tools/cloud/deploy.mjs supabase|app|worker|lock|build|auth'); process.exit(1); }
steps[cmd]().catch((e) => { console.error('ÉCHEC :', e.message); process.exit(1); });
