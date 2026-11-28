import { h, icon, eur, pct, monthLong, monthLabel, addMonths, monthsBetween, sum, fmtDate, daysBetween, mad, num0, monthShort } from '../util.js';
import { S, todayMonth, ops, action, upsert } from '../state.js';
import { txs, summarize, prevPeriod, seriesByBucket, topCategories, eurOf, buckets, bucketOf, groupOf, byDateDesc } from '../calc.js';
import * as core from '../core.js';
import { barChart, spark, barList, seriesChart, scoreRing, donut, PALETTE } from '../charts.js';
import { segmented, modal } from '../ui.js';
import { partOf, isMine, savePrefs, emit, immoProjets, entreprises, assocOpts } from '../state.js';
import { empty } from '../ui.js';
import { portfolioNow, ensureQuotes, sectorOf } from '../market.js';
import { partnerBalances, capitalRecovery, occupancy } from '../immo-calc.js';
import { openTxForm } from '../txform.js';
import { actDot, catChip, amountEl, kpi, delta, natureBadge } from './common.js';

export function meta() {
  const sub = { Tout: 'Perso + Immobilier (tes parts) — l’entreprise est suivie à part, jamais additionnée', Perso: 'Ta vie courante', Entreprise: 'Activité de l’entreprise (100 % de l’entreprise)', Immobilier: 'Immobilier — tes parts des projets', Bourse: 'Ton portefeuille valorisé aux cours du marché' };
  return { title: 'Tableau de bord', sub: sub[S.activity] || sub.Tout, activity: true, immoToggle: false };
}

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
  ensureQuotes();
  if (S.activity === 'Bourse') return renderBourse();
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
    h('header', null, h('h2', null, S.chartType === 'evol' ? 'Évolution' : 'Revenus et dépenses'), h('span', { class: 'sub' }, ser.mode === 'm' ? 'par mois' : ser.mode === 'q' ? 'par trimestre' : 'par année')),
    h('div', { class: 'chartctl' },
      segmented([{ value: 'auto', label: 'Auto' }, { value: 'm', label: 'Mois' }, { value: 'q', label: 'Trim.' }, { value: 'y', label: 'Année' }], S.chartGran || 'auto', (v) => { S.chartGran = v; savePrefs(); emit(); }, 'sm'),
      segmented([{ value: 'bar', label: 'Barres' }, { value: 'line', label: 'Courbes' }, { value: 'area', label: 'Aires' }, { value: 'evol', label: 'Évolution' }], S.chartType || 'bar', (v) => { S.chartType = v; savePrefs(); emit(); }, 'sm')),
    list.length ? mainChart(pts, ser.mode) : empty('Aucune opération sur cette période', 'Change la période ou ajoute une opération.'));

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
    // Perso + Immobilier se cumulent. L'entreprise est affichée à part (une facture devient un salaire dans le perso : la sommer ferait un doublon).
    const act = (a) => summarize(txs({ activity: a }), { activity: 'Tout' });
    const items = ['Perso', 'Immobilier'].map((a) => { const s0 = summarize(list.filter((t) => t.activite === a), { activity: 'Tout' }); return { label: a, dot: a, value: s0.res, rev: s0.rev, dep: s0.dep }; });
    const ent = act('Entreprise');
    const hasEnt = txs({ activity: 'Entreprise' }).length > 0;
    const tot = { rev: sum(items, (i) => i.rev), dep: sum(items, (i) => i.dep), res: sum(items, (i) => i.value) };
    const row = (i) => h('tr', null, h('td', null, h('i', { class: 'adot ' + i.label }), i.label), h('td', { class: 'r num' }, eur(i.rev)), h('td', { class: 'r num' }, eur(i.dep)), h('td', { class: 'r num', style: { fontWeight: 700 } }, h('span', { class: i.value >= 0 ? 'pos' : 'neg' }, (i.value > 0 ? '+' : '') + eur(i.value))));
    c3 = h('div', { class: 'card' }, h('header', null, h('h2', null, 'Résultat par activité'), h('span', { class: 'sub' }, 'revenus − dépenses courantes')),
      barList(items.map((i) => ({ label: i.label, dot: i.dot, value: i.value, color: `var(--${i.label === 'Perso' ? 'perso' : 'immo'})` })), { fmt: (v) => (v > 0 ? '+' : '') + eur(v) }),
      h('table', { class: 'tbl', style: { marginTop: '14px' } }, h('thead', null, h('tr', null, h('th', null, ''), h('th', { class: 'r' }, 'Revenus'), h('th', { class: 'r' }, 'Dépenses'), h('th', { class: 'r' }, 'Résultat'))),
        h('tbody', null, items.map(row),
          h('tr', { class: 'total' }, h('td', null, h('b', null, 'Total consolidé')), h('td', { class: 'r num' }, h('b', null, eur(tot.rev))), h('td', { class: 'r num' }, h('b', null, eur(tot.dep))), h('td', { class: 'r num' }, h('b', { class: tot.res >= 0 ? 'pos' : 'neg' }, (tot.res > 0 ? '+' : '') + eur(tot.res)))),
          hasEnt ? h('tr', { class: 'apart' }, h('td', null, h('i', { class: 'adot Entreprise' }), 'Entreprise ', h('span', { class: 'pill mute', title: 'Une facture devient un salaire (ou un dividende) dans ton Perso : l’additionner ferait un doublon.' }, 'non cumulée')), h('td', { class: 'r num muted' }, eur(ent.rev)), h('td', { class: 'r num muted' }, eur(ent.dep)), h('td', { class: 'r num muted' }, (ent.res > 0 ? '+' : '') + eur(ent.res))) : null)));
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
  return [kpis, h('div', { class: 'row2e' }, healthCard(), cashCard()), compareCard(), h('div', { class: 'row2' }, chartCard, alertsCard), h('div', { class: 'row2e' }, c3, c4), monthly, c5];
}

// ---------- Graphique principal (granularité et type choisis par l'utilisateur) ----------
function mainChart(pts, mode) {
  const labels = pts.map((p) => ({ key: p.key, label: mode === 'm' ? monthShort(p.key) : p.key, sub: mode === 'm' && (p === pts[0] || p.key.endsWith('-01')) ? p.key.slice(0, 4) : '', full: mode === 'm' ? monthLong(p.key) : p.key }));
  if (S.chartType === 'evol') {
    // trésorerie cumulée depuis la 1re opération (tous flux, mes parts) + résultat cumulé de la période
    const all = S.data.tx.filter((t) => (S.activity === 'Tout' ? t.activite !== 'Entreprise' : t.activite === S.activity));
    const allFlows = (t) => (t.sens === 'Revenu' ? 1 : -1) * eurOf(t);
    let start = sum(all.filter((t) => t.date.slice(0, 7) < S.period.from), allFlows);
    let cum = 0;
    const treso = [], res = [];
    for (const p of pts) {
      const ins = all.filter((t) => bucketOf(t.date, mode) === p.key && t.date.slice(0, 7) >= S.period.from && t.date.slice(0, 7) <= S.period.to);
      start += sum(ins, allFlows); treso.push(start);
      cum += p.res; res.push(cum);
    }
    return seriesChart({ labels, type: 'line', title: 'Évolution', series: [{ name: 'Trésorerie (tous flux)', color: '#007AFF', values: treso }, { name: 'Résultat cumulé (période)', color: '#AF52DE', values: res }] });
  }
  return seriesChart({ labels, type: S.chartType || 'bar', title: 'Revenus et dépenses', series: [
    { name: 'Revenus', color: 'var(--flow-in)', values: pts.map((p) => p.rev) },
    { name: 'Dépenses', color: 'var(--flow-out)', values: pts.map((p) => p.dep) },
    ...(S.chartType !== 'bar' ? [{ name: 'Résultat', color: '#007AFF', values: pts.map((p) => p.res) }] : []),
  ] });
}

// ---------- Trésorerie actuelle ----------
function cashCard() {
  const c = core.cashPosition(S, { partOf, isMine });
  const row = (label, value, sub, cls = '') => h('div', { class: 'cashrow ' + cls }, h('div', null, h('b', null, label), sub ? h('span', { class: 'sub' }, sub) : null), h('div', { class: 'num v' }, value));
  const p = c.perso;
  const det = h('details', { class: 'details' }, h('summary', null, icon('right', 14), 'Détail du calcul'),
    h('table', { class: 'tbl' }, h('tbody', null,
      h('tr', null, h('td', null, 'Revenus courants'), h('td', { class: 'r num pos' }, '+' + eur(p.rev, 2))),
      h('tr', null, h('td', null, 'Dépenses courantes'), h('td', { class: 'r num neg' }, '−' + eur(p.dep, 2))),
      h('tr', null, h('td', null, 'Investissements (bourse, apports immobiliers…)'), h('td', { class: 'r num neg' }, '−' + eur(p.inv, 2))),
      h('tr', null, h('td', null, 'Financements (distributions, prêts…)'), h('td', { class: 'r num' }, (p.fin >= 0 ? '+' : '−') + eur(Math.abs(p.fin), 2))),
      h('tr', null, h('td', null, h('b', null, 'Trésorerie perso')), h('td', { class: 'r num' }, h('b', null, eur(p.eur, 2)))))),
    c.releve ? h('div', { class: 'note', style: { marginTop: '8px' } }, `Dernier relevé de comptes (${fmtDate(c.releve.date)}) : ${eur(c.releve.dispo)} disponibles. L’écart (${eur(c.releve.dispo - p.eur)}) correspond aux soldes antérieurs au ${fmtDate(p.since)} ou à des opérations non saisies.`) : null);
  return h('div', { class: 'card' }, h('header', null, h('h2', null, 'Trésorerie actuelle'), h('span', { class: 'sub' }, 'cumul de tous les flux depuis le début')),
    h('div', { class: 'cashlist' },
      row('Perso', h('span', { class: p.eur >= 0 ? '' : 'neg' }, eur(p.eur, 2)), `compte en France · depuis le ${fmtDate(p.since)}`),
      c.projets.map((x) => row(x.nom, [mad(x.mineMad), h('span', { class: 'sub' }, `≈ ${eur(x.mineEur)}`)], `${x.shared ? 'partagé · ' : ''}ma part ${Math.round(x.part * 100)} % de ${mad(x.mad)}`)),
      row('Total (mes parts)', h('b', null, eur(c.totalMineEur, 2)), 'Perso + Immobilier', 'total'),
      c.entreprises.length ? h('div', { class: 'cashsep' }, 'Entreprises — non cumulées dans le total') : null,
      c.entreprises.map((x) => row(x.nom, h('span', { class: 'muted' }, eur(x.eur, 2)), `100 % de l’entreprise · ma part ${Math.round(x.part * 100)} % = ${eur(x.mineEur)}`, 'apart'))),
    det);
}

// ---------- Santé financière : selon le filtre (Tout / Perso / Entreprise / Immobilier / Bourse) ----------
const SCOPE_LABEL = { Tout: 'toutes les activités', Perso: 'perso', Entreprise: 'entreprise', Immobilier: 'immobilier', Bourse: 'bourse' };
function healthOpts() {
  const projets = immoProjets();
  const main = [...projets].sort((a, b) => S.data.tx.filter((t) => t.projetId === b.id).length - S.data.tx.filter((t) => t.projetId === a.id).length)[0];
  let balances = null, capital = null;
  if (main) { try { balances = partnerBalances(S, main, assocOpts(main)); capital = capitalRecovery(S, main); } catch (e) { console.error(e); } }
  return { projets, partOf, occupancy, balances, capital, pf: portfolioNow(), sectorOf};
}
const fmtVal = (i) => (i.fmt === 'pct' ? pct(i.value) : i.fmt === 'mois' ? `${i.value.toFixed(1).replace('.', ',')} mois` : i.fmt === 'delta' ? `${i.value >= 0 ? '+' : ''}${pct(i.value)}` : i.fmt === 'mad' ? mad(i.value) : i.fmt === 'money' ? eur(i.value) : String(i.value));
const fg = (g) => String(g).replace('.', ',');
const DOT = { good: 'var(--good)', warn: 'var(--warn)', bad: 'var(--crit)' };
const LEVEL = { good: 'Bon', warn: 'À surveiller', bad: 'À corriger' };

function indicatorRow(i) {
  return h('div', { class: 'hi ' + i.level },
    h('i', { style: { background: DOT[i.level] } }),
    h('div', null, h('b', null, i.label, ' ', h('span', { class: 'hv' }, fmtVal(i))), h('span', { class: 'sub' }, i.text),
      i.level !== 'good' && i.advice ? h('span', { class: 'advice' }, icon('info', 13), 'Conseil : ' + i.advice) : null));
}

function openScoreExplain(hl) {
  const g = hl.explain.grades;
  const rows = hl.domains.flatMap((d) => d.indicators.map((i) => h('tr', null, h('td', null, d.name), h('td', null, i.label), h('td', { class: 'r num' }, fmtVal(i)),
    h('td', null, h('span', { class: 'pill ' + (i.level === 'good' ? 'good' : i.level === 'warn' ? 'warn' : 'bad') }, LEVEL[i.level])), h('td', { class: 'r num' }, i.points))));
  const dom = hl.domains.map((d) => h('tr', null, h('td', null, h('b', null, d.name)), h('td', null, `${d.indicators.length} indicateur${d.indicators.length > 1 ? 's' : ''}`), h('td', { class: 'r num' }, h('b', null, `${d.score} / 100`)), h('td', null, d.label)));
  const bands = hl.explain.bands.map(([l, r, lv]) => h('span', { class: 'pill ' + lv }, `${l} · ${r}`));
  modal({ title: `Comment est calculé ton score de ${hl.score} / 100 ?`, width: 720, body: [
    h('p', { class: 'sec' }, `Chaque indicateur reçoit une note : ${g.good} points s’il est vert, ${g.warn} s’il est orange, ${g.bad} s’il est rouge. Le score d’un domaine est la moyenne de ses indicateurs${hl.domains.length > 1 ? ' ; le score global est la moyenne des domaines (chacun compte autant)' : ''}. Ici : ${hl.explain.nIndicators} indicateur${hl.explain.nIndicators > 1 ? 's' : ''} sur ${hl.explain.nDomains} domaine${hl.explain.nDomains > 1 ? 's' : ''}.`),
    h('div', { class: 'legend', style: { flexWrap: 'wrap', gap: '6px' } }, bands),
    hl.domains.length > 1 ? h('table', { class: 'tbl' }, h('tbody', null, dom)) : null,
    h('div', { class: 'grp' }, 'Détail indicateur par indicateur'),
    h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', null, 'Domaine'), h('th', null, 'Indicateur'), h('th', { class: 'r' }, 'Valeur'), h('th', null, 'État'), h('th', { class: 'r' }, 'Points'))), h('tbody', null, rows)),
    hl.actions.length ? [h('div', { class: 'grp' }, 'Pour gagner des points'), h('div', { class: 'actions' }, hl.actions.slice(0, 6).map((a) => h('div', { class: 'act' }, h('b', null, `+${fg(a.gain)} pt${a.gain > 1 ? 's' : ''}`), h('div', null, h('b', null, a.label), h('span', { class: 'sub' }, a.advice)))))]
      : h('div', { class: 'infobox' }, 'Tous les indicateurs sont au vert : rien à corriger.'),
    h('div', { class: 'note' }, 'Un score est un repère, pas un jugement : seuls les indicateurs pour lesquels tu as des données sont comptés. Il est recalculé à chaque changement.')],
  footer: [h('span', { class: 'sp' })] });
}

function healthCard() {
  const scope = S.activity;
  const hl = core.financialHealth(S, { scope, ...healthOpts() });
  const head = h('header', null, h('h2', null, 'Santé financière'), h('span', { class: 'sub' }, `${SCOPE_LABEL[scope] || ''} · 12 derniers mois`),
    hl.score != null ? h('div', { class: 'right' }, h('button', { class: 'btn sm ghost', type: 'button', onClick: () => openScoreExplain(hl) }, icon('info', 14), 'Comprendre mon score')) : null);
  if (hl.score == null) {
    return h('div', { class: 'card' }, head, empty('Pas encore d’indicateur', scope === 'Entreprise' ? 'L’entreprise n’a pas encore d’activité à analyser : les indicateurs apparaîtront dès les premières factures.' : scope === 'Bourse' ? 'Ajoute des titres dans Bourse pour voir la santé du portefeuille.' : 'Ajoute des opérations pour calculer ton score.'));
  }
  const multi = hl.domains.length > 1;
  const body = hl.domains.map((d) => h('div', { class: 'hgroup' },
    multi ? h('div', { class: 'grp hgrp' }, h('i', { class: 'adot ' + d.name }), d.name, h('span', { class: 'hgs ' + d.level }, `${d.score}/100`)) : null,
    h('div', { class: 'hind' }, d.indicators.map(indicatorRow))));
  const top = hl.actions.slice(0, 3);
  return h('div', { class: 'card' }, head,
    h('div', { class: 'health' }, scoreRing(hl.score, hl.level), h('div', null, h('div', { class: 'hlabel ' + hl.level }, hl.label, h('span', { class: 'hscore' }, ` ${hl.score} / 100`)),
      h('div', { class: 'muted' }, scope === 'Perso' || scope === 'Tout' ? `Revenus ${eur(hl.monthlyRev)}/mois · dépenses ${eur(hl.monthlyDep)}/mois` : `${hl.explain.nIndicators} indicateurs analysés`),
      h('div', { class: 'muted' }, `Score = moyenne de ${hl.explain.nIndicators} indicateur${hl.explain.nIndicators > 1 ? 's' : ''} (vert 100 · orange 60 · rouge 20)`))),
    top.length ? h('div', { class: 'hnext' }, h('b', null, 'À améliorer en priorité'), top.map((a) => h('div', null, h('span', { class: 'gain' }, `+${fg(a.gain)} pt${a.gain > 1 ? 's' : ''}`), h('b', null, a.label), ` — ${a.advice}`))) : h('div', { class: 'hnext ok' }, icon('check', 14), 'Tous les indicateurs sont au vert.'),
    body);
}

// ---------- Où je me situe (France / Maroc / monde) ----------
let CMP = null;
import('../compare.js').then((m) => { CMP = m; if (S.route === 'dashboard') emit(); }).catch(() => { /* module absent */ });
function compareCard() {
  if (!CMP || !CMP.compareIncome) return null;
  // revenu annuel net des 12 derniers mois complets (perso, hors investissements) ; patrimoine = dernier relevé + portefeuille de bourse
  const cur = S.today.slice(0, 7), from = addMonths(cur, -12);
  const rev = sum(S.data.tx.filter((t) => t.activite === 'Perso' && t.nature === 'Courant' && t.sens === 'Revenu' && t.date.slice(0, 7) >= from && t.date.slice(0, 7) < cur), (t) => t.montantEur);
  const dep = sum(S.data.tx.filter((t) => t.activite === 'Perso' && t.nature === 'Courant' && t.sens === 'Dépense' && t.date.slice(0, 7) >= from && t.date.slice(0, 7) < cur), (t) => t.montantEur);
  const last = S.data.snapshots.reduce((m, x) => (x.date > m ? x.date : m), '');
  const cash = last ? sum(S.data.snapshots.filter((x) => x.date === last), (x) => x.soldeEur) : 0;
  const pf = portfolioNow();
  const wealth = cash + (pf.total.value || 0);
  const fx = { MAD: S.P.taux, USD: S.fx.USD || 0.92 };
  const st = S.cmpPpp ? { ppp: true } : { ppp: false };
  if (!(rev > 0) && !(wealth > 0)) return null;
  const inc = rev > 0 ? CMP.compareIncome(rev, { fx, ...st }) : null, wea = wealth > 0 ? CMP.compareWealth(wealth, { fx, ...st }) : null;
  const rate = rev > 0 ? Math.max(-1, (rev - dep) / rev) : null;
  const sav = rate != null && CMP.compareSavings ? CMP.compareSavings(rate) : null;
  const cell = (r) => h('div', { class: 'cmpcell' }, h('div', { class: 'cmpfl' }, r.flag, ' ', r.label),
    h('div', { class: 'cmptop' }, r.topPct <= 50 ? `Top ${r.topPct < 1 ? '< 1' : r.topPct < 10 ? r.topPct.toFixed(1).replace('.', ',') : Math.round(r.topPct)} %` : `${Math.round(r.percentile * 100)} %`),
    h('div', { class: 'cmpsub' }, r.topPct <= 50 ? 'de la population (les plus aisés)' : 'de la population est en dessous de toi'),
    h('div', { class: 'cmpbar', title: `Tu dépasses ${Math.round(r.percentile * 100)} % de la population` }, h('i', { style: { width: Math.max(2, Math.min(100, r.percentile * 100)) + '%' } })),
    h('div', { class: 'cmpmed' }, r.ratioToMedian >= 10 ? `${Math.round(r.ratioToMedian)} × la médiane` : `${r.ratioToMedian.toFixed(1).replace('.', ',')} × la médiane`));
  const block = (title, sub, res) => res ? h('div', { class: 'cmpblock' }, h('div', { class: 'cmphead' }, h('b', null, title), h('span', { class: 'sub' }, sub)), h('div', { class: 'cmprow' }, res.zones.map(cell))) : null;
  return h('div', { class: 'card' }, h('header', null, h('h2', null, 'Où je me situe'), h('span', { class: 'sub' }, 'toi face à la population de la France, du Maroc et du monde'),
    h('div', { class: 'right' }, segmented([{ value: 'nom', label: 'Nominal' }, { value: 'ppp', label: 'Pouvoir d’achat' }], S.cmpPpp ? 'ppp' : 'nom', (v) => { S.cmpPpp = v === 'ppp'; emit(); }, 'sm'))),
    block('Revenus', `${eur(rev)} nets sur 12 mois`, inc), block('Patrimoine', `${eur(wealth)} (comptes + bourse)`, wea),
    sav ? h('div', { class: 'cmpsave' }, h('b', null, 'Taux d’épargne'), ' ', pct(rate), ' ', h('span', { class: 'sub' }, sav.zones.filter((z) => z.rate != null).map((z) => `${z.flag} ${z.in} : ${pct(z.rate, 1)} (${z.diffPts >= 0 ? '+' : ''}${String(z.diffPts).replace('.', ',')} pts)`).join(' · '))) : null,
    inc ? h('div', { class: 'note' }, CMP.explain(inc), ' ', 'Sources : INSEE (2024), HCP (2019, médiane estimée), Banque mondiale (2024), UBS Global Wealth (2022). Ton revenu net individuel est comparé à un revenu par personne : repère indicatif, pas une mesure exacte.') : null);
}

// ---------- Tableau de bord « Bourse » ----------
function renderBourse() {
  const pf = portfolioNow(), t = pf.total;
  if (!pf.positions.length) return h('div', { class: 'card' }, empty('Aucun titre pour l’instant', 'Ajoute tes achats dans l’écran Bourse : la valeur, la performance et la santé du portefeuille apparaissent ici.', h('a', { class: 'btn primary', href: '#/bourse' }, icon('plus', 16), 'Ouvrir Bourse')));
  const signed = (v, f = eur) => (v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${f(Math.abs(v))}`);
  const cls = (v) => (v == null ? 'muted' : v > 0 ? 'pos' : v < 0 ? 'neg' : 'muted');
  const kpis = h('div', { class: 'kpis' },
    kpi({ title: 'Valeur du portefeuille', ic: 'trend', value: eur(t.value), sub: [h('span', null, `${pf.open.length} ligne${pf.open.length > 1 ? 's' : ''} · coût ${eur(t.cost)}`)] }),
    kpi({ title: 'Plus-value latente', ic: 'chart', value: h('span', { class: cls(t.latent) }, signed(t.latent)), sub: [h('span', { class: 'delta ' + (t.latent >= 0 ? 'good' : 'bad') }, signed(t.cost ? t.latent / t.cost : 0, (x) => pct(x, 1)))] }),
    kpi({ title: 'Réalisé + dividendes', ic: 'wallet', value: h('span', { class: cls(t.realized + t.dividends) }, signed(t.realized + t.dividends)), sub: [h('span', null, `dividendes ${eur(t.dividends)}`)] }),
    kpi({ title: 'ROI global', ic: 'up', value: h('span', { class: cls(t.roi) }, t.roi == null ? '—' : signed(t.roi, (x) => pct(x, 1))), sub: [h('span', null, `sur ${eur(t.invested)} investis`)] }));
  const groups = new Map();
  for (const p of pf.open) { const k = sectorOf(p); groups.set(k, (groups.get(k) || 0) + (p.value ?? p.cost)); }
  const items = [...groups.entries()].sort((a, b) => b[1] - a[1]).map(([label, value], i) => ({ label, value, color: PALETTE[i % PALETTE.length] }));
  const alloc = h('div', { class: 'card' }, h('header', null, h('h2', null, 'Répartition par secteur'), h('div', { class: 'right' }, h('a', { class: 'btn sm ghost', href: '#/bourse' }, 'Détail', icon('right', 14)))),
    h('div', { class: 'alloc' }, donut(items, { center: eur(t.value) }), h('div', { class: 'legendv' }, items.map((i) => h('div', null, h('i', { style: { background: i.color } }), h('span', null, i.label), h('b', { class: 'num' }, pct(i.value / (t.value || 1))))))));
  const perf = h('div', { class: 'card' }, h('header', null, h('h2', null, 'Performance par titre'), h('span', { class: 'sub' }, 'ROI total, non annualisé')),
    barList(pf.positions.filter((p) => p.roi != null).sort((a, b) => b.roi - a.roi).map((p) => ({ label: p.nom, value: p.roi, color: p.roi >= 0 ? 'var(--good)' : 'var(--crit)' })), { fmt: (v) => signed(v, (x) => pct(x, 1)) }));
  const os = [...(S.data.ordres || [])].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 8);
  const last = h('div', { class: 'card' }, h('header', null, h('h2', null, 'Derniers ordres'), h('div', { class: 'right' }, h('a', { class: 'btn sm ghost', href: '#/bourse' }, 'Tout voir', icon('right', 14)))),
    h('table', { class: 'tbl' }, h('tbody', null, os.map((o) => h('tr', null, h('td', { style: { color: 'var(--ink-3)', width: '90px' } }, fmtDate(o.date).replace(/ \d{4}$/, '')), h('td', null, o.nom || o.symbole, h('span', { class: 'sub' }, `${o.symbole} · ${o.compte}`)),
      h('td', null, h('span', { class: 'pill ' + (o.sens === 'Achat' ? 'info' : o.sens === 'Vente' ? 'warn' : 'good') }, o.sens)), h('td', { class: 'r num' }, o.quantite ? `${o.quantite} × ${o.prix}` : String(o.prix)))))));
  return [kpis, h('div', { class: 'row2e' }, healthCard(), alloc), h('div', { class: 'row2e' }, perf, last)];
}
