// Fausse API Supabase pour les tests d'interface (navigateur headless) : lecture des tables, apply_ops en mémoire,
// auth MFA simulée, fonctions de bourse. AUCUNE base réelle n'est touchée.
//   import { installMockApi, makeSession, buildDist, serveDist } from './mock-api.mjs'
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { BY_ENTITY, TABLES } from '../app/js/schema.js';
import { UID, MOCK_QUOTES } from './mockdata.mjs';

export const FAKE_URL = 'https://abcdefghijklmnopqrst.supabase.co';
const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

// Construit dist/ avec une configuration factice (le navigateur ne contactera jamais ce domaine : tout est intercepté)
export function buildDist(dir = path.join(ROOT, 'dist')) {
  execFileSync('node', [path.join(ROOT, 'tools/cloud/pages-build.mjs')], { cwd: ROOT, stdio: 'pipe', env: { ...process.env, DIST_DIR: dir, SUPABASE_URL: FAKE_URL, SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_mockmockmockmockmockmock', VAPID_PUBLIC_KEY: 'BMockMockMockMockMockMock' } });
}
export function serveDist(port = 8788, dir = path.join(ROOT, 'dist')) {
  const DIST = path.resolve(dir);
  const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.wasm': 'application/wasm' };
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    const f = path.join(DIST, path.normalize(p));
    if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((ok) => srv.listen(port, '127.0.0.1', () => ok({ url: `http://localhost:${port}`, close: () => srv.close() })));
}

export function makeSession() {
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: UID, aal: 'aal2', role: 'authenticated', email: 'test@cockpit.test', exp: Math.floor(Date.now() / 1000) + 36000, amr: [{ method: 'totp' }] })}.sig`;
  return { access_token: jwt, refresh_token: 'r', expires_in: 36000, expires_at: Math.floor(Date.now() / 1000) + 36000, token_type: 'bearer',
    user: { id: UID, email: 'test@cockpit.test', aud: 'authenticated', factors: [{ id: 'f1', factor_type: 'totp', status: 'verified', friendly_name: 'Test', created_at: new Date().toISOString() }], app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } };
}

const round2 = (v) => Math.round(v * 100) / 100;
const pad = (n) => String(n).padStart(2, '0');
let newSeq = 100000;

// Règles serveur minimales (suffisantes pour exercer l'interface)
function normalize(db, table, r, fx) {
  if (table === 'tx') {
    r.devise = ['EUR', 'MAD', 'USD', 'GBP', 'CHF'].includes(r.devise) ? r.devise : 'EUR';
    if (r.activite === 'Freelance') r.activite = 'Entreprise';
    const rate = r.devise === 'EUR' ? 1 : (r.taux > 0 && r.taux !== 1 ? r.taux : fx[r.devise] || 1);
    r.taux = rate; r.montant = round2(Number(r.montant)); r.montant_eur = round2(r.montant * rate);
    r.periode = r.periode || r.date.slice(0, 7);
    if (!r.nature) r.nature = (db.categories.find((c) => c.activite === r.activite && c.sens === r.sens && c.categorie === r.categorie) || {}).nature || 'Courant';
    for (const k of ['detail', 'libelle', 'tiers', 'lot', 'ref', 'note']) r[k] = r[k] ?? '';
  } else if (table === 'invoices') {
    if (!r.ht) r.ht = round2((r.jours || 0) * (r.tjm || 0));
    r.ttc = round2(r.ht * (1 + (r.tva || 0)));
    if (!r.numero) {
      const yr = (r.emission || r.periode).slice(0, 4);
      const n = Math.max(0, ...db.invoices.filter((i) => !i.deleted_at && i.numero.startsWith(`F-${yr}-`) && (i.projet_id || null) === (r.projet_id || null)).map((i) => +i.numero.slice(-3))) + 1;
      r.numero = `F-${yr}-${String(n).padStart(3, '0')}`;
    }
  } else if (table === 'lots' && !String(r.code || '').trim()) {
    const used = db.lots.filter((l) => !l.deleted_at && (l.projet_id || null) === (r.projet_id || null) && /^\d+$/.test(l.code)).map((l) => +l.code);
    r.code = pad(Math.max(-1, ...used) + 1);
  } else if (table === 'snapshots') {
    r.solde_eur = round2(r.solde * (r.devise === 'EUR' ? 1 : fx[r.devise] || 1));
  }
}

export async function installMockApi(ctx, db, { onRpc } = {}) {
  const fx = { MAD: 0.0913, USD: 0.92, GBP: 1.15, CHF: 1.06 };
  const log = [];
  await ctx.route(`${FAKE_URL}/**`, async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };
    const json = (b, s = 200, extra = {}) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b), headers: { ...cors, 'content-range': '0-*/*', ...extra } });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 200, headers: cors });
    const session = makeSession();
    if (u.pathname.startsWith('/auth/v1/user')) return json(session.user);
    if (u.pathname.startsWith('/auth/v1/')) return json({});
    if (u.pathname === '/functions/v1/bourse') {
      const body = JSON.parse(req.postData() || '{}');
      if (body.action === 'quotes') return json({ quotes: MOCK_QUOTES.filter((q) => (body.symbols || []).includes(q.symbole)) });
      if (body.action === 'search') return json({ results: [{ symbole: 'CW8.PA', nom: 'Amundi MSCI World', place: 'Paris', type: 'ETF', secteur: '' }, { symbole: 'MSFT', nom: 'Microsoft Corporation', place: 'NASDAQ', type: 'Action', secteur: 'Technologie' }] });
      return json({ ok: true });
    }
    if (u.pathname.startsWith('/functions/')) return json({ ok: true, sent: 0 });
    if (u.pathname.startsWith('/rest/v1/rpc/')) {
      const name = u.pathname.split('/').pop();
      const body = JSON.parse(req.postData() || '{}');
      log.push({ rpc: name, body });
      if (onRpc) { const r = await onRpc(name, body, db); if (r !== undefined) return json(r); }
      if (name === 'apply_ops') {
        const now = new Date().toISOString();
        for (const o of body.p_ops) {
          if (o.e === 'action') continue;
          if (o.e === 'param') { const cur = db.params.find((p) => p.cle === o.item.cle); if (cur) Object.assign(cur, { valeur: o.item.valeur, updated_at: now, version: cur.version + 1 }); else db.params.push({ id: crypto.randomUUID(), user_id: UID, seq: newSeq++, version: 1, created_at: now, updated_at: now, deleted_at: null, ...o.item }); continue; }
          if (o.e === 'category') continue;
          const def = BY_ENTITY[o.e]; if (!def) continue;
          const table = db[def.key];
          if (o.op === 'delete') { const r = table.find((x) => x.id === o.id); if (r) { r.deleted_at = now; r.updated_at = now; r.version++; } continue; }
          const item = { ...o.item }; const ins = item._insert; delete item._insert;
          let cur = item.id && table.find((x) => x.id === item.id);
          if (cur && ins) continue;
          if (!cur) { cur = { id: item.id || crypto.randomUUID(), user_id: UID, seq: newSeq++, legacy_id: null, version: 0, created_at: now, deleted_at: null }; table.push(cur); }
          delete item.version;
          Object.assign(cur, item); normalize(db, def.key, cur, fx);
          cur.updated_at = now; cur.version = (cur.version || 0) + 1;
        }
        return json({ ok: true, ids: [] });
      }
      return json({ ok: true });
    }
    const table = u.pathname.replace('/rest/v1/', '');
    if (table === 'fx_rates') return json([{ pair: 'MAD/EUR', rate: fx.MAD, date: new Date().toISOString().slice(0, 10), source: 'test' }, { pair: 'USD/EUR', rate: fx.USD, date: new Date().toISOString().slice(0, 10), source: 'test' }, { pair: 'GBP/EUR', rate: fx.GBP, date: new Date().toISOString().slice(0, 10), source: 'test' }, { pair: 'CHF/EUR', rate: fx.CHF, date: new Date().toISOString().slice(0, 10), source: 'test' }]);
    if (table === 'bareme_fiscal') return json(db.bareme_fiscal || []);
    if (['projet_membres', 'cours_hist', 'restore_points', 'change_log', 'push_subscriptions'].includes(table)) return json([]);
    if (table === 'cours') return json(MOCK_QUOTES.map((q) => ({ ...q, maj: new Date().toISOString() })));
    const rows = db[table];
    if (!rows) return json([]);
    const off = Number(u.searchParams.get('offset') || 0);
    const range = req.headers()['range'];
    if (off > 0 || (range && !range.startsWith('0-'))) return json([]);
    let out = rows;
    for (const [k, v] of u.searchParams) {
      if (k === 'updated_at' && v.startsWith('gt.')) out = out.filter((r) => r.updated_at > v.slice(3));
      else if (k === 'deleted_at' && v === 'is.null') out = out.filter((r) => !r.deleted_at);
      else if (['id', 'projet_id', 'symbole', 'compte', 'pair'].includes(k) && v.startsWith('eq.')) out = out.filter((r) => String(r[k]) === v.slice(3));
    }
    return json(out);
  });
  return { log, fx };
}

export const sessionInit = (s, prefs = {}) => { localStorage.setItem('cockpit-auth', JSON.stringify(s)); localStorage.setItem('cockpit.prefs.v1', JSON.stringify(prefs)); };
