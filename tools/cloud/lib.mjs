// Outils communs aux scripts de déploiement / migration. Les secrets sont lus dans ~/cockpit/.env (jamais versionné).
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const ENV_FILE = path.join(ROOT, '.env');
// Environnement cible : COCKPIT_ENV=dev (projet Supabase + site de développement) ou prod (par défaut)
export const ENV_NAME = process.env.COCKPIT_ENV === 'dev' ? 'dev' : 'prod';
const PROD_REF = 'gliensrtmkczalbhhodm';
function devRef() {
  if (process.env.DEV_REF) return process.env.DEV_REF;
  if (!existsSync(ENV_FILE)) return null;
  const m = readFileSync(ENV_FILE, 'utf8').match(/^DEV_REF=(.+)$/m);
  return m ? m[1].trim() : null;
}
export const REF = ENV_NAME === 'dev' ? devRef() : PROD_REF;
if (ENV_NAME === 'dev' && !REF) { console.error('Environnement dev : DEV_REF manquant dans .env (référence du projet Supabase cockpit-dev).'); process.exit(2); }
export const SB_URL = `https://${REF}.supabase.co`;
// Variables propres à l'environnement : en dev, préfixe DEV_ (ex. DEV_SUPABASE_PUBLISHABLE_KEY, DEV_COCKPIT_APP_URL)
export const k = (name) => (ENV_NAME === 'dev' ? 'DEV_' + name : name);

export function loadEnv() {
  const env = {};
  if (existsSync(ENV_FILE)) {
    for (const line of readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  return { ...env, ...Object.fromEntries(Object.entries(process.env).filter(([x]) => /^(SUPABASE_ACCESS_TOKEN|SUPABASE_PUBLISHABLE_KEY|CLOUDFLARE_|COCKPIT_|DEV_|VAPID_|CRON_SECRET|BACKUP_KEY)/.test(x))) };
}
export function setEnv(k, v) {
  appendFileSync(ENV_FILE, `${existsSync(ENV_FILE) && !readFileSync(ENV_FILE, 'utf8').endsWith('\n') ? '\n' : ''}${k}=${v}\n`, { mode: 0o600 });
}
export function need(env, ...keys) {
  const miss = keys.filter((k) => !env[k]);
  if (miss.length) { console.error(`Variables manquantes dans ${ENV_FILE} : ${miss.join(', ')}`); process.exit(2); }
}
export const randomB64 = (n = 32) => crypto.randomBytes(n).toString('base64');
export const randomHex = (n = 32) => crypto.randomBytes(n).toString('hex');

// ---------- API de gestion Supabase ----------
export async function mgmt(env, method, p, body) {
  const r = await fetch(`https://api.supabase.com${p}`, {
    method, headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let j; try { j = text ? JSON.parse(text) : null; } catch { j = text; }
  if (!r.ok) throw new Error(`${method} ${p} -> ${r.status} ${typeof j === 'string' ? j : JSON.stringify(j)}`);
  return j;
}
export const sql = (env, query) => mgmt(env, 'POST', `/v1/projects/${REF}/database/query`, { query });

export async function apiKeys(env) {
  const list = await mgmt(env, 'GET', `/v1/projects/${REF}/api-keys?reveal=true`);
  const pub = list.find((k) => k.type === 'publishable') || list.find((k) => k.name === 'anon');
  const sec = list.find((k) => k.type === 'secret') || list.find((k) => k.name === 'service_role');
  return { publishable: pub.api_key, service: sec.api_key };
}
// En-têtes pour appeler l'API REST avec la clé de service (nouveau format sb_secret_ ou ancien JWT)
export const serviceHeaders = (key) => ({ apikey: key, ...(key.startsWith('ey') ? { Authorization: `Bearer ${key}` } : {}), 'Content-Type': 'application/json' });

// ---------- API Cloudflare ----------
export async function cf(env, method, p, body, raw = false) {
  const r = await fetch(`https://api.cloudflare.com/client/v4${p}`, {
    method, headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, ...(raw ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.success === false) throw new Error(`CF ${method} ${p} -> ${r.status} ${JSON.stringify(j.errors || j)}`);
  return j.result;
}
export const writeJson = (p, o) => writeFileSync(p, JSON.stringify(o, null, 2));
