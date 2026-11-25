import { toast } from './ui.js';
import { addMonths } from './util.js';

export const S = {
  data: null, today: '', file: '', dir: '',
  period: { from: '', to: '' }, activity: 'Tout', immoView: 'mine', theme: 'auto', lastActivity: 'Perso',
  P: {}, catMap: {}, lots: [],
  route: 'dashboard',
};
const listeners = new Set();
export const subscribe = (f) => { listeners.add(f); return () => listeners.delete(f); };
export const emit = () => listeners.forEach((f) => f());

// ---------- préférences ----------
const KEY = 'cockpit.prefs.v1';
export function loadPrefs() {
  try { Object.assign(S, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* ignore */ }
}
export function savePrefs() {
  localStorage.setItem(KEY, JSON.stringify({ period: S.period, activity: S.activity, immoView: S.immoView, theme: S.theme, lastActivity: S.lastActivity }));
}

// ---------- API ----------
async function call(path, body) {
  const r = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { 'X-Token': window.__T, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = {};
  try { j = await r.json(); } catch { /* ignore */ }
  if (!r.ok || j.ok === false) throw new Error(j.error || `Erreur ${r.status}`);
  return j;
}
export const post = (path, body = {}) => call(path, body);

function index() {
  const d = S.data;
  const P = {}; for (const p of d.params) P[p.cle] = p.valeur;
  const n = (k, def) => { const v = parseFloat(String(P[k] ?? '').replace(',', '.')); return isFinite(v) ? v : def; };
  S.P = {
    taux: n('taux_mad_eur', 0.093), part: n('part_immo', 0.67), seuilMicro: n('seuil_micro', 83600),
    seuilTva: n('seuil_tva', 37500), seuilTvaMaj: n('seuil_tva_maj', 41250), cotis: n('taux_cotis', 0.256),
    cfp: n('taux_cfp', 0.002), provision: n('taux_provision', 0.4), nom: P.nom || '', microDebut: P.micro_debut || '2027-01-01',
  };
  S.catMap = {};
  for (const c of d.categories) S.catMap[`${c.activite}|${c.sens}|${c.categorie}`] = c;
  S.lots = [...d.lots].sort((a, b) => a.code.localeCompare(b.code));
}
function setData(r) {
  S.data = r.data; S.today = r.today; S.file = r.file; S.dir = r.dir;
  index();
}
export async function load() {
  setData(await call('/api/data'));
  if (!S.period.from) {
    const cur = S.today.slice(0, 7);
    S.period = { from: cur.slice(0, 4) + '-01', to: cur };
  }
}
export async function reload() { await load(); emit(); }
export async function ops(list, okMsg) {
  try {
    setData(await call('/api/ops', { ops: list }));
    emit();
    if (okMsg) toast(okMsg);
    return true;
  } catch (e) {
    toast(e.message, 'error');
    return false;
  }
}
export const upsert = (e, item) => ({ e, op: 'upsert', item });
export const del = (e, id) => ({ e, op: 'delete', id });
export const action = (key, item) => ({ e: 'action', key, item });
export const setParam = (cle, valeur) => ({ e: 'param', item: { cle, valeur: String(valeur), libelle: (S.data.params.find((p) => p.cle === cle) || {}).libelle || '' } });

export function setPeriod(from, to) {
  if (from > to) [from, to] = [to, from];
  S.period = { from, to }; savePrefs(); emit();
}
export function setActivity(a) { S.activity = a; savePrefs(); emit(); }

export const catsFor = (act, sens) => S.data.categories.filter((c) => c.activite === act && c.sens === sens);
export const todayMonth = () => S.today.slice(0, 7);
export const prevMonthOfToday = () => addMonths(todayMonth(), -1);
