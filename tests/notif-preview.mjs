// Aperçu des notifications calculées par la fonction serveur, sur une copie des données (compte de test jetable)
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';
import { loadEnv, apiKeys, SB_URL, sql, serviceHeaders } from '../tools/cloud/lib.mjs';
import { parseWorkbook } from '../app/js/xlsxio.js';
const env = loadEnv(); const keys = await apiKeys(env);
const admin = createClient(SB_URL, keys.service, { auth: { persistSession: false } });
function totp(secret, t = Date.now()) { const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = ''; for (const c of secret.replace(/=+$/, '')) bits += a.indexOf(c).toString(2).padStart(5, '0'); const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2))); const ctr = Buffer.alloc(8); ctr.writeBigUInt64BE(BigInt(Math.floor(t / 30000))); const h = crypto.createHmac('sha1', key).update(ctr).digest(); const o = h[h.length - 1] & 15; return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0'); }
const email = `e2e-notif-${crypto.randomBytes(3).toString('hex')}@cockpit.test`, password = crypto.randomBytes(16).toString('hex');
const { data: u } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
try {
  const c = createClient(SB_URL, keys.publishable, { auth: { persistSession: false } });
  await c.auth.signInWithPassword({ email, password });
  const { data: f } = await c.auth.mfa.enroll({ factorType: 'totp' }); await c.auth.mfa.challengeAndVerify({ factorId: f.id, code: totp(f.totp.secret) });
  const src = parseWorkbook(XLSX, fs.readFileSync(process.env.COCKPIT_XLSX || '/tmp/audit/live.xlsx'));
  src.data.rappels = [{ titre: 'Test échéance du jour', categorie: 'Fiscal', frequence: 'Une fois', date: new Date().toISOString().slice(0, 10), avance: 0, actif: 'Oui', note: '' }];
  const r = await fetch(`${SB_URL}/rest/v1/rpc/ck_restore`, { method: 'POST', headers: serviceHeaders(keys.service), body: JSON.stringify({ p_uid: u.user.id, p_data: src.data, p_label: 'test' }) });
  if (!r.ok) throw new Error(await r.text());
  for (const h of [Number(process.argv[2] || 8), 17, 20]) {
    const { data, error } = await c.functions.invoke('rappels', { body: { preview: true, force_hour: h } });
    console.log(`\n— ${h} h —`, error ? 'ERREUR ' + (await error.context?.text?.() || error.message) : '');
    for (const n of (data && data.notes) || []) console.log(`  [${n.key}] ${n.title} — ${n.body}`);
  }
  const { data: t } = await c.functions.invoke('rappels', { body: { test: true } });
  console.log('\nEnvoi test (aucun appareil abonné) :', JSON.stringify(t));
} finally {
  await sql(env, `delete from public.change_log where user_id='${u.user.id}'; delete from public.restore_points where user_id='${u.user.id}'; delete from auth.users where id='${u.user.id}'`);
}
