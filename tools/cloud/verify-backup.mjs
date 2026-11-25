#!/usr/bin/env node
// Déclenche une sauvegarde externe, la télécharge depuis Cloudflare KV, la DÉCHIFFRE avec BACKUP_KEY
// et compare son contenu à la base. Usage : node tools/cloud/verify-backup.mjs [--no-run]
import crypto from 'node:crypto';
import { loadEnv, cf, sql } from './lib.mjs';
const env = loadEnv();
const acc = env.CLOUDFLARE_ACCOUNT_ID;
if (!process.argv.includes('--no-run')) {
  const r = await fetch(env.COCKPIT_BACKUP_URL + '/run', { headers: { 'x-run-secret': env.CRON_SECRET } });
  console.log('Sauvegarde déclenchée :', r.status, await r.text());
}
const anon = await fetch(env.COCKPIT_BACKUP_URL + '/list');
console.log('Accès sans connexion :', anon.status, anon.status === 401 ? '(refusé ✓)' : '⚠');
const ns = (await cf(env, 'GET', `/accounts/${acc}/storage/kv/namespaces?per_page=100`)).find((n) => n.title === 'cockpit-backups');
const keys = await cf(env, 'GET', `/accounts/${acc}/storage/kv/namespaces/${ns.id}/keys`);
console.log('Sauvegardes présentes :', keys.map((k) => k.name).join(', '));
const last = keys.map((k) => k.name).filter((k) => k.startsWith(`u/${env.COCKPIT_OWNER_ID}/daily/`)).sort().pop();
const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acc}/storage/kv/namespaces/${ns.id}/values/${encodeURIComponent(last)}`, { headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` } });
const buf = Buffer.from(await r.arrayBuffer());
if (buf.subarray(0, 4).toString() !== 'CKB1') throw new Error('format inattendu');
const plainVisible = /"libelle"/.test(buf.toString('latin1'));
const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(env.BACKUP_KEY, 'base64'), buf.subarray(4, 16));
d.setAuthTag(buf.subarray(buf.length - 16));
const json = JSON.parse(Buffer.concat([d.update(buf.subarray(16, buf.length - 16)), d.final()]).toString());
const counts = Object.fromEntries(Object.entries(json.tables).map(([k, v]) => [k, v.length]));
const db = (await sql(env, `select ${Object.keys(counts).map((t) => `(select count(*) from public.${t} where user_id = '${env.COCKPIT_OWNER_ID}' and deleted_at is null)::int as ${t}`).join(', ')}`))[0];
const ok = Object.keys(counts).every((k) => counts[k] === db[k]);
console.log(`${last} : ${buf.length} octets, chiffré ${plainVisible ? '⚠ NON' : '✓ (contenu illisible sans la clé)'}, déchiffré avec BACKUP_KEY ✓`);
console.log('Contenu sauvegarde :', JSON.stringify(counts));
console.log('Base actuelle      :', JSON.stringify(db));
console.log(ok ? 'Sauvegarde complète et identique à la base ✅' : 'ÉCART ❌');
process.exit(ok ? 0 : 1);
