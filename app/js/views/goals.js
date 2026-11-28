// Objectifs et projections (à la Finary) : objectifs d'épargne / patrimoine avec date d'atteinte, simulateur de patrimoine futur,
// indépendance financière (règle des 4 %), revenus passifs (dividendes + loyers) face aux dépenses.
import { h, icon, eur, pct, fmtDate, sum, addMonths, parseAmount, monthLong } from '../util.js';
import { S, ops, upsert, del, emit } from '../state.js';
import { modal, field, select, confirmBox, empty, toast } from '../ui.js';
import { seriesChart } from '../charts.js';
import { kpi } from './common.js';
import { netWorthParts, ensureQuotes } from '../market.js';
import { goalStatus, projectSeries, fireTarget, monthsToTarget, futureValue, addMonthsTo } from '../goals-calc.js';

export function meta() { return { title: 'Objectifs', sub: 'Projections, indépendance financière et revenus passifs', period: false, immoToggle: false }; }
export function badge() { return 0; }

const SIM = { monthly: null, rate: 5, years: 30, inflation: 2, swr: 4 };
const TYPES = ['Patrimoine', 'Épargne', 'Bourse', 'Immobilier', 'Autre'];

// valeur actuelle d'un objectif selon son type
function currentOf(g, nw) {
  if (g.type === 'Patrimoine') return nw.net;
  if (g.type === 'Épargne') return nw.liquide;
  if (g.type === 'Bourse') return nw.bourse;
  if (g.type === 'Immobilier') return nw.immo;
  return g.depart;
}
const toEurCur = (v, cur) => v * (cur === 'EUR' ? 1 : cur === 'MAD' ? S.P.taux : S.fx[cur] || 1);

// Moyennes sur les 12 derniers mois complets
function flows() {
  const cur = S.today.slice(0, 7), from = addMonths(cur, -12);
  const inWin = (t) => { const m = t.date.slice(0, 7); return m >= from && m < cur; };
  const rev = sum(S.data.tx.filter((t) => t.activite === 'Perso' && t.nature === 'Courant' && t.sens === 'Revenu' && inWin(t)), (t) => t.montantEur);
  const dep = sum(S.data.tx.filter((t) => t.activite === 'Perso' && t.nature === 'Courant' && t.sens === 'Dépense' && inWin(t)), (t) => t.montantEur);
  const divs = sum((S.data.ordres || []).filter((o) => o.sens === 'Dividende' && o.date.slice(0, 7) >= from && o.date.slice(0, 7) < cur), (o) => (o.quantite ? o.quantite * o.prix : o.prix) * (o.devise === 'EUR' ? 1 : o.devise === 'MAD' ? S.P.taux : S.fx[o.devise] || 1));
  // loyers nets (revenus − charges courantes des projets, ma part) en euros
  let immo = 0;
  for (const p of (S.data.projets || []).filter((x) => (x.type || 'Immobilier') === 'Immobilier')) {
    const w = Number(p.part);
    immo += sum(S.data.tx.filter((t) => t.projetId === p.id && t.nature === 'Courant' && inWin(t)), (t) => (t.sens === 'Revenu' ? 1 : -1) * t.montantEur * w);
  }
  return { rev, dep, save: rev - dep, divs, immo, passive: divs + Math.max(0, immo) };
}

function openGoal(g = {}) {
  const editing = !!g.id;
  const nom = h('input', { type: 'text', value: g.nom || '', placeholder: 'ex. Apport pour l’appartement' });
  const type = select(TYPES, g.type || 'Patrimoine');
  const cible = h('input', { type: 'text', inputmode: 'decimal', value: g.cible ? String(g.cible).replace('.', ',') : '' });
  const dev = select(['EUR', 'MAD', 'USD', 'GBP', 'CHF'], g.devise || 'EUR');
  const ech = h('input', { type: 'date', value: g.echeance || '' });
  const depart = h('input', { type: 'text', inputmode: 'decimal', value: g.depart ? String(g.depart).replace('.', ',') : '', placeholder: '0' });
  const men = h('input', { type: 'text', inputmode: 'decimal', value: g.mensuel ? String(g.mensuel).replace('.', ',') : '', placeholder: 'ex. 500' });
  const rend = h('input', { type: 'number', step: 0.5, value: g.rendement ? Math.round(g.rendement * 1000) / 10 : 3 });
  const err = h('div', { class: 'err' });
  const m = modal({ title: editing ? 'Modifier l’objectif' : 'Nouvel objectif', width: 560, body: [
    field('Nom', nom), h('div', { class: 'grid2' }, field('Type', type, 'Patrimoine, épargne disponible, bourse ou immobilier : la progression est calculée automatiquement ; « Autre » : valeur de départ saisie'), field('Devise', dev)),
    h('div', { class: 'grid2' }, field('Montant à atteindre', cible), field('Échéance (facultatif)', ech)),
    h('div', { class: 'grid3' }, field('Valeur de départ (type « Autre »)', depart), field('Versement mensuel prévu', men), field('Rendement annuel espéré (%)', rend)), err],
  footer: [editing ? h('button', { class: 'btn danger', onClick: async () => { if (await confirmBox(`Supprimer l’objectif « ${g.nom} » ?`, { ok: 'Supprimer', danger: true })) { if (await ops([del('objectif', g.id)], 'Objectif supprimé')) m.close(); } } }, icon('trash', 15), 'Supprimer') : null,
    h('span', { class: 'sp' }), h('button', { class: 'btn', onClick: () => m.close() }, 'Annuler'),
    h('button', { class: 'btn primary lg', onClick: async () => {
      if (!nom.value.trim()) { err.textContent = 'Donne un nom à l’objectif.'; return; }
      if (!(parseAmount(cible.value) > 0)) { err.textContent = 'Indique le montant à atteindre.'; return; }
      if (await ops([upsert('objectif', { ...g, id: g.id || 0, nom: nom.value.trim(), type: type.value, cible: parseAmount(cible.value), devise: dev.value, echeance: ech.value, depart: parseAmount(depart.value), mensuel: parseAmount(men.value), rendement: (+rend.value || 0) / 100, actif: 'Oui' })], editing ? 'Objectif modifié' : 'Objectif créé')) m.close();
    } }, 'Enregistrer')] });
}

function goalCard(g, nw) {
  const cur = toEurCur0(currentOf(g, nw), g);
  const st = goalStatus({ current: cur, target: g.cible, monthly: g.mensuel, rate: g.rendement, deadline: g.echeance, today: S.today });
  const fmt = (v) => `${Math.round(v).toLocaleString('fr-FR').replace(/\s/g, ' ')} ${g.devise === 'EUR' ? '€' : g.devise}`;
  const verdict = st.done ? h('span', { class: 'pill good' }, icon('check', 13), 'Atteint') : st.onTrack === true ? h('span', { class: 'pill good' }, 'Dans les temps') : st.onTrack === false ? h('span', { class: 'pill warn' }, 'En retard sur l’échéance') : st.reachedAt ? h('span', { class: 'pill info' }, `Atteint vers ${monthLong(st.reachedAt)}`) : h('span', { class: 'pill mute' }, 'Pas de date possible');
  return h('div', { class: 'card goal' }, h('header', null, h('h2', null, g.nom), h('span', { class: 'sub' }, g.type), h('div', { class: 'right' }, verdict, h('button', { class: 'btn sm ghost', onClick: () => openGoal(g) }, icon('edit', 14)))),
    h('div', { class: 'thr', style: { margin: '2px 0 6px' } }, h('div', { class: 'track' }, h('div', { class: 'seg1', style: { width: Math.round(st.progress * 100) + '%' } }))),
    h('div', { class: 'legend', style: { flexWrap: 'wrap' } }, h('span', { style: { fontWeight: 700 } }, `${fmt(cur)} sur ${fmt(g.cible)} (${Math.round(st.progress * 100)} %)`),
      g.echeance ? h('span', null, `échéance ${fmtDate(g.echeance)}`) : null),
    h('div', { class: 'note', style: { marginTop: '6px' } }, [
      st.reachedAt && !st.done ? `Au rythme prévu (${fmt(g.mensuel)}/mois${g.rendement ? `, ${(g.rendement * 100).toFixed(1).replace('.', ',')} %/an` : ''}) : atteint vers ${monthLong(st.reachedAt)}. ` : '',
      g.echeance && !st.done ? `Pour y être le ${fmtDate(g.echeance)} : ${fmt(st.needed)} par mois (projection à l’échéance : ${fmt(st.projectedAtDeadline)}).` : ''].join('')));
}
const toEurCur0 = (v, g) => (g.type === 'Autre' ? v : g.devise === 'EUR' ? v : v / (g.devise === 'MAD' ? S.P.taux : S.fx[g.devise] || 1));

export function render() {
  ensureQuotes();
  const nw = netWorthParts(), fl = flows();
  const goals = (S.data.objectifs || []).filter((g) => g.actif !== 'Non');
  const monthlyDep = fl.dep / 12, passiveM = fl.passive / 12;
  const cover = monthlyDep > 0 ? passiveM / monthlyDep : null;
  const kpis = h('div', { class: 'kpis' },
    kpi({ title: 'Patrimoine net', ic: 'bank', value: eur(nw.net), sub: [h('span', null, `comptes ${eur(nw.comptes)} + bourse ${eur(nw.bourse)}`)] }),
    kpi({ title: 'Avec l’immobilier (ma part)', ic: 'building', value: eur(nw.global), sub: [h('span', null, `immobilier ${eur(nw.immo)} (valeur estimée ou prix de revient)`)] }),
    kpi({ title: 'Épargne mensuelle moyenne', ic: 'wallet', value: h('span', { class: fl.save >= 0 ? '' : 'neg' }, eur(fl.save / 12)), sub: [h('span', null, '12 derniers mois, perso')] }),
    kpi({ title: 'Revenus passifs', ic: 'trend', value: eur(passiveM) + ' / mois', sub: [h('span', { class: 'delta ' + (cover >= 1 ? 'good' : 'flat') }, cover == null ? '—' : pct(cover) + ' des dépenses'), h('span', null, 'dividendes + loyers nets (ma part)')] }));

  const goalsBox = h('div', { class: 'card' }, h('header', null, h('h2', null, 'Mes objectifs'), h('div', { class: 'right' }, h('button', { class: 'btn primary', onClick: () => openGoal() }, icon('plus', 16), 'Nouvel objectif'))),
    goals.length ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } }, goals.map((g) => goalCard(g, nw)))
      : empty('Aucun objectif', 'Fixe-toi un cap (apport, patrimoine, bourse…) : Cockpit calcule la date d’atteinte et le versement mensuel nécessaire.', h('button', { class: 'btn primary', onClick: () => openGoal() }, icon('plus', 16), 'Créer mon premier objectif')));

  // simulateur
  if (SIM.monthly == null) SIM.monthly = Math.max(0, Math.round(fl.save / 12 / 10) * 10) || 500;
  const num = (k, props = {}) => { const el = h('input', { type: 'number', value: SIM[k], ...props }); el.addEventListener('change', () => { SIM[k] = +el.value; emit(); }); return el; };
  const series = projectSeries(nw.net, SIM.monthly, SIM.rate / 100, SIM.years, SIM.inflation / 100);
  const target = fireTarget(monthlyDep * 12 || 0, SIM.swr / 100);
  const months = target ? monthsToTarget(nw.net, SIM.monthly, SIM.rate / 100, target, 12 * 80) : null;
  const labels = series.map((p) => ({ key: String(p.year), label: p.year % 5 === 0 || p.year === series.length - 1 ? String(+S.today.slice(0, 4) + p.year) : '', full: `${+S.today.slice(0, 4) + p.year} (dans ${p.year} an${p.year > 1 ? 's' : ''})` }));
  const sim = h('div', { class: 'card' }, h('header', null, h('h2', null, 'Simulateur de patrimoine'), h('span', { class: 'sub' }, 'à partir de ton patrimoine net actuel')),
    h('div', { class: 'grid3' }, field('Versement mensuel (€)', num('monthly', { step: 50, min: 0 })), field('Rendement annuel (%)', num('rate', { step: 0.5 })), field('Horizon (années)', num('years', { step: 1, min: 1, max: 60 }))),
    h('div', { class: 'grid3' }, field('Inflation (%)', num('inflation', { step: 0.5 })), field('Taux de retrait (%)', num('swr', { step: 0.5, min: 1 }), 'Règle des 4 % : on peut retirer 4 % du capital par an'), h('div', null)),
    seriesChart({ labels, type: 'line', title: 'Patrimoine projeté', series: [{ name: 'Patrimoine', color: '#007AFF', values: series.map((p) => Math.round(p.value)) }, { name: 'En pouvoir d’achat d’aujourd’hui', color: '#AF52DE', values: series.map((p) => Math.round(p.real)) }, { name: 'Versements cumulés', color: '#8E8E93', values: series.map((p) => Math.round(p.paid)) }] }),
    h('div', { class: 'cashlist', style: { marginTop: '10px' } },
      h('div', { class: 'cashrow' }, h('div', null, h('b', null, `Dans ${SIM.years} ans`), h('span', { class: 'sub' }, `${eur(series[series.length - 1].paid)} versés dont ${eur(series[series.length - 1].value - series[series.length - 1].paid)} d’intérêts`)), h('div', { class: 'num v' }, eur(series[series.length - 1].value))),
      target ? h('div', { class: 'cashrow total' }, h('div', null, h('b', null, 'Indépendance financière'), h('span', { class: 'sub' }, `${eur(monthlyDep * 12)} de dépenses par an ÷ ${SIM.swr} % = ${eur(target)} de capital`)),
        h('div', { class: 'num v' }, months == null ? 'hors de portée' : months === 0 ? 'atteinte' : monthLong(addMonthsTo(S.today, months)))) : null),
    h('div', { class: 'note', style: { marginTop: '8px' } }, 'Projection théorique à rendement constant, hors impôts et frais : ce n’est pas une promesse de performance.'));

  // revenus passifs
  const pass = h('div', { class: 'card' }, h('header', null, h('h2', null, 'Revenus passifs'), h('span', { class: 'sub' }, '12 derniers mois complets')),
    h('div', { class: 'cashlist' },
      h('div', { class: 'cashrow' }, h('div', null, h('b', null, 'Dividendes de bourse'), h('span', { class: 'sub' }, `rendement ${nw.bourse > 0 ? pct(fl.divs / nw.bourse, 1) : '—'} de la valeur du portefeuille`)), h('div', { class: 'num v' }, eur(fl.divs))),
      h('div', { class: 'cashrow' }, h('div', null, h('b', null, 'Loyers nets (immobilier)'), h('span', { class: 'sub' }, 'revenus − charges courantes, ma part')), h('div', { class: 'num v' }, eur(fl.immo))),
      h('div', { class: 'cashrow total' }, h('div', null, h('b', null, 'Total par mois'), h('span', { class: 'sub' }, cover == null ? '' : `couvre ${pct(cover)} de tes dépenses mensuelles (${eur(monthlyDep)})`)), h('div', { class: 'num v' }, eur(passiveM)))));
  return [kpis, goalsBox, h('div', { class: 'row2e' }, sim, pass)];
}
