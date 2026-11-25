// Mesure la livraison des événements temps réel (compte de test jetable) : N insertions, délai de réception
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { loadEnv, apiKeys, SB_URL, sql } from '../tools/cloud/lib.mjs';
const env = loadEnv(); const keys = await apiKeys(env);
const admin = createClient(SB_URL, keys.service, { auth: { persistSession: false } });
function totp(secret, t = Date.now()) { const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = ''; for (const c of secret.replace(/=+$/, '')) bits += a.indexOf(c).toString(2).padStart(5, '0'); const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2))); const ctr = Buffer.alloc(8); ctr.writeBigUInt64BE(BigInt(Math.floor(t / 30000))); const h = crypto.createHmac('sha1', key).update(ctr).digest(); const o = h[h.length - 1] & 15; return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0'); }
const email = `e2e-rt-${crypto.randomBytes(3).toString('hex')}@cockpit.test`, password = crypto.randomBytes(16).toString('hex');
const { data: u } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
try {
  const c = createClient(SB_URL, keys.publishable, { auth: { persistSession: false } });
  await c.auth.signInWithPassword({ email, password });
  const { data: f } = await c.auth.mfa.enroll({ factorType: 'totp' }); await c.auth.mfa.challengeAndVerify({ factorId: f.id, code: totp(f.totp.secret) });
  const { data: { session } } = await c.auth.getSession(); await c.realtime.setAuth(session.access_token);
  const got = new Map();
  const ch = c.channel('probe');
  for (const t of ['projets', 'tx', 'categories', 'lots', 'tenants', 'clients', 'invoices', 'recurring', 'accounts', 'snapshots', 'params', 'rappels']) ch.on('postgres_changes', { event: '*', schema: 'public', table: t }, (p) => { if (p.new && p.new.libelle) got.set(p.new.libelle, Date.now()); });
  ch.on('postgres_changes', { event: '*', schema: 'public', table: 'projet_membres' }, () => {});
  await new Promise((res) => ch.subscribe((s, e) => { console.log('canal :', s, e ? e.message : ''); if (s === 'SUBSCRIBED') res(); }));
  const sent = new Map();
  for (let i = 0; i < 8; i++) {
    const lib = `probe-${i}`; sent.set(lib, Date.now());
    await c.rpc('apply_ops', { p_ops: [{ e: 'tx', op: 'upsert', item: { date: '2026-11-25', activite: 'Perso', sens: 'Dépense', categorie: 'Courses', montant: 1, libelle: lib } }] });
    await new Promise((r) => setTimeout(r, 1500));
  }
  await new Promise((r) => setTimeout(r, 5000));
  for (const [lib, t] of sent) console.log(lib, got.has(lib) ? `reçu en ${got.get(lib) - t} ms` : 'NON REÇU');
  await c.removeChannel(ch);
} finally {
  await sql(env, `delete from public.change_log where user_id='${u.user.id}'; delete from public.restore_points where user_id='${u.user.id}'; delete from auth.users where id='${u.user.id}'`);
}
process.exit(0);
