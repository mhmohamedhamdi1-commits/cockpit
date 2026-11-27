// Build du site pour Cloudflare Pages (build Git) : app/ -> dist/ avec la configuration publique de l'environnement.
// Aucune dépendance. Variables lues (réglées dans Cloudflare Pages > Settings > Variables, toutes publiques) :
//   SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, VAPID_PUBLIC_KEY, BACKUP_URL (optionnelle), SIGNUP_LOCKED=1 (optionnelle)
// La clé « publishable » est faite pour être visible ; ne JAMAIS mettre ici une clé secrète / service_role / jeton API.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const SRC = path.join(ROOT, 'app'), DIST = path.join(ROOT, 'dist');
const e = process.env;

const fail = (m) => { console.error('ERREUR build : ' + m); process.exit(1); };
const url = (e.SUPABASE_URL || '').trim().replace(/\/$/, '');
const key = (e.SUPABASE_PUBLISHABLE_KEY || '').trim();
const vapid = (e.VAPID_PUBLIC_KEY || '').trim();
const backupUrl = (e.BACKUP_URL || '').trim().replace(/\/$/, '');

if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(url)) fail('SUPABASE_URL absente ou invalide');
if (!/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(key)) fail('SUPABASE_PUBLISHABLE_KEY absente ou invalide (doit commencer par sb_publishable_)');
if (!vapid) fail('VAPID_PUBLIC_KEY absente');

function walk(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p, base) : [path.relative(base, p).split(path.sep).join('/')];
  });
}

fs.rmSync(DIST, { recursive: true, force: true });
fs.cpSync(SRC, DIST, { recursive: true });
const buildId = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);

fs.writeFileSync(path.join(DIST, 'config.js'), `// Généré le ${new Date().toISOString()} par tools/cloud/pages-build.mjs — configuration publique (aucun secret)
export const CONFIG = ${JSON.stringify({ url, key, vapid, backupUrl: backupUrl || '__BACKUP_URL__', allowSignup: e.SIGNUP_LOCKED !== '1', build: buildId }, null, 2)};
`);

const assets = ['/', ...walk(DIST).filter((f) => !['sw.js', '_headers'].includes(f) && !f.endsWith('.map')).map((f) => '/' + f)];
const swPath = path.join(DIST, 'sw.js');
fs.writeFileSync(swPath, fs.readFileSync(swPath, 'utf8').replace('__BUILD__', buildId).replace('__ASSETS__', JSON.stringify(assets)));

const connect = ["'self'", url, url.replace('https', 'wss'), backupUrl].filter(Boolean).join(' ');
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

// garde-fous : aucun placeholder ne doit survivre dans ce qui est publié
for (const f of ['config.js', 'sw.js']) {
  const t = fs.readFileSync(path.join(DIST, f), 'utf8');
  const left = (t.match(/__[A-Z_]+__/g) || []).filter((x) => x !== '__BACKUP_URL__');
  if (left.length) fail(`${f} contient encore des placeholders : ${[...new Set(left)].join(', ')}`);
}
console.log(`Site construit dans dist/ — build ${buildId}, ${assets.length} fichiers, projet ${url.slice(8, 28)}…, inscriptions ${e.SIGNUP_LOCKED === '1' ? 'fermées' : 'ouvertes'}`);
