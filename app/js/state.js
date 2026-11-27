// État de l'application + moteur de synchronisation avec la base centrale (Supabase).
// - lecture : copie locale (IndexedDB) affichée tout de suite, puis synchro différentielle (updated_at)
// - écriture : lot d'opérations envoyé à apply_ops() ; hors ligne -> file d'attente persistée
// - conflits : fusion automatique si les champs modifiés diffèrent, sinon choix de l'utilisateur
// - temps réel : chaque modification faite ailleurs déclenche une synchro
import { toast, confirmBox } from './ui.js';
import { addMonths, debounce } from './util.js';
import { sb, deviceLabel } from './supa.js';
import { TABLES, BY_KEY, BY_ENTITY, fromDb, toDb } from './schema.js';
import { buildIndex } from './core.js';
import { idbGet, idbSet, idbClear } from './idb.js';
import { setDisplayCurrency, CUR_CODES } from './util.js';

export const S = {
  data: null, today: '', file: 'Base Cockpit (cloud)', dir: '',
  period: { from: '', to: '' }, activity: 'Tout', immoView: 'mine', theme: 'auto', lastActivity: 'Perso',
  P: {}, catMap: {}, lots: [], fx: {},   // fx : 1 devise = x EUR (USD, GBP, CHF ; le MAD vient du paramètre)
  route: 'dashboard', args: {},
  sync: { online: navigator.onLine, pending: 0, lastSync: null, syncing: false, error: '' },
  user: null,
  memberships: [],   // projets partagés : où je suis invité (lecteur) et mes invités
};
// Taux « 1 devise = x EUR » (sans date : taux courant)
export const rateToEur = (cur) => (!cur || cur === 'EUR' ? 1 : cur === 'MAD' ? (S.P.taux || 0.093) : S.fx[cur] || 1);
const listeners = new Set();
export const subscribe = (f) => { listeners.add(f); return () => listeners.delete(f); };
export const emit = () => listeners.forEach((f) => f());

// ---------- préférences (propres à l'appareil) ----------
const KEY = 'cockpit.prefs.v1';
export function loadPrefs() {
  try { Object.assign(S, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* ignore */ }
}
export function savePrefs() {
  localStorage.setItem(KEY, JSON.stringify({ period: S.period, activity: S.activity, immoView: S.immoView, theme: S.theme, lastActivity: S.lastActivity, immoProjet: S.immoProjet || '', chartGran: S.chartGran || 'auto', chartType: S.chartType || 'bar', collapsed: S.collapsed || {}, colOrder: S.colOrder || {}, lang: S.lang || 'fr', displayCur: S.displayCur || 'EUR' }));
}

// ---------- stockage local ----------
const rows = Object.fromEntries(TABLES.map((t) => [t.key, new Map()]));   // id -> ligne (format interface)
let outbox = [];          // lots en attente : { id, ops, at }
let watermark = null;     // updated_at le plus récent reçu du serveur
let sharedKnown = [];     // projets partagés avec moi déjà chargés
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

function rebuild() {
  const d = {};
  for (const t of TABLES) d[t.key] = [...rows[t.key].values()];
  // Projet supprimé (ou partage retiré) : ses opérations, récurrences, lots et locataires sortent de TOUS les calculs
  // et listes. Rien n'est effacé : si le projet est restauré, tout réapparaît.
  const live = new Set(d.projets.map((p) => p.id));
  for (const k of ['tx', 'recurring', 'lots', 'tenants']) if (d[k]) d[k] = d[k].filter((r) => !r.projetId || live.has(r.projetId));
  S.data = d;
  S.today = today();
  Object.assign(S, buildIndex(d));
  setDisplayCurrency(S.displayCur || 'EUR', 1 / rateToEur(S.displayCur || 'EUR'));
  S.sync.pending = outbox.length;
}
const persist = debounce(() => {
  const dump = {}; for (const t of TABLES) dump[t.key] = [...rows[t.key].values()];
  idbSet('data', { rows: dump, watermark, user: S.user && S.user.id, memberships: S.memberships, sharedKnown }).catch(() => {});
}, 400);
const persistOutbox = () => idbSet('outbox', outbox).catch(() => {});

export async function loadCache(userId) {
  const c = await idbGet('data').catch(() => null);
  outbox = (await idbGet('outbox').catch(() => null)) || [];
  if (!c || (userId && c.user && c.user !== userId)) return false;
  for (const t of TABLES) { rows[t.key].clear(); for (const r of c.rows[t.key] || []) rows[t.key].set(r.id, r); }
  watermark = c.watermark;
  S.memberships = c.memberships || [];
  sharedKnown = c.sharedKnown || [];
  for (const b of outbox) applyLocal(b);
  rebuild();
  return true;
}
export async function wipeLocal() {
  for (const t of TABLES) rows[t.key].clear();
  outbox = []; watermark = null; sharedKnown = []; S.memberships = [];
  await idbClear().catch(() => {});
}

// ---------- synchro descendante ----------
async function fetchTable(def, since) {
  const out = [], size = 1000;
  for (let from = 0; ; from += size) {
    let q = sb.from(def.key).select('*').order('seq').range(from, from + size - 1);
    q = since ? q.gt('updated_at', since) : q.is('deleted_at', null);
    const { data, error } = await q;
    if (error) throw error;
    out.push(...data);
    if (data.length < size) break;
  }
  return out;
}
// Projets partagés : charge entièrement un projet nouvellement accessible, oublie ceux dont l'accès a été retiré
const SHARED_TABLES = ['projets', 'lots', 'tenants', 'tx', 'recurring'];
async function syncShared() {
  const { data, error } = await sb.from('projet_membres').select('id,projet_id,owner_id,owner_email,user_id,label,role,part,status,expires_at,created_at,accepted_at');
  if (error) throw error;
  S.memberships = data;
  const me = S.user && S.user.id;
  const access = new Set(data.filter((m) => m.user_id === me && m.status === 'actif').map((m) => m.projet_id));
  for (const pid of access) {
    if (sharedKnown.includes(pid)) continue;
    for (const key of SHARED_TABLES) {
      const def = BY_KEY[key];
      for (let from = 0; ; from += 1000) {
        const col = key === 'projets' ? 'id' : 'projet_id';
        const { data: rws, error: e2 } = await sb.from(key).select('*').eq(col, pid).is('deleted_at', null).order('seq').range(from, from + 999);
        if (e2) throw e2;
        for (const r of rws) rows[key].set(r.id, fromDb(def, r));
        if (rws.length < 1000) break;
      }
    }
  }
  // accès retiré : retirer de la copie locale les lignes des projets qui ne me sont plus partagés
  for (const key of SHARED_TABLES) {
    for (const [id, r] of rows[key]) {
      const pid = key === 'projets' ? r.id : r.projetId;
      if (r.uid && me && r.uid !== me && !access.has(pid)) rows[key].delete(id);
    }
  }
  sharedKnown = [...access];
}

let pulling = null, pullAgain = false;
export function pull() {
  if (pulling) { pullAgain = true; return pulling; }
  pulling = (async () => {
    S.sync.syncing = true;
    try {
      do {
        pullAgain = false;
        const since = watermark ? new Date(new Date(watermark).getTime() - 10000).toISOString() : null;
        const res = await Promise.all(TABLES.map((def) => fetchTable(def, since)));
        if (!since) for (const t of TABLES) rows[t.key].clear();
        let wm = watermark;
        res.forEach((list, i) => {
          const def = TABLES[i], m = rows[def.key];
          for (const r of list) {
            if (!wm || r.updated_at > wm) wm = r.updated_at;
            if (r.deleted_at) m.delete(r.id); else m.set(r.id, fromDb(def, r));
          }
        });
        watermark = wm;
        await syncShared();
        for (const b of outbox) applyLocal(b);      // les saisies pas encore envoyées restent visibles
        S.sync.lastSync = new Date().toISOString();
        S.sync.error = '';
        rebuild(); persist();
      } while (pullAgain);
    } catch (e) {
      S.sync.error = errText(e);
      throw e;
    } finally {
      S.sync.syncing = false; pulling = null;
    }
  })();
  return pulling;
}

// ---------- écriture ----------
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16); }));
export const upsert = (e, item) => ({ e, op: 'upsert', item });
export const del = (e, id) => ({ e, op: 'delete', id });
export const action = (key, item) => ({ e: 'action', key, item });
export const setParam = (cle, valeur) => ({ e: 'param', item: { cle, valeur: String(valeur), libelle: (S.data.params.find((p) => p.cle === cle) || {}).libelle || '' } });

// Prépare un lot : identifiants créés sur l'appareil, version lue, ligne de base (pour fusionner un conflit)
function prepare(list) {
  return list.map((o) => {
    const def = BY_ENTITY[o.e];
    if (o.e === 'action') return { e: 'action', key: o.key, item: o.item || {} };
    if (o.e === 'param' || o.e === 'category') return { e: o.e, op: o.op || 'upsert', item: { ...o.item } };
    if (!def) throw new Error('opération inconnue : ' + o.e);
    if (o.op === 'delete') {
      const cur = rows[def.key].get(o.id);
      return { e: o.e, op: 'delete', id: o.id, version: cur && !cur._pending ? cur.version : undefined, label: cur && labelOf(def, cur) };
    }
    const src = o.item || {};
    const cur = src.id ? rows[def.key].get(src.id) : null;
    const item = toDb(def, src);
    let base = null;
    if (!src.id || !cur) { item.id = src.id || uuid(); item._insert = true; delete item.version; }
    else if (cur._pending) delete item.version;
    else {
      // version = celle de la ligne telle qu'elle était quand l'écran l'a ouverte (pas celle reçue entre-temps)
      item.version = src.version || cur.version;
      base = src._base ? toDb(def, src._base) : item.version === cur.version ? toDb(def, cur) : null;
    }
    return { e: o.e, op: 'upsert', item, base, label: labelOf(def, cur || src) };
  });
}
const labelOf = (def, r) => (r ? r.libelle || r.nom || r.numero || r.titre || r.compte || r.categorie || '' : '');
const wire = (op) => { const { base, label, ...rest } = op; return rest; };

function errText(e) {
  if (!e) return '';
  const m = e.message || String(e);
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(m)) return 'pas de connexion';
  return m;
}
function classify(error) {
  if (!error) return 'ok';
  const code = error.code || '';
  if (code === 'CK409') return 'conflict';
  if (code === '23505') return 'duplicate';
  if (code === 'CK422' || code === '23514' || code === '22P02' || code === '22007' || code === '22008') return 'invalid';
  if (code === 'CK401' || code === 'PGRST301' || code === 'PGRST303' || error.status === 401) return 'auth';
  if (!code || /Failed to fetch|NetworkError|Load failed|fetch/i.test(error.message || '')) return 'network';
  return 'invalid';
}

async function send(batch) {
  const { error } = await sb.rpc('apply_ops', { p_ops: batch.ops.map(wire), p_device: deviceLabel() });
  return error;
}

// Envoie un lot en gérant conflits / doublons. Renvoie 'ok' | 'dropped' | 'invalid' | 'network' | 'auth'
async function sendResolving(batch, { quiet = false } = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    let error;
    try { error = await send(batch); } catch (e) { error = { message: e.message }; }
    const kind = classify(error);
    if (kind === 'ok') return 'ok';
    if (kind === 'network') return 'network';
    if (kind === 'auth') {
      const { error: re } = await sb.auth.refreshSession();
      if (!re && attempt === 0) continue;
      window.dispatchEvent(new CustomEvent('cockpit:auth-required'));
      return 'auth';
    }
    if (kind === 'duplicate') { toast('Déjà enregistré depuis un autre appareil : doublon évité.', 'error'); return 'dropped'; }
    if (kind === 'invalid') { if (!quiet) toast(cap(error.message || 'Opération refusée'), 'error'); return 'invalid'; }
    // conflit
    if (!(await resolveConflict(batch, error))) return 'dropped';
  }
  toast('Synchronisation impossible après plusieurs essais.', 'error');
  return 'dropped';
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

async function resolveConflict(batch, error) {
  let det;
  try { det = JSON.parse(error.details); } catch { return false; }
  const server = det.row, def = BY_KEY[det.table];
  const op = batch.ops.find((o) => (o.item && o.item.id === server.id) || o.id === server.id);
  if (!op || !def) return false;
  const label = op.label ? `« ${op.label} »` : 'Cette ligne';
  if (server.deleted_at) {
    toast(`${label} a été supprimée sur un autre appareil : ta modification n'a pas été appliquée (récupérable dans Paramètres › Historique).`, 'error');
    return false;
  }
  if (op.op === 'delete') {
    if (!(await confirmBox(`${label} vient d'être modifiée sur un autre appareil. La supprimer quand même ?`, { ok: 'Supprimer', danger: true, title: 'Conflit' }))) return false;
    op.version = server.version;
    return true;
  }
  const base = op.base || Object.fromEntries(Object.keys(op.item).map((k) => [k, Symbol.for('inconnu')]));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const norm = (k, v) => (typeof v === 'symbol' ? '\u0000inconnu' : v == null ? '' : typeof v === 'number' ? v : /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : v);
  const mine = Object.keys(op.item).filter((k) => !['id', 'version', '_insert'].includes(k) && !same(norm(k, op.item[k]), norm(k, base[k])));
  const overlap = mine.filter((k) => !same(norm(k, server[k]), norm(k, base[k])) && !same(norm(k, server[k]), norm(k, op.item[k])));
  if (overlap.length) {
    const names = overlap.map((k) => (def.cols.find((c) => (c.db || c.k) === k) || {}).x || k).join(', ');
    const keep = await confirmBox(`${label} a aussi été modifiée sur un autre appareil (${names}). Garder ta version pour ces champs ?`, { ok: 'Garder ma version', title: 'Conflit de modification' });
    if (!keep) { toast('Version de l’autre appareil conservée.'); return false; }
  }
  const merged = { id: server.id, version: server.version };
  for (const k of mine) merged[k] = op.item[k];
  op.item = merged;
  op.base = server;
  return true;
}

// Application locale optimiste (hors ligne) : approximation des règles serveur pour l'affichage
function applyLocal(batch) {
  for (const o of batch.ops) {
    if (o.e === 'action') continue;
    if (o.e === 'param') {
      const m = rows.params; const cur = [...m.values()].find((p) => p.cle === o.item.cle);
      if (cur) m.set(cur.id, { ...cur, valeur: o.item.valeur, _pending: true });
      else { const id = 'local-' + o.item.cle; m.set(id, { id, cle: o.item.cle, valeur: o.item.valeur, libelle: o.item.libelle || '', _pending: true }); }
      continue;
    }
    if (o.e === 'category') {
      const m = rows.categories; const cur = [...m.values()].find((c) => c.activite === o.item.activite && c.sens === o.item.sens && c.categorie === o.item.categorie);
      if (o.op === 'delete') { if (cur) m.delete(cur.id); } else m.set(cur ? cur.id : 'local-' + uuid(), { groupe: 'Autres', nature: 'Courant', icone: '•', ...cur, ...o.item, _pending: true });
      continue;
    }
    const def = BY_ENTITY[o.e], m = rows[def.key];
    if (o.op === 'delete') { m.delete(o.id); continue; }
    const cur = m.get(o.item.id);
    const r = fromDb(def, { ...(cur ? toDb(def, cur) : {}), ...o.item, seq: cur ? cur.seq : 1e12, version: cur ? cur.version : 0 });
    r._pending = true;
    if (def.key === 'tx') {
      r.devise = CUR_CODES.includes(r.devise) ? r.devise : 'EUR';
      r.taux = r.devise === 'EUR' ? 1 : (r.taux > 0 && r.taux !== 1 ? r.taux : rateToEur(r.devise));
      r.montantEur = Math.round(r.montant * r.taux * 100) / 100;
      r.periode = r.periode || r.date.slice(0, 7);
      if (!r.nature) r.nature = (S.catMap[`${r.activite}|${r.sens}|${r.categorie}`] || {}).nature || 'Courant';
    } else if (def.key === 'invoices') {
      if (!r.ht) r.ht = Math.round(r.jours * r.tjm * 100) / 100;
      r.ttc = Math.round(r.ht * (1 + r.tva) * 100) / 100;
      if (!r.numero) r.numero = '(en attente)';
    } else if (def.key === 'snapshots') {
      r.soldeEur = Math.round(r.solde * rateToEur(r.devise) * 100) / 100;
    }
    m.set(r.id, r);
  }
}

// Point d'entrée des écrans : applique un lot d'opérations.
export async function ops(list, okMsg) {
  let batch;
  try { batch = { id: uuid(), at: new Date().toISOString(), ops: prepare(list) }; } catch (e) { toast(e.message, 'error'); return false; }
  if (navigator.onLine && !outbox.length) {
    const r = await sendResolving(batch);
    if (r === 'ok') {
      try { await pull(); } catch { /* la synchro suivante rattrapera */ }
      emit();
      if (okMsg) toast(okMsg);
      return true;
    }
    if (r === 'dropped' || r === 'invalid') { try { await pull(); } catch { /* ignore */ } emit(); return false; }
  }
  if (batch.ops.some((o) => o.e === 'action')) toast('Hors ligne : cette action sera exécutée dès le retour du réseau.');
  outbox.push(batch); persistOutbox(); applyLocal(batch); rebuild(); persist(); emit();
  toast(`${okMsg ? okMsg + ' — ' : ''}enregistré sur cet appareil, envoi dès le retour du réseau`);
  return true;
}

// Envoie la file d'attente (au retour du réseau, au réveil de l'app…)
let flushing = null;
export function flush() {
  if (flushing) return flushing;
  flushing = (async () => {
    try {
      while (outbox.length && navigator.onLine) {
        const r = await sendResolving(outbox[0], { quiet: true });
        if (r === 'network' || r === 'auth') break;
        if (r === 'invalid') toast('Une saisie faite hors ligne a été refusée par le serveur (voir Paramètres › Historique).', 'error');
        outbox.shift(); persistOutbox();
      }
      if (navigator.onLine) await pull();
    } catch { /* hors ligne */ } finally {
      S.sync.pending = outbox.length; flushing = null; emit();
    }
  })();
  return flushing;
}
export const pendingCount = () => outbox.length;

// ---------- temps réel + réveils ----------
let channel;
export async function startSync() {
  // le canal temps réel doit porter le jeton de niveau MFA (aal2), sinon la RLS bloque les événements
  const { data: { session } } = await sb.auth.getSession();
  if (session) await sb.realtime.setAuth(session.access_token);
  sb.auth.onAuthStateChange((_e, s) => { if (s) sb.realtime.setAuth(s.access_token); });
  const kick = debounce(() => { if (!outbox.length) pull().then(emit).catch(() => {}); else flush(); }, 500);
  channel = sb.channel('cockpit-db');
  for (const t of TABLES) channel.on('postgres_changes', { event: '*', schema: 'public', table: t.key }, kick);
  channel.on('postgres_changes', { event: '*', schema: 'public', table: 'projet_membres' }, kick);
  channel.subscribe((status, err) => {
    S.sync.realtime = status;
    if (status === 'SUBSCRIBED') {
      // le serveur ignore les premiers événements quelques secondes après l'abonnement : rattrapage
      setTimeout(kick, 4000); setTimeout(kick, 10000);
    } else console.warn('temps réel :', status, err ? err.message : '');
  });
  window.addEventListener('online', () => { S.sync.online = true; emit(); flush(); });
  window.addEventListener('offline', () => { S.sync.online = false; emit(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { S.today = today(); flush(); } });
  setInterval(() => { if (document.visibilityState === 'visible' && navigator.onLine) flush(); }, 30000);
}
export async function stopSync() { if (channel) await sb.removeChannel(channel).catch(() => {}); }

// ---------- chargement initial ----------
// Taux de change du jour (USD, GBP, CHF) : table commune fx_rates
export async function loadFx() {
  try {
    const { data } = await sb.from('fx_rates').select('pair,rate,date').in('pair', ['USD/EUR', 'GBP/EUR', 'CHF/EUR']).order('date', { ascending: false }).limit(60);
    for (const r of data || []) { const c = r.pair.split('/')[0]; if (!S.fx[c]) S.fx[c] = Number(r.rate); }
    rebuild();
  } catch { /* hors ligne : la copie locale garde les derniers taux */ }
}
export async function load(userId) {
  const cached = await loadCache(userId);
  if (cached) {
    if (navigator.onLine) flush();       // en arrière-plan
  } else {
    await pull();
    await flush();
  }
  loadFx();
  if (!S.period.from) {
    const cur = S.today.slice(0, 7);
    S.period = { from: cur.slice(0, 4) + '-01', to: cur };
  }
}
export async function reload() { await flush(); emit(); }

export function setPeriod(from, to) {
  if (from > to) [from, to] = [to, from];
  S.period = { from, to }; savePrefs(); emit();
}
export function setActivity(a) { S.activity = a; savePrefs(); emit(); }

export const catsFor = (act, sens) => S.data.categories.filter((c) => c.activite === act && c.sens === sens);
export const todayMonth = () => S.today.slice(0, 7);
export const prevMonthOfToday = () => addMonths(todayMonth(), -1);
// Compatibilité : anciens écrans qui appelaient post('/api/...')
export async function post(path) { throw new Error('Action indisponible dans la version cloud : ' + path); }

// ---------- Projets ----------
export const isMine = (r) => !r || !r.uid || !S.user || r.uid === S.user.id;
// Un « projet » est soit un immeuble (type Immobilier), soit une entreprise (type Entreprise)
export const isImmo = (p) => !p || (p.type || 'Immobilier') === 'Immobilier';
export const immoProjets = () => (S.data.projets || []).filter(isImmo);
export const entreprises = () => [...(S.data.projets || [])].filter((p) => p.type === 'Entreprise').sort((a, b) => (a.seq || 0) - (b.seq || 0));
export const projetsVisibles = () => immoProjets().sort((a, b) => (isMine(b) - isMine(a)) || a.nom.localeCompare(b.nom));
export function membershipOf(projetId) {
  return S.memberships.find((m) => m.projet_id === projetId && m.user_id === (S.user && S.user.id) && m.status === 'actif');
}
// Ma part d'un projet : la part du propriétaire si c'est le mien, sinon celle fixée dans mon invitation
// (plus de part globale : une opération sans projet prend la part de mon unique projet s'il n'y en a qu'un, sinon 100 %)
export function partOf(projetId) {
  const p = projetId && (S.data.projets || []).find((x) => x.id === projetId);   // immeuble ou entreprise : « ma part » du projet
  if (!projetId || !p) {
    const own = immoProjets().filter(isMine);
    return own.length === 1 ? Number(own[0].part) : 1;
  }
  if (isMine(p)) return Number(p.part);
  const m = membershipOf(projetId);
  return m ? Number(m.part) : Number(p.part);
}
// Libellé du bouton « Ma part » : la part du projet affiché, ou rien quand plusieurs projets ont des parts différentes
export function partLabel(projetId) {
  if (projetId) return `Ma part (${Math.round(partOf(projetId) * 100)} %)`;
  const parts = [...new Set(projetsVisibles().map((p) => Math.round(partOf(p.id) * 100)))];
  return parts.length === 1 ? `Ma part (${parts[0]} %)` : 'Ma part';
}
export const projetOfLot = (lotNom) => { const l = S.data.lots.find((x) => x.nom === lotNom && isMine(x)) || S.data.lots.find((x) => x.nom === lotNom); return l ? l.projetId : ''; };
