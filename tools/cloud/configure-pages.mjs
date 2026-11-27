// Configure un projet Cloudflare Pages (build Git) : commande de build, branche de production, variables PUBLIQUES.
// Usage : CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... node tools/cloud/configure-pages.mjs <prod|dev> <SUPABASE_URL> <SUPABASE_PUBLISHABLE_KEY> <VAPID_PUBLIC_KEY> [BACKUP_URL]
// Supprime les anciennes variables du projet (ex. SUPABASE_ANON_KEY) et désactive les déploiements de prévisualisation.
const [, , target, url, key, vapid, backup] = process.argv;
const T = process.env.CLOUDFLARE_API_TOKEN, AID = process.env.CLOUDFLARE_ACCOUNT_ID;
const P = { prod: ['cockpit-finances', 'release'], dev: ['cockpit-finances-dev', 'main'] }[target];
if (!T || !AID || !P || !url || !/^sb_publishable_/.test(key || '') || !vapid) { console.error('Usage : voir l\'en-tête du fichier (clé obligatoirement sb_publishable_…)'); process.exit(1); }
const [name, branch] = P;
const call = async (method, path, body) => (await fetch('https://api.cloudflare.com/client/v4' + path, { method, headers: { Authorization: 'Bearer ' + T, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) })).json();

const cur = (await call('GET', `/accounts/${AID}/pages/projects/${name}`)).result;
if (!cur) { console.error('Projet introuvable', name); process.exit(1); }
const env = { SUPABASE_URL: url, SUPABASE_PUBLISHABLE_KEY: key, VAPID_PUBLIC_KEY: vapid, NODE_VERSION: '20', ...(backup ? { BACKUP_URL: backup } : {}) };
const vars = Object.fromEntries(Object.entries(env).map(([k, v]) => [k, { type: 'plain_text', value: v }]));
for (const old of Object.keys(cur.deployment_configs.production.env_vars || {})) if (!(old in env)) vars[old] = null;
cur.source.config.production_branch = branch;
cur.source.config.preview_deployment_setting = 'none';
const r = await call('PATCH', `/accounts/${AID}/pages/projects/${name}`, {
  production_branch: branch, source: cur.source,
  build_config: { build_command: 'node tools/cloud/pages-build.mjs', destination_dir: 'dist', root_dir: '' },
  deployment_configs: { production: { env_vars: vars } },
});
console.log(name, r.success ? 'OK' : 'ÉCHEC', (r.errors || []).map((e) => e.message).join('; '));
if (r.success) console.log('branche :', r.result.source.config.production_branch, '| build :', r.result.build_config.build_command, '→', r.result.build_config.destination_dir, '| variables :', Object.keys(r.result.deployment_configs.production.env_vars || {}).join(', '));
