import { h, icon, eur, pct, monthLong, monthLabel, addMonths, monthsBetween, sum, fmtDate, daysBetween, mad, num0, monthShort } from '../util.js';
import { S, todayMonth, ops, action, upsert } from '../state.js';
import { txs, summarize, prevPeriod, seriesByBucket, topCategories, eurOf, buckets, bucketOf, groupOf, byDateDesc } from '../calc.js';
import * as core from '../core.js';
import { barChart, spark, barList } from '../charts.js';
import { empty } from '../ui.js';
import { openTxForm } from '../txform.js';
import { actDot, catChip, amountEl, kpi, delta, natureBadge } from './common.js';

export function meta() { return { title: 'Tableau de bord', sub: 'Vue consolidée de toutes tes activités', activity: true, immoToggle: true }; }

// ---------- alertes (logique partagée avec les notifications : core.js) ----------
export function computeAlerts() {
  return core.computeAlerts(S).map((a) => (a.action ? { ...a, act: async () => { await ops([action(a.action.key, { month: a.action.month })], 'Opérations récurrentes ajoutées'); } } : a));
}
export function badge() { try { return computeAlerts().filter((a) => a.kind === 'bad' || a.kind === 'warn').length; } catch { return 0; } }

// Tableau « suivi mensuel » : lignes = catégories, colonnes = mois (ou trimestres / années)
function monthlyTable(list) {
  const b = buckets();
  const cols = b.list;
  const lab = (c) => (b.mode === 'm' ? monthShort(c.key) + ' ' + c.key.slice(2, 4) : c.label);
  const mk = () => new Map(cols.map((c) => [c.key, 0]));
  const rows = (filter, keyFn) => {
    const m = new Map();
    for (const t of list) {
      if (!filter(t)) continue;
      const k = keyFn(t); const bk = bucketOf(t.date, b.mode);
      if (!m.has(k)) m.set(k, mk());
      m.get(k).set(bk, (m.get(k).get(bk) || 0) + eurOf(t));
    }
    return [...m.entries()].map(([k, v]) => ({ k, v, tot: sum([...v.values()]) })).sort((a, z) => z.tot - a.tot);
  };
  const rev = rows((t) => t.nature === 'Courant' && t.sens === 'Revenu', (t) => t.categorie);
  const dep = rows((t) => t.nature === 'Courant' && t.sens === 'Dépense', (t) => groupOf(t));
  const inv = rows((t) => t.nature === 'Investissement' && !(S.activity === 'Tout' && t.activite === 'Immobilier'), (t) => (t.sens === 'Dépense' ? 'Investi' : 'Désinvesti'));
  const tot = (rs) => cols.map((c) => sum(rs, (r) => r.v.get(c.key) || 0));
  const tRev = tot(rev), tDep = tot(dep);
  const th = (t, cls = '') => h('th', { class: cls, style: { textAlign: 'right' } }, t);
  const cell = (v, cls = '') => h('td', { class: 'num ' + cls, style: { textAlign: 'right', padding: '7px 10px', whiteSpace: 'nowrap' } }, v ? num0(v) : h('span', { class: 'muted' }, '·'));
  const line = (label, vals, total, { bold = false, cls = '', indent = false } = {}) => h('tr', { style: { fontWeight: bold ? 700 : 450, background: bold ? 'var(--surface-2)' : null } },
    h('td', { style: { position: 'sticky', left: 0, background: bold ? 'var(--surface-2)' : 'var(--surface)', padding: '7px 12px', paddingLeft: indent ? '24px' : '12px', whiteSpace: 'nowrap', minWidth: '190px', zIndex: 1 } }, label),
    vals.map((v) => cell(v, cls && v < 0 ? 'neg' : cls)), cell(total, cls && total < 0 ? 'neg' : cls));
  const body = [];
  body.push(line('Revenus', tRev, sum(tRev), { bold: true }));
  rev.forEach((r) => body.push(line(r.k, cols.map((c) => r.v.get(c.key) || 0), r.tot, { indent: true })));
  body.push(line('Dépenses courantes', tDep, sum(tDep), { bold: true }));
  dep.forEach((r) => body.push(line(r.k, cols.map((c) => r.v.get(c.key) || 0), r.tot, { indent: true })));
  const res = cols.map((c, i) => tRev[i] - tDep[i]);
  body.push(line('Résultat net', res, sum(res), { bold: true, cls: 'res' }));
  body.push(h('tr', null, h('td', { style: { position: 'sticky', left: 0, background: 'var(--surface)', padding: '7px 12px', color: 'var(--ink-3)' } }, 'Taux d’épargne'),
    cols.map((c, i) => h('td', { class: 'num muted', style: { textAlign: 'right', padding: '7px 10px' } }, tRev[i] > 0 ? pct(res[i] / tRev[i]) : '·')), h('td', { class: 'num muted', style: { textAlign: 'right', padding: '7px 10px' } }, sum(tRev) > 0 ? pct(sum(res) / sum(tRev)) : '·')));
  if (inv.length) { const ti = tot(inv); body.push(line('Investi (hors résultat)', ti, sum(ti), { bold: false })); }
  return h('div', { class: 'gridwrap' }, h('table', { class: 'rent', style: { fontSize: '13px' } },
    h('thead', null, h('tr', null, h('th', null, 'En euros'), cols.map((c) => th(lab(c))), th('Total'))), h('tbody', null, body)));
}

export function render() {
  const list = txs(), sm = summarize(list), prev = summarize(txs({ period: prevPeriod() }));
  const ser = seriesByBucket(list);
  const pts = ser.points;
  const nMonths = monthsBetween(S.period.from, S.period.to).length;
  const vs = h('span', null, 'vs période précédente');
  const kpis = h('div', { class: 'kpis' },
    kpi({ title: 'Revenus', ic: 'down', value: eur(sm.rev), spark: spark(pts.map((p) => p.rev)), sub: [delta(sm.rev, prev.rev), vs] }),
    kpi({ title: 'Dépenses', ic: 'up', value: eur(sm.dep), spark: spark(pts.map((p) => p.dep)), sub: [delta(sm.dep, prev.dep, { inverse: true }), vs] }),
    kpi({ title: 'Résultat net', ic: 'wallet', value: h('span', { class: sm.res >= 0 ? '' : 'neg' }, (sm.res > 0 ? '+' : '') + eur(sm.res)), spark: spark(pts.map((p) => p.res)),
      sub: [sm.rate != null ? h('span', { class: 'delta ' + (sm.rate >= 0.2 ? 'good' : sm.rate >= 0 ? 'flat' : 'bad') }, `Épargne ${pct(sm.rate)}`) : null, delta(sm.res, prev.res)] }),
    kpi({ title: 'Investi', ic: 'chart', value: eur(sm.inv), sub: [h('span', null, S.activity === 'Tout' ? 'Bourse, apports immobilier…' : 'Hors résultat')] }));

  // Graphique
  const chartCard = h('div', { class: 'card' },
    h('header', null, h('h2', null, 'Revenus et dépenses'), h('span', { class: 'sub' }, ser.mode === 'm' ? 'par mois' : ser.mode === 'q' ? 'par trimestre' : 'par année'),
      h('div', { class: 'right legend' }, h('span', null, h('i', { style: { background: 'var(--flow-in)' } }), 'Revenus'), h('span', null, h('i', { style: { background: 'var(--flow-out)' } }), 'Dépenses'))),
    list.length ? barChart({ points: pts, mode: ser.mode }) : empty('Aucune opération sur cette période', 'Change la période ou ajoute une opération.'));

  // Alertes
  const alerts = computeAlerts();
  const alertsCard = h('div', { class: 'card' }, h('header', null, h('h2', null, 'À surveiller'), h('span', { class: 'sub' }, alerts.length ? `${alerts.length} point${alerts.length > 1 ? 's' : ''}` : '')),
    alerts.length ? h('div', { class: 'alerts' }, alerts.slice(0, 6).map((a) =>
      h('div', { class: 'alert ' + a.kind }, h('div', { class: 'ic' }, icon(a.ic, 17)), h('div', { class: 'tx' }, a.title, h('small', null, a.sub)),
        h('button', { class: 'btn sm', onClick: () => (a.act ? a.act() : (location.hash = a.go)) }, a.label))))
      : h('div', { class: 'alert good' }, h('div', { class: 'ic' }, icon('check', 17)), h('div', { class: 'tx' }, 'Tout est à jour', h('small', null, 'Aucun loyer en retard, aucune facture en attente.'))));

  // Carte 3 : résultat par activité ou revenus par source
  let c3;
  if (S.activity === 'Tout') {
    const items = ['Perso', 'Freelance', 'Immobilier'].map((a) => { const s = summarize(list.filter((t) => t.activite === a), { activity: 'Tout' }); return { label: a, dot: a, value: s.res, rev: s.rev, dep: s.dep }; });
    c3 = h('div', { class: 'card' }, h('header', null, h('h2', null, 'Résultat par activité'), h('span', { class: 'sub' }, 'revenus − dépenses courantes')),
      barList(items.map((i) => ({ label: i.label, dot: i.dot, value: i.value, color: `var(--${i.label === 'Perso' ? 'perso' : i.label === 'Freelance' ? 'freelance' : 'immo'})` })), { fmt: (v) => (v > 0 ? '+' : '') + eur(v) }),
      h('table', { class: 'tbl', style: { marginTop: '14px' } }, h('thead', null, h('tr', null, h('th', null, ''), h('th', { class: 'r' }, 'Revenus'), h('th', { class: 'r' }, 'Dépenses'), h('th', { class: 'r' }, 'Résultat'))),
        h('tbody', null, items.map((i) => h('tr', null, h('td', null, h('i', { class: 'adot ' + i.label }), i.label), h('td', { class: 'r num' }, eur(i.rev)), h('td', { class: 'r num' }, eur(i.dep)), h('td', { class: 'r num', style: { fontWeight: 700 } }, h('span', { class: i.value >= 0 ? 'pos' : 'neg' }, (i.value > 0 ? '+' : '') + eur(i.value))))))));
  } else {
    const m = new Map();
    for (const t of list) if (t.nature === 'Courant' && t.sens === 'Revenu') m.set(t.categorie, (m.get(t.categorie) || 0) + eurOf(t));
    const arr = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    c3 = h('div', { class: 'card' }, h('header', null, h('h2', null, 'Revenus par source')), arr.length ? barList(arr.map(([l, v]) => ({ label: l, value: v })), { total: sm.rev }) : empty('Aucun revenu', ''));
  }
  const cats = topCategories(list, { by: S.activity === 'Tout' ? 'groupe' : 'categorie' });
  const c4 = h('div', { class: 'card' }, h('header', null, h('h2', null, 'Où part l’argent'), h('span', { class: 'sub' }, 'dépenses courantes')),
    cats.length ? barList(cats.map(([l, v]) => ({ label: l, value: v })), { total: sm.dep }) : empty('Aucune dépense sur la période', ''));

  // Dernières opérations
  const recent = [...list].sort(byDateDesc).slice(0, 8);
  const c5 = h('div', { class: 'card' }, h('header', null, h('h2', null, 'Dernières opérations'), h('div', { class: 'right' }, h('a', { class: 'btn sm ghost', href: '#/ops' }, 'Tout voir', icon('right', 14)))),
    recent.length ? h('table', { class: 'tbl txlist' }, h('tbody', null, recent.map((t) =>
      h('tr', { class: 'click' + (t._pending ? ' pending' : ''), onClick: () => openTxForm(t) },
        h('td', { class: 'c-date', style: { width: '90px', color: 'var(--ink-3)' } }, fmtDate(t.date).replace(/ \d{4}$/, '')),
        h('td', { class: 'c-lib' }, h('span', { class: 'lib' }, actDot(t.activite), t.libelle), h('span', { class: 'sub' }, [fmtDate(t.date).replace(/ \d{4}$/, ''), t.categorie, t.tiers, t.lot].filter(Boolean).join(' · '))),
        h('td', { class: 'c-cat' }, catChip(t)), h('td', { class: 'c-act' }, actDot(t.activite), t.activite), h('td', { class: 'c-nat' }, natureBadge(t)), h('td', { class: 'r c-amt' }, amountEl(t)))))) : empty('Rien à afficher', ''));

  const monthly = h('div', { class: 'card' }, h('header', null, h('h2', null, 'Suivi mensuel'), h('span', { class: 'sub' }, 'revenus et dépenses courantes, mois par mois')),
    list.length ? monthlyTable(list) : empty('Aucune opération sur cette période', ''));
  return [kpis, h('div', { class: 'row2' }, chartCard, alertsCard), h('div', { class: 'row2e' }, c3, c4), monthly, c5];
}
