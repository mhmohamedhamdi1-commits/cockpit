import { h, icon, eur, money, pct, fmtDate, sum, clear, monthLabel, parseAmount, num2, CUR_CODES, curSym } from '../util.js';
import { S, ops, upsert, del, rateToEur } from '../state.js';
import { lineChart } from '../charts.js';
import { modal, field, select, confirmBox, empty, toast } from '../ui.js';
import { kpi, delta } from './common.js';

export function meta() { return { title: 'Patrimoine', sub: 'Soldes de tes comptes à chaque relevé', immoToggle: false }; }

const rate = (cur) => rateToEur(cur);
function byDate() {
  const m = new Map();
  for (const s of S.data.snapshots) { const e = m.get(s.date) || { date: s.date, total: 0, items: new Map() }; e.total += s.soldeEur; e.items.set(s.compte, s); m.set(s.date, e); }
  return [...m.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}
function lastAndPrev(compte) {
  const l = S.data.snapshots.filter((s) => s.compte === compte).sort((a, b) => (a.date < b.date ? 1 : -1));
  return [l[0], l[1]];
}

function openSnapshotForm() {
  const date = h('input', { type: 'date', value: S.today });
  const accs = [...S.data.accounts].sort((a, b) => a.ordre - b.ordre);
  const inputs = accs.map((a) => { const [l] = lastAndPrev(a.nom); return { a, el: h('input', { type: 'text', inputmode: 'decimal', placeholder: l ? num2(l.solde).replace(/ /g, ' ') : '0', value: '', class: 'num', style: { textAlign: 'right' } }), last: l }; });
  const tot = h('b', { class: 'num' });
  const upd = () => { tot.textContent = eur(sum(inputs, (x) => { const v = x.el.value.trim() === '' ? (x.last ? x.last.solde : 0) : parseAmount(x.el.value); return v * rate(x.a.devise); })); };
  inputs.forEach((x) => x.el.addEventListener('input', upd)); upd();
  const go = async () => {
    const list = [];
    for (const x of inputs) {
      const raw = x.el.value.trim(); const v = raw === '' ? (x.last ? x.last.solde : null) : parseAmount(raw);
      if (v == null) continue;
      const ex = S.data.snapshots.find((s) => s.date === date.value && s.compte === x.a.nom);
      list.push(upsert('snapshot', { id: ex ? ex.id : 0, date: date.value, compte: x.a.nom, solde: v, devise: x.a.devise }));
    }
    if (!list.length) return toast('Saisis au moins un solde.', 'error');
    if (await ops(list, 'Relevé enregistré')) m.close();
  };
  const m = modal({ title: 'Nouveau relevé de soldes', sub: 'Laisse vide un compte inchangé : le dernier solde est reporté', width: 560,
    body: [field('Date du relevé', date), h('table', { class: 'tbl' }, h('tbody', null, inputs.map((x) => h('tr', null, h('td', null, x.a.nom, h('span', { class: 'sub' }, `${x.a.dispo === 'Oui' ? 'Disponible' : 'Bloqué / placé'}${x.last ? ` · dernier : ${money(x.last.solde, x.a.devise, 2)}` : ''}`)), h('td', { style: { width: '170px' } }, x.el), h('td', { class: 'muted', style: { width: '42px' } }, curSym(x.a.devise))))))],
    footer: [h('span', null, 'Total : ', tot), h('span', { class: 'sp' }), h('button', { class: 'btn', onClick: () => m.close() }, 'Annuler'), h('button', { class: 'btn primary lg', onClick: go }, 'Enregistrer le relevé')] });
}

function openAccounts() {
  const rows = [...S.data.accounts].sort((a, b) => a.ordre - b.ordre).map((a) => ({ ...a }));
  const removed = [];
  const box = h('div');
  const draw = () => {
    clear(box);
    box.append(h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', null, 'Compte'), h('th', null, 'Devise'), h('th', null, 'Disponible ?'), h('th', null))),
      h('tbody', null, rows.map((r, i) => {
        const n = h('input', { type: 'text', value: r.nom, placeholder: 'Nom du compte' }); n.addEventListener('input', () => { r.nom = n.value; });
        const d = select(CUR_CODES, r.devise); d.addEventListener('change', () => { r.devise = d.value; });
        const v = select([{ value: 'Oui', label: 'Oui' }, { value: 'Non', label: 'Non (bloqué / placé)' }], r.dispo); v.addEventListener('change', () => { r.dispo = v.value; });
        return h('tr', null, h('td', null, n), h('td', { style: { width: '90px' } }, d), h('td', { style: { width: '190px' } }, v),
          h('td', null, h('button', { class: 'btn sm ghost danger', onClick: () => { if (r.id) removed.push(r.id); rows.splice(i, 1); draw(); } }, icon('trash', 14))));
      }))), h('button', { class: 'btn sm', style: { marginTop: '10px' }, onClick: () => { rows.push({ id: 0, nom: '', devise: 'EUR', dispo: 'Oui', ordre: rows.length + 1 }); draw(); } }, icon('plus', 14), 'Ajouter un compte'));
  };
  draw();
  const m = modal({ title: 'Mes comptes', width: 640, body: [box],
    footer: [h('span', { class: 'sp' }), h('button', { class: 'btn', onClick: () => m.close() }, 'Annuler'), h('button', { class: 'btn primary lg', onClick: async () => {
      const list = removed.map((id) => del('account', id));
      rows.filter((r) => r.nom.trim()).forEach((r, i) => list.push(upsert('account', { ...r, nom: r.nom.trim(), ordre: i + 1 })));
      if (await ops(list, 'Comptes enregistrés')) m.close();
    } }, 'Enregistrer')] });
}

export function render() {
  const dates = byDate();
  if (!dates.length) return h('div', { class: 'card' }, empty('Aucun relevé de soldes', 'Enregistre les soldes de tes comptes (une fois par mois suffit) pour suivre ton patrimoine.',
    h('button', { class: 'btn primary', onClick: openSnapshotForm }, icon('plus', 16), 'Premier relevé')));
  const last = dates[dates.length - 1], prev = dates[dates.length - 2];
  // totaux disponible / bloqué
  const dispoOf = (compte) => (S.data.accounts.find((a) => a.nom === compte) || {}).dispo === 'Oui';
  const latest = new Map();
  for (const d of dates) for (const [c, s] of d.items) latest.set(c, s);
  const dispo = sum([...latest.entries()].filter(([c]) => dispoOf(c)), ([, s]) => s.soldeEur);
  const total = sum([...latest.values()], (s) => s.soldeEur);
  const d = prev ? last.total - prev.total : 0;
  const kpis = h('div', { class: 'kpis' },
    kpi({ title: 'Patrimoine total', ic: 'bank', value: eur(total), sub: [h('span', null, `Relevé du ${fmtDate(last.date)}`)] }),
    kpi({ title: 'Disponible', ic: 'wallet', value: eur(dispo), sub: [h('span', null, pct(total ? dispo / total : 0) + ' du patrimoine')] }),
    kpi({ title: 'Bloqué / placé', ic: 'key', value: eur(total - dispo), sub: [h('span', null, 'Actions, caution, prêts…')] }),
    kpi({ title: 'Évolution', ic: 'chart', value: prev ? h('span', { class: d >= 0 ? 'pos' : 'neg' }, (d >= 0 ? '+' : '') + eur(d)) : '—', sub: [prev ? delta(last.total, prev.total) : null, h('span', null, prev ? `depuis le ${fmtDate(prev.date)}` : 'Fais un 2ᵉ relevé pour voir l’évolution')] }));

  let pts = dates.filter((x) => x.date.slice(0, 7) >= S.period.from && x.date.slice(0, 7) <= S.period.to);
  if (pts.length < 2) pts = dates;
  const chart = h('div', { class: 'card' }, h('header', null, h('h2', null, 'Évolution du patrimoine'), h('span', { class: 'sub' }, `${pts.length} relevé${pts.length > 1 ? 's' : ''}`)),
    pts.length > 1 ? lineChart({ points: pts.map((p) => ({ t: new Date(p.date).getTime(), y: p.total, label: fmtDate(p.date).replace(/^\d+ /, ''), full: fmtDate(p.date) })) })
      : h('div', { class: 'empty' }, h('b', null, 'Un seul relevé pour l’instant'), 'Fais un relevé chaque fin de mois : la courbe apparaîtra automatiquement.'));

  const accs = [...S.data.accounts].sort((a, b) => a.ordre - b.ordre);
  const tbl = h('div', { class: 'card' }, h('header', null, h('h2', null, 'Mes comptes'), h('div', { class: 'right' }, h('button', { class: 'btn sm', onClick: openAccounts }, icon('sliders', 14), 'Gérer les comptes'), h('button', { class: 'btn primary', onClick: openSnapshotForm }, icon('plus', 16), 'Nouveau relevé'))),
    h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', null, 'Compte'), h('th', null, 'Statut'), h('th', { class: 'r' }, 'Solde'), h('th', { class: 'r' }, 'En euros'), h('th', { class: 'r' }, 'Variation'))),
      h('tbody', null, accs.map((a) => {
        const [l, p] = lastAndPrev(a.nom);
        const dv = l && p ? l.soldeEur - p.soldeEur : null;
        return h('tr', null, h('td', null, a.nom, l ? h('span', { class: 'sub' }, fmtDate(l.date)) : null), h('td', null, a.dispo === 'Oui' ? h('span', { class: 'pill good' }, 'Disponible') : h('span', { class: 'pill mute' }, 'Bloqué / placé')),
          h('td', { class: 'r num' }, l ? money(l.solde, a.devise, 2) : '—'), h('td', { class: 'r num' }, l ? eur(l.soldeEur) : '—'),
          h('td', { class: 'r num ' + (dv > 0 ? 'pos' : dv < 0 ? 'neg' : 'muted') }, dv == null ? '—' : (dv > 0 ? '+' : '') + eur(dv)));
      })),
      h('tfoot', null, h('tr', null, h('td', { colspan: 3 }, 'Total'), h('td', { class: 'r num' }, eur(total)), h('td')))));
  return [kpis, chart, tbl];
}
