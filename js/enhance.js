// Améliorations génériques appliquées à toutes les cartes et tous les tableaux :
// - accordéon (afficher / masquer le détail) accessible : bouton aria-expanded + aria-controls
// - plein écran (maximiser / réduire), touche Échap pour sortir
// - tri des colonnes (clic sur l'en-tête), ordre des colonnes par glisser-déposer (mémorisé)
import { h, icon } from './util.js';
import { S, savePrefs } from './state.js';

const sortState = {};
const hash = (s) => { let x = 0; for (const c of s) x = (x * 31 + c.charCodeAt(0)) | 0; return (x >>> 0).toString(36); };
const cardKey = (card) => `${S.route}:${(card.querySelector(':scope > header h2') || {}).textContent || ''}`.trim();

function closeMax() {
  const c = document.querySelector('.card.maxed');
  if (c) { c.classList.remove('maxed'); document.body.classList.remove('has-max'); const b = c.querySelector('.cardtools .maxbtn'); if (b) { b.replaceChildren(icon('maximize', 15)); b.title = 'Agrandir'; b.setAttribute('aria-pressed', 'false'); } }
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.querySelector('.card.maxed') && !document.querySelector('.overlay')) closeMax(); });

function enhanceCard(card) {
  const head = card.querySelector(':scope > header');
  if (!head || !head.querySelector('h2') || card.dataset.enh) return;
  card.dataset.enh = '1';
  const key = cardKey(card);
  const id = 'card-' + hash(key);
  card.id = card.id || id;
  S.collapsed = S.collapsed || {};
  const collapsed = !!S.collapsed[key];
  card.classList.toggle('collapsed', collapsed);
  const tog = h('button', { type: 'button', class: 'btn ghost icon sm togbtn', 'aria-expanded': String(!collapsed), 'aria-controls': card.id, title: collapsed ? 'Afficher le détail' : 'Masquer le détail' }, icon(collapsed ? 'chevdown' : 'chevup', 16));
  const toggle = () => {
    const c = !card.classList.contains('collapsed');
    card.classList.toggle('collapsed', c);
    S.collapsed[key] = c; if (!c) delete S.collapsed[key]; savePrefs();
    tog.setAttribute('aria-expanded', String(!c)); tog.title = c ? 'Afficher le détail' : 'Masquer le détail';
    tog.replaceChildren(icon(c ? 'chevdown' : 'chevup', 16));
  };
  tog.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
  const max = h('button', { type: 'button', class: 'btn ghost icon sm maxbtn', title: 'Agrandir', 'aria-pressed': 'false' }, icon('maximize', 15));
  max.addEventListener('click', (e) => {
    e.stopPropagation();
    if (card.classList.contains('maxed')) return closeMax();
    closeMax();
    card.classList.remove('collapsed');
    card.classList.add('maxed'); document.body.classList.add('has-max');
    max.replaceChildren(icon('minimize', 15)); max.title = 'Réduire'; max.setAttribute('aria-pressed', 'true');
  });
  const h2 = head.querySelector('h2');
  h2.classList.add('clickable'); h2.setAttribute('role', 'button'); h2.tabIndex = 0;
  h2.addEventListener('click', toggle);
  h2.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  head.append(h('div', { class: 'cardtools' }, max, tog));
}

// ---------- tableaux ----------
const MONTHS = { 'janv.': 1, 'févr.': 2, mars: 3, 'avr.': 4, mai: 5, juin: 6, 'juil.': 7, août: 8, 'sept.': 9, 'oct.': 10, 'nov.': 11, 'déc.': 12 };
function sortValue(td) {
  if (!td) return '';
  if (td.dataset.sort != null) { const n = Number(td.dataset.sort); return isNaN(n) ? td.dataset.sort : n; }
  const t = td.textContent.trim();
  const d = t.match(/^(\d{1,2}) (\S+) (\d{4})/);
  if (d && MONTHS[d[2]]) return Number(`${d[3]}${String(MONTHS[d[2]]).padStart(2, '0')}${d[1].padStart(2, '0')}`);
  const num = t.replace(/[\s  ]/g, '').replace('−', '-').match(/^[+-]?\d[\d.,]*(?=[%€A-Za-z]|$|\D)/);
  if (num) { const n = Number(num[0].replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')); if (!isNaN(n)) return n; }
  return t.toLowerCase();
}
function tableKey(tbl) {
  const card = tbl.closest('.card');
  const heads = [...tbl.querySelectorAll('thead th')].map((th) => th.dataset.label || th.textContent.trim()).join('|');
  return `${card ? cardKey(card) : S.route}#${hash(heads)}`;
}
function sortTable(tbl, col, dir) {
  const tb = tbl.tBodies[0];
  if (!tb) return;
  const rows = [...tb.rows];
  rows.sort((a, b) => {
    const x = sortValue(a.cells[col]), y = sortValue(b.cells[col]);
    const r = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'fr', { numeric: true });
    return dir === 'asc' ? r : -r;
  });
  tb.append(...rows);
  tbl.querySelectorAll('thead th').forEach((th, i) => { th.setAttribute('aria-sort', i === col ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'); th.classList.toggle('sorted', i === col); th.dataset.dir = i === col ? dir : ''; });
}
function moveColumn(tbl, from, to) {
  const n = tbl.tHead.rows[0].cells.length;
  for (const row of tbl.rows) {
    if (row.cells.length !== n) continue;            // lignes avec fusion (totaux) : inchangées
    const cells = [...row.cells];
    const [c] = cells.splice(from, 1); cells.splice(to, 0, c);
    row.append(...cells);
  }
}
function enhanceTable(tbl) {
  if (tbl.dataset.enh || !tbl.tHead || !tbl.tHead.rows.length) return;
  tbl.dataset.enh = '1';
  const ths = [...tbl.tHead.rows[0].cells];
  ths.forEach((th, i) => { th.dataset.orig = i; th.dataset.label = th.textContent.trim(); });
  const key = tableKey(tbl);
  // ordre des colonnes mémorisé
  S.colOrder = S.colOrder || {};
  const order = S.colOrder[key];
  if (Array.isArray(order) && order.length === ths.length) {
    order.forEach((orig, pos) => { const cur = [...tbl.tHead.rows[0].cells].findIndex((th) => +th.dataset.orig === orig); if (cur !== pos) moveColumn(tbl, cur, pos); });
  }
  const desktop = window.matchMedia('(hover: hover)').matches;
  [...tbl.tHead.rows[0].cells].forEach((th) => {
    if (!th.dataset.label) return;
    th.classList.add('sortable'); th.tabIndex = 0; th.setAttribute('aria-sort', 'none'); th.title = 'Trier' + (desktop ? ' · glisser pour déplacer la colonne' : '');
    const sortMe = () => { const col = [...th.parentNode.cells].indexOf(th); const dir = th.dataset.dir === 'asc' ? 'desc' : 'asc'; sortState[key] = { orig: th.dataset.orig, dir }; sortTable(tbl, col, dir); };
    th.addEventListener('click', sortMe);
    th.addEventListener('keydown', (e) => { if (e.key === 'Enter') sortMe(); });
    if (!desktop) return;
    th.draggable = true;
    th.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', String([...th.parentNode.cells].indexOf(th))); th.classList.add('dragging'); });
    th.addEventListener('dragend', () => th.classList.remove('dragging'));
    th.addEventListener('dragover', (e) => { e.preventDefault(); th.classList.add('dropping'); });
    th.addEventListener('dragleave', () => th.classList.remove('dropping'));
    th.addEventListener('drop', (e) => {
      e.preventDefault(); th.classList.remove('dropping');
      const from = Number(e.dataTransfer.getData('text/plain')), to = [...th.parentNode.cells].indexOf(th);
      if (isNaN(from) || from === to) return;
      moveColumn(tbl, from, to);
      S.colOrder[key] = [...tbl.tHead.rows[0].cells].map((c) => +c.dataset.orig); savePrefs();
    });
  });
  const st = sortState[key];
  if (st) { const col = [...tbl.tHead.rows[0].cells].findIndex((th) => th.dataset.orig === st.orig); if (col >= 0) sortTable(tbl, col, st.dir); }
}

export function enhance(root) {
  if (!root) return;
  root.querySelectorAll('.card').forEach(enhanceCard);
  root.querySelectorAll('table.tbl').forEach(enhanceTable);
}
export function resetLayout() { S.collapsed = {}; S.colOrder = {}; savePrefs(); }
export { closeMax };
