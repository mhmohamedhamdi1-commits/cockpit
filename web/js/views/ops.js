import { h, icon, eur, fmtDate, norm, clear, sum, num0 } from '../util.js';
import { S } from '../state.js';
import { txs, eurOf } from '../calc.js';
import { empty, select } from '../ui.js';
import { openTxForm } from '../txform.js';
import { actDot, catChip, amountEl, natureBadge } from './common.js';

export function meta() { return { title: 'Opérations', sub: 'Toutes les entrées et sorties', activity: true, immoToggle: false }; }

const F = { q: '', sens: '', cat: '', nature: '', limit: 120 };

export function render() {
  const base = txs();
  const cats = [...new Set(base.map((t) => t.categorie))].sort((a, b) => a.localeCompare(b));
  const out = h('div');
  const body = h('div');
  const draw = () => {
    const q = norm(F.q.trim());
    let list = base.filter((t) => (!F.sens || t.sens === F.sens) && (!F.cat || t.categorie === F.cat) && (!F.nature || t.nature === F.nature) &&
      (!q || norm([t.libelle, t.categorie, t.tiers, t.lot, t.note, t.detail].join(' ')).includes(q)));
    list = list.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id));
    const rev = sum(list.filter((t) => t.sens === 'Revenu' && t.nature === 'Courant'), eurOf), dep = sum(list.filter((t) => t.sens === 'Dépense' && t.nature === 'Courant'), eurOf);
    clear(body);
    if (!list.length) { body.append(empty('Aucune opération', 'Aucun résultat avec ces filtres sur la période choisie.')); return; }
    const shown = list.slice(0, F.limit);
    body.append(h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, h('th', null, 'Date'), h('th', null, 'Libellé'), h('th', null, 'Catégorie'), h('th', null, 'Activité'), h('th', null), h('th', { class: 'r' }, 'Montant'))),
      h('tbody', null, shown.map((t) => h('tr', { class: 'click', onClick: () => openTxForm(t) },
        h('td', { style: { whiteSpace: 'nowrap', color: 'var(--ink-2)' } }, fmtDate(t.date)),
        h('td', null, t.libelle, h('span', { class: 'sub' }, [t.tiers, t.lot, t.detail].filter(Boolean).join(' · '))),
        h('td', null, catChip(t)), h('td', { style: { whiteSpace: 'nowrap' } }, actDot(t.activite), t.activite), h('td', null, natureBadge(t)), h('td', { class: 'r' }, amountEl(t))))),
      h('tfoot', null, h('tr', null, h('td', { colspan: 4 }, `${list.length} opération${list.length > 1 ? 's' : ''}`), h('td', { class: 'r', colspan: 2 }, `Revenus ${eur(rev)} · Dépenses ${eur(dep)} · Résultat `, h('span', { class: rev - dep >= 0 ? 'pos' : 'neg' }, (rev - dep >= 0 ? '+' : '') + eur(rev - dep)))))));
    if (list.length > shown.length) body.append(h('div', { style: { textAlign: 'center', padding: '14px' } }, h('button', { class: 'btn', onClick: () => { F.limit += 200; draw(); } }, `Afficher plus (${list.length - shown.length} restantes)`)));
  };
  const search = h('input', { type: 'search', placeholder: 'Rechercher un libellé, une catégorie, un locataire…', value: F.q });
  search.addEventListener('input', () => { F.q = search.value; F.limit = 120; draw(); });
  const sensSel = select([{ value: '', label: 'Revenus et dépenses' }, { value: 'Revenu', label: 'Revenus' }, { value: 'Dépense', label: 'Dépenses' }], F.sens);
  sensSel.addEventListener('change', () => { F.sens = sensSel.value; F.limit = 120; draw(); });
  const catSel = select([{ value: '', label: 'Toutes catégories' }, ...cats.map((c) => ({ value: c, label: c }))], F.cat);
  catSel.addEventListener('change', () => { F.cat = catSel.value; F.limit = 120; draw(); });
  const natSel = select([{ value: '', label: 'Toutes natures' }, { value: 'Courant', label: 'Courant' }, { value: 'Investissement', label: 'Investissement' }, { value: 'Financement', label: 'Financement' }], F.nature);
  natSel.addEventListener('change', () => { F.nature = natSel.value; F.limit = 120; draw(); });
  draw();
  out.append(h('div', { class: 'card' },
    h('div', { class: 'filters', style: { marginBottom: '12px' } }, h('div', { class: 'grow' }, icon('search', 17), search), sensSel, catSel, natSel), body));
  return out;
}
