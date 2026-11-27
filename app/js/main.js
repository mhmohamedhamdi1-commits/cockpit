import { h, icon, clear, monthLabel, monthLong, addMonths, monthNames, monthShort, CURRENCIES } from './util.js';
import { S, load, loadPrefs, savePrefs, subscribe, emit, reload, setPeriod, setActivity, startSync, flush, wipeLocal, stopSync, partLabel, immoProjets } from './state.js';
import { segmented, popover, toast, modal } from './ui.js';
import { ensureAuth, watchRecovery, logout } from './auth.js';
import { sb } from './supa.js';
import { computeAlerts } from './core.js';
import { exportExcel } from './data.js';
import { enhance, closeMax } from './enhance.js';
import { setLang, LANGS } from './i18n.js';
import { openTxForm } from './txform.js';
import * as dashboard from './views/dashboard.js';
import * as opsView from './views/ops.js';
import * as entreprise from './views/entreprise.js';
import * as immo from './views/immo.js';
import * as wealth from './views/wealth.js';
import * as recurring from './views/recurring.js';
import * as settings from './views/settings.js';
import * as bourse from './views/bourse.js';
import * as imports from './views/imports.js';
import * as impot from './views/impot.js';

const ROUTES = {
  dashboard: { label: 'Tableau de bord', ic: 'dash', v: dashboard },
  ops: { label: 'Opérations', ic: 'list', v: opsView },
  imports: { label: 'À valider', ic: 'inbox', v: imports },
  entreprise: { label: 'Entreprise', ic: 'brief', v: entreprise },
  immo: { label: 'Immobilier', ic: 'building', v: immo },
  wealth: { label: 'Patrimoine', ic: 'bank', v: wealth },
  bourse: { label: 'Bourse', ic: 'trend', v: bourse },
  impot: { label: 'Impôt', ic: 'percent', v: impot },
  recurring: { label: 'Automatismes', ic: 'repeat', v: recurring },
  settings: { label: 'Paramètres', ic: 'sliders', v: settings },
};

// ---------- thème ----------
const mq = window.matchMedia('(prefers-color-scheme: dark)');
export function applyTheme() {
  const t = S.theme === 'auto' ? (mq.matches ? 'dark' : 'light') : S.theme;
  document.documentElement.dataset.theme = t;
}
mq.addEventListener('change', applyTheme);

// ---------- période ----------
function periodText() {
  const { from, to } = S.period;
  if (from === to) return monthLong(from);
  if (from.slice(0, 4) === to.slice(0, 4)) return `${monthLabel(from).split(' ')[0]} → ${monthLabel(to)}`;
  return `${monthLabel(from)} → ${monthLabel(to)}`;
}
function presets() {
  const cur = S.today.slice(0, 7), y = +cur.slice(0, 4);
  const first = S.data.tx.reduce((m, t) => (t.date < m ? t.date : m), S.today).slice(0, 7);
  return [
    ['Ce mois-ci', cur, cur], ['Mois dernier', addMonths(cur, -1), addMonths(cur, -1)],
    ['3 derniers mois', addMonths(cur, -2), cur], ['6 derniers mois', addMonths(cur, -5), cur],
    ['Depuis janvier ' + y, `${y}-01`, cur], ['12 derniers mois', addMonths(cur, -11), cur],
    ['Année ' + (y - 1), `${y - 1}-01`, `${y - 1}-12`], ['Tout l’historique', first, cur],
  ];
}
function openPeriod(anchor) {
  let yF = +S.period.from.slice(0, 4), yT = +S.period.to.slice(0, 4);
  const root = h('div', { class: 'period' });
  let pop;
  const mp = (title, which) => {
    const year = which === 'from' ? yF : yT, sel = S.period[which];
    const mths = monthNames.map((n, i) => {
      const k = `${year}-${String(i + 1).padStart(2, '0')}`;
      const inR = k > S.period.from && k < S.period.to;
      return h('button', { type: 'button', class: k === sel ? 'on' : inR ? 'in' : '', onClick: () => {
        let { from, to } = S.period;
        if (which === 'from') { from = k; if (to < from) to = k; } else { to = k; if (from > to) from = k; }
        setPeriod(from, to); yF = +from.slice(0, 4); yT = +to.slice(0, 4); draw();
      } }, monthShort(k));
    });
    const step = (d) => { if (which === 'from') yF += d; else yT += d; draw(); };
    return h('div', { class: 'mp' }, h('div', { class: 'ttl' }, title),
      h('div', { class: 'yr' }, h('button', { class: 'btn ghost icon sm', type: 'button', onClick: () => step(-1) }, icon('left', 16)), year, h('button', { class: 'btn ghost icon sm', type: 'button', onClick: () => step(1) }, icon('right', 16))),
      h('div', { class: 'ms' }, mths));
  };
  const draw = () => {
    clear(root);
    const pr = h('div', { class: 'presets' }, presets().map(([l, a, b]) =>
      h('button', { type: 'button', class: S.period.from === a && S.period.to === b ? 'on' : '', onClick: () => { setPeriod(a, b); pop.close(); } }, l)));
    root.append(pr, mp('De', 'from'), mp('À', 'to'));
  };
  draw();
  pop = popover(anchor, root);
}

// ---------- shell ----------
const app = document.getElementById('app');
let refs = {};

function buildShell() {
  clear(app);
  const nav = h('nav', { class: 'nav' });
  refs.nav = nav;
  const filebox = h('div', { class: 'filebox' });
  refs.filebox = filebox;
  const side = h('aside', { class: 'side' },
    h('div', { class: 'brand' }, h('div', { class: 'logo' }, icon('chart', 17)), 'Cockpit'),
    h('button', { class: 'btn primary', style: { margin: '0 4px 12px', justifyContent: 'center', padding: '10px 14px' }, type: 'button', onClick: () => openTxForm(), title: 'Raccourci : N' }, icon('plus', 17), 'Nouvelle opération', h('kbd', null, 'N')),
    nav, h('div', { class: 'spacer' }), filebox);
  refs.top = h('header', { class: 'top' });
  refs.scroll = h('div', { class: 'scroll' });
  refs.tabbar = h('nav', { class: 'tabbar' });
  app.append(h('div', { class: 'app' }, side, h('main', { class: 'main' }, refs.top, refs.scroll), refs.tabbar));
}

const TABS = ['dashboard', 'ops', '+', 'immo', 'more'];
function openMore() {
  const items = Object.entries(ROUTES).filter(([k]) => !['dashboard', 'ops', 'immo'].includes(k));
  const m = modal({ title: 'Menu', body: h('div', { class: 'morelist' }, items.map(([k, r]) => {
    const badge = r.v.badge ? r.v.badge() : 0;
    return h('a', { href: '#/' + k, class: S.route === k ? 'on' : '', onClick: () => m.close() }, icon(r.ic, 20), r.label, badge ? h('span', { class: 'count' }, badge) : null, icon('right', 16));
  }), h('button', { class: 'morelogout', type: 'button', onClick: () => { m.close(); logout(); } }, icon('user', 20), h('span', null, 'Se déconnecter', h('small', null, S.user ? S.user.email : ''))),
  h('div', { class: 'syncline' }, syncText())) });
}
function renderTabbar() {
  clear(refs.tabbar);
  for (const k of TABS) {
    if (k === '+') { refs.tabbar.append(h('button', { class: 'fab', type: 'button', 'aria-label': 'Nouvelle opération', onClick: () => openTxForm() }, icon('plus', 26))); continue; }
    if (k === 'more') {
      const inMore = !['dashboard', 'ops', 'immo'].includes(S.route);
      const n = Object.entries(ROUTES).filter(([x]) => !['dashboard', 'ops', 'immo'].includes(x)).reduce((a, [, r]) => a + (r.v.badge ? r.v.badge() : 0), 0);
      refs.tabbar.append(h('button', { type: 'button', class: inMore ? 'on' : '', onClick: openMore }, icon('more', 22), h('span', null, 'Plus'), n ? h('i', { class: 'dotn' }, n) : null));
      continue;
    }
    const r = ROUTES[k];
    const badge = r.v.badge ? r.v.badge() : 0;
    refs.tabbar.append(h('a', { href: '#/' + k, class: S.route === k ? 'on' : '' }, icon(r.ic, 22), h('span', null, k === 'dashboard' ? 'Accueil' : r.label), badge ? h('i', { class: 'dotn' }, badge) : null));
  }
}

function prefSelect(opts, value, onChange, title) {
  const s = h('select', { class: 'prefsel', title, 'aria-label': title }, opts.map((o) => h('option', { value: o.value, selected: o.value === value }, o.label)));
  s.addEventListener('change', () => onChange(s.value));
  return s;
}
function ago(iso) {
  if (!iso) return 'jamais';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'à l’instant';
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  return `il y a ${Math.round(s / 3600)} h`;
}
function syncText() {
  const y = S.sync;
  if (!y.online) return [h('span', { class: 'dot-off' }), `Hors ligne${y.pending ? ` · ${y.pending} en attente` : ''}`];
  if (y.pending) return [h('span', { class: 'dot-warn' }), `${y.pending} modification${y.pending > 1 ? 's' : ''} à envoyer…`];
  if (y.error) return [h('span', { class: 'dot-warn' }), `Synchro : ${y.error}`];
  return [h('span', { class: 'dot-ok' }), `Synchronisé ${ago(y.lastSync)}`];
}

function renderNav() {
  clear(refs.nav);
  for (const [k, r] of Object.entries(ROUTES)) {
    const badge = r.v.badge ? r.v.badge() : 0;
    refs.nav.append(h('a', { class: S.route === k ? 'on' : '', href: '#/' + k, tabindex: 0 }, icon(r.ic, 18), r.label, badge ? h('span', { class: 'count' }, badge) : null));
  }
  clear(refs.filebox);
  refs.filebox.append(h('div', null, syncText()), h('b', null, 'Base centrale (cloud)'),
    h('div', { class: 'row' },
      h('button', { class: 'btn sm', title: 'Synchroniser maintenant', onClick: () => flush().then(() => toast('Synchronisé')) }, icon('repeat', 15)),
      h('button', { class: 'btn sm', title: 'Exporter toutes les données dans un fichier Excel', onClick: () => exportExcel() }, icon('sheet', 15), 'Excel'),
      h('button', { class: 'btn sm', title: S.theme === 'dark' ? 'Mode clair' : 'Mode sombre', onClick: () => { S.theme = (document.documentElement.dataset.theme === 'dark') ? 'light' : 'dark'; savePrefs(); applyTheme(); renderNav(); } }, icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon', 15))),
    h('div', { class: 'prefrow' }, prefSelect(LANGS, S.lang || 'fr', (v) => { S.lang = v; savePrefs(); setLang(v); emit(); }, 'Langue'), prefSelect(CURRENCIES.map((c) => ({ value: c.code, label: c.sym === c.code ? c.code : `${c.sym} ${c.code}` })), S.displayCur || 'EUR', (v) => { S.displayCur = v; savePrefs(); reload(); }, 'Devise d’affichage')),
    h('div', { class: 'userbox' }, icon('user', 16), h('span', { title: S.user ? S.user.email : '' }, S.user ? S.user.email : ''), h('button', { class: 'btn sm', onClick: logout, title: 'Se déconnecter' }, 'Déconnexion')));
  renderTabbar();
}

function renderTop() {
  const r = ROUTES[S.route], meta = r.v.meta ? r.v.meta() : {};
  clear(refs.top);
  const title = h('h1', null, meta.title || r.label, meta.sub ? h('span', { class: 'sub' }, meta.sub) : null);
  refs.top.append(title);
  if (meta.immoToggle) {
    const pid = S.immoProjet && immoProjets().some((p) => p.id === S.immoProjet) ? S.immoProjet : '';
    refs.top.append(segmented([{ value: 'mine', label: partLabel(pid) }, { value: 'full', label: 'Total (100 %)' }], S.immoView, (v) => { S.immoView = v; savePrefs(); emit(); }));
  }
  if (meta.activity) {
    refs.top.append(segmented([{ value: 'Tout', label: 'Tout' }, { value: 'Perso', label: 'Perso', dot: 'bg-Perso' }, { value: 'Entreprise', label: 'Entreprise', dot: 'bg-Entreprise' }, { value: 'Immobilier', label: 'Immobilier', dot: 'bg-Immobilier' }], S.activity, setActivity));
  }
  if (meta.period !== false) {
    const b = h('button', { class: 'pillbtn', type: 'button', onClick: () => openPeriod(b) }, icon('calendar', 17), periodText(), icon('right', 14));
    refs.top.append(b);
  }
}

let renderToken = 0;
function renderView() {
  const st = refs.scroll.scrollTop;
  clear(refs.scroll);
  const r = ROUTES[S.route];
  try { refs.scroll.append(h('div', { class: 'page' }, r.v.render())); }
  catch (e) { console.error(e); refs.scroll.append(h('div', { class: 'card' }, h('b', null, 'Erreur d’affichage'), h('pre', { style: { whiteSpace: 'pre-wrap' } }, String(e.stack || e)))); }
  refs.scroll.scrollTop = st;
  enhance(refs.scroll);
}
function renderAll() { renderNav(); renderTop(); renderView(); document.title = `${ROUTES[S.route].label} — Cockpit`; updateBadge(); }

async function acceptInvitation(code) {
  history.replaceState(null, '', '#/immo');
  const { sb: client } = await import('./supa.js');
  const { data, error } = await client.rpc('accept_invitation', { p_code: code });
  if (error) { toast('Invitation : ' + error.message, 'error'); return; }
  const { pull } = await import('./state.js');
  await pull().catch(() => {});
  S.immoProjet = data.projet_id; savePrefs(); emit();
  toast(`Tu as maintenant accès au projet « ${data.projet} » (lecture seule)`);
}

function route() {
  closeMax();
  const [k0, qs0] = (location.hash || '#/dashboard').replace('#/', '').split('?');
  if (k0 === 'invitation') { const code = new URLSearchParams(qs0 || '').get('i'); if (code) { acceptInvitation(code); return; } }
  const [k, qs] = (location.hash || '#/dashboard').replace('#/', '').split('?');
  S.route = ROUTES[k] ? k : (k === 'freelance' ? 'entreprise' : 'dashboard');   // anciens liens (notifications) : Freelance -> Entreprise
  S.args = Object.fromEntries(new URLSearchParams(qs || ''));
  renderAll();
  refs.scroll.scrollTop = 0;
  const v = ROUTES[S.route].v;
  if (v.onArgs && qs) setTimeout(() => v.onArgs(S.args), 50);
}

function updateBadge() {
  try {
    const n = computeAlerts(S).filter((a) => a.kind === 'bad' || a.kind === 'warn').length;
    if (navigator.setAppBadge) (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
  } catch { /* ignore */ }
}

// ---------- démarrage ----------
let swReloading = false;
function registerSW() {
  if (!('serviceWorker' in navigator) || location.hostname === 'localhost' && !location.search.includes('sw')) return;
  const hadController = !!navigator.serviceWorker.controller;   // 1re visite : pas de rechargement
  navigator.serviceWorker.register('/sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || swReloading) return;
    swReloading = true;
    // nouvelle version : recharger seulement quand aucune saisie n'est en cours
    const tryReload = () => { if (document.querySelector('.app') && !document.querySelector('.overlay')) location.reload(); else setTimeout(tryReload, 5000); };
    tryReload();
  });
}

(async function init() {
  loadPrefs(); applyTheme(); setLang(S.lang || 'fr');
  registerSW();
  watchRecovery();
  app.append(h('div', { class: 'loading' }, 'Chargement…'));
  let user;
  try { user = await ensureAuth({ offlineOk: true }); }
  catch (e) { clear(app); app.append(h('div', { class: 'loading' }, 'Connexion impossible : ' + e.message)); return; }
  S.user = user;
  clear(app); app.append(h('div', { class: 'loading' }, 'Synchronisation des données…'));
  try { await load(user.id); }
  catch (e) { clear(app); app.append(h('div', { class: 'loading' }, h('div', null, 'Impossible de charger les données : ' + e.message, h('div', { style: { marginTop: '12px', textAlign: 'center' } }, h('button', { class: 'btn', onClick: () => location.reload() }, 'Réessayer'))))); return; }
  buildShell();
  subscribe(renderAll);
  // les tableaux redessinés à l'intérieur d'un écran (filtres…) sont aussi améliorés
  let enhT; new MutationObserver(() => { clearTimeout(enhT); enhT = setTimeout(() => enhance(refs.scroll), 30); }).observe(refs.scroll, { childList: true, subtree: true });
  window.addEventListener('hashchange', route);
  route();
  await startSync();
  setInterval(() => { if (document.visibilityState === 'visible') renderNav(); }, 30000);

  window.addEventListener('cockpit:auth-required', async () => {
    toast('Session expirée : reconnecte-toi.', 'error');
    await stopSync(); location.reload();
  });
  sb.auth.onAuthStateChange(async (event) => {
    if (event === 'SIGNED_OUT') { await wipeLocal(); location.replace('/'); }
  });
  // reprise du focus : synchroniser
  let lastFocus = Date.now();
  window.addEventListener('focus', async () => { if (Date.now() - lastFocus > 4000 && !document.querySelector('.overlay')) { try { await reload(); } catch { /* ignore */ } } lastFocus = Date.now(); });
  document.addEventListener('keydown', (e) => {
    const t = e.target, typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'n' && !document.querySelector('.overlay')) { e.preventDefault(); openTxForm(); }
  });
})();
