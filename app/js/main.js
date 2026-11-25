import { h, icon, clear, monthLabel, monthLong, addMonths, monthNames, monthShort } from './util.js';
import { S, load, loadPrefs, savePrefs, subscribe, emit, reload, setPeriod, setActivity, post } from './state.js';
import { segmented, popover, toast } from './ui.js';
import { openTxForm } from './txform.js';
import * as dashboard from './views/dashboard.js';
import * as opsView from './views/ops.js';
import * as freelance from './views/freelance.js';
import * as immo from './views/immo.js';
import * as wealth from './views/wealth.js';
import * as recurring from './views/recurring.js';
import * as settings from './views/settings.js';

const ROUTES = {
  dashboard: { label: 'Tableau de bord', ic: 'dash', v: dashboard },
  ops: { label: 'Opérations', ic: 'list', v: opsView },
  freelance: { label: 'Freelance', ic: 'brief', v: freelance },
  immo: { label: 'Immobilier', ic: 'building', v: immo },
  wealth: { label: 'Patrimoine', ic: 'bank', v: wealth },
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
  app.append(h('div', { class: 'app' }, side, h('main', { class: 'main' }, refs.top, refs.scroll)));
}

function renderNav() {
  clear(refs.nav);
  for (const [k, r] of Object.entries(ROUTES)) {
    const badge = r.v.badge ? r.v.badge() : 0;
    refs.nav.append(h('a', { class: S.route === k ? 'on' : '', href: '#/' + k, tabindex: 0 }, icon(r.ic, 18), r.label, badge ? h('span', { class: 'count' }, badge) : null));
  }
  clear(refs.filebox);
  refs.filebox.append(h('div', null, h('span', { class: 'dot-ok' }), 'Données enregistrées'), h('b', null, S.file),
    h('div', { class: 'row' },
      h('button', { class: 'btn sm', title: 'Ouvrir le classeur dans Excel', onClick: () => post('/api/open-excel').catch((e) => toast(e.message, 'error')) }, icon('sheet', 15), 'Excel'),
      h('button', { class: 'btn sm', title: 'Ouvrir le dossier', onClick: () => post('/api/open-folder').catch((e) => toast(e.message, 'error')) }, icon('folder', 15)),
      h('button', { class: 'btn sm', title: S.theme === 'dark' ? 'Mode clair' : 'Mode sombre', onClick: () => { S.theme = (document.documentElement.dataset.theme === 'dark') ? 'light' : 'dark'; savePrefs(); applyTheme(); renderNav(); } }, icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon', 15))));
}

function renderTop() {
  const r = ROUTES[S.route], meta = r.v.meta ? r.v.meta() : {};
  clear(refs.top);
  const title = h('h1', null, meta.title || r.label, meta.sub ? h('span', { class: 'sub' }, meta.sub) : null);
  refs.top.append(title);
  if (meta.immoToggle) {
    refs.top.append(segmented([{ value: 'mine', label: `Ma part (${Math.round(S.P.part * 100)} %)` }, { value: 'full', label: 'Projet 100 %' }], S.immoView, (v) => { S.immoView = v; savePrefs(); emit(); }));
  }
  if (meta.activity) {
    refs.top.append(segmented([{ value: 'Tout', label: 'Tout' }, { value: 'Perso', label: 'Perso', dot: 'bg-Perso' }, { value: 'Freelance', label: 'Freelance', dot: 'bg-Freelance' }, { value: 'Immobilier', label: 'Immobilier', dot: 'bg-Immobilier' }], S.activity, setActivity));
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
}
function renderAll() { renderNav(); renderTop(); renderView(); document.title = `${ROUTES[S.route].label} — Cockpit`; }

function route() {
  const k = (location.hash || '#/dashboard').replace('#/', '');
  S.route = ROUTES[k] ? k : 'dashboard';
  renderAll();
  refs.scroll.scrollTop = 0;
}

// ---------- démarrage ----------
(async function init() {
  app.append(h('div', { class: 'loading' }, 'Chargement…'));
  loadPrefs(); applyTheme();
  try { await load(); } catch (e) { clear(app); app.append(h('div', { class: 'loading' }, 'Impossible de charger les données : ' + e.message)); return; }
  buildShell();
  subscribe(renderAll);
  window.addEventListener('hashchange', route);
  route();

  // heartbeat : l'application se ferme quand la fenêtre est fermée
  const hb = () => post('/api/hb').catch(() => {});
  hb(); setInterval(hb, 10000);
  window.addEventListener('pagehide', () => navigator.sendBeacon('/api/bye?t=' + window.__T));
  // reprise du focus : relire le fichier (modifié dans Excel ?)
  let lastFocus = Date.now();
  window.addEventListener('focus', async () => { if (Date.now() - lastFocus > 4000 && !document.querySelector('.overlay')) { try { await reload(); } catch { /* ignore */ } } lastFocus = Date.now(); });
  document.addEventListener('keydown', (e) => {
    const t = e.target, typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'n' && !document.querySelector('.overlay')) { e.preventDefault(); openTxForm(); }
  });
})();
