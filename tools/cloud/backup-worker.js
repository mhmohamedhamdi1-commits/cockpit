// Cloudflare Worker « cockpit-backup » : sauvegarde externe quotidienne, chiffrée, hors de Supabase.
// - chaque nuit : export complet (fonction ck_export) -> chiffrement AES-256-GCM -> Workers KV
//   (journalières gardées 90 jours, 1 par mois sans limite). L'appel quotidien garde aussi le projet Supabase actif.
// - GET /list et /get?key=… : réservés au propriétaire (jeton Supabase valide, MFA validée, bon identifiant)
// Secrets : SUPABASE_SERVICE_KEY, BACKUP_KEY (32 octets base64), OWNER_ID ; variables : SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, APP_ORIGIN

const MAGIC = new TextEncoder().encode('CKB1');

async function key(env) {
  const raw = Uint8Array.from(atob(env.BACKUP_KEY), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function encrypt(env, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(env), new TextEncoder().encode(text)));
  const out = new Uint8Array(4 + 12 + ct.length);
  out.set(MAGIC, 0); out.set(iv, 4); out.set(ct, 16);
  return out;
}
async function decrypt(env, buf) {
  const b = new Uint8Array(buf);
  if (new TextDecoder().decode(b.slice(0, 4)) !== 'CKB1') throw new Error('format inconnu');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.slice(4, 16) }, await key(env), b.slice(16));
  return new TextDecoder().decode(pt);
}

async function runBackup(env) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/ck_export`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_SERVICE_KEY, ...(env.SUPABASE_SERVICE_KEY.startsWith('ey') ? { Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } : {}), 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_uid: env.OWNER_ID }),
  });
  if (!r.ok) throw new Error(`export ${r.status} ${await r.text()}`);
  const at = new Date().toISOString();
  const text = `{"exported_at":"${at}","tables":${await r.text()}}`;
  const blob = await encrypt(env, text);
  const day = at.slice(0, 10);
  const meta = { size: text.length, at };
  await env.BACKUPS.put(`daily/${day}`, blob, { expirationTtl: 90 * 86400, metadata: meta });
  if (day.endsWith('-01')) await env.BACKUPS.put(`monthly/${day.slice(0, 7)}`, blob, { metadata: meta });
  return meta;
}

async function owner(req, env) {
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return false;
  let claims;
  try { claims = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return false; }
  if (claims.aal !== 'aal2' || claims.sub !== env.OWNER_ID) return false;
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${jwt}` } });
  if (!r.ok) return false;
  const u = await r.json();
  return u.id === env.OWNER_ID;
}

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runBackup(env));
  },
  async fetch(req, env) {
    const cors = { 'Access-Control-Allow-Origin': env.APP_ORIGIN, 'Access-Control-Allow-Headers': 'authorization', 'Access-Control-Allow-Methods': 'GET, OPTIONS', Vary: 'Origin' };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    const url = new URL(req.url);
    const json = (b, s = 200) => new Response(typeof b === 'string' ? b : JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    if (!(await owner(req, env))) return json({ error: 'non autorisé' }, 401);
    if (url.pathname === '/list') {
      const items = [];
      for (const prefix of ['daily/', 'monthly/']) {
        const l = await env.BACKUPS.list({ prefix });
        for (const k of l.keys) items.push({ key: k.name, size: (k.metadata && k.metadata.size) || 0, at: k.metadata && k.metadata.at });
      }
      items.sort((a, b) => (a.key < b.key ? 1 : -1));
      return json({ items });
    }
    if (url.pathname === '/get') {
      const buf = await env.BACKUPS.get(url.searchParams.get('key') || '', 'arrayBuffer');
      if (!buf) return json({ error: 'introuvable' }, 404);
      return json(await decrypt(env, buf));
    }
    if (url.pathname === '/run' && req.method === 'GET') return json(await runBackup(env));
    return json({ error: 'route inconnue' }, 404);
  },
};
