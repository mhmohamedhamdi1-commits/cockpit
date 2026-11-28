import { h, icon, eur, money, num0, num2, curSym } from '../util.js';
import { S } from '../state.js';
import { iconOf, weight } from '../calc.js';

export const actDot = (a) => h('i', { class: 'adot ' + a, title: a });
export const catChip = (t) => h('span', { class: 'chip' }, iconOf(t), t.categorie);
export function amountEl(t, { showEur = true } = {}) {
  const sign = t.sens === 'Revenu' ? '+' : '−';
  const cls = t.nature === 'Courant' ? (t.sens === 'Revenu' ? 'pos' : '') : 'muted';
  const main = `${sign}${t.montant % 1 ? num2(t.montant) : num0(t.montant)} ${curSym(t.devise)}`;
  return h('div', { class: 'num', style: { textAlign: 'right', fontWeight: 650 } }, h('span', { class: cls }, main),
    t.devise !== 'EUR' && showEur ? h('span', { class: 'sub muted', style: { display: 'block', fontSize: '12px', fontWeight: 450 } }, `≈ ${eur(t.montantEur)}`) : null);
}
export function natureBadge(t) {
  if (t.nature === 'Courant') return null;
  return h('span', { class: 'pill mute', title: t.nature === 'Investissement' ? 'Investissement : hors résultat' : 'Financement : hors résultat' }, t.nature);
}
export function delta(cur, prev, { inverse = false } = {}) {
  if (!prev || !isFinite(prev) || Math.abs(prev) < 1) return null;
  const d = (cur - prev) / Math.abs(prev);
  if (Math.abs(d) > 9.99) return null;
  if (Math.abs(d) < 0.005) return h('span', { class: 'delta flat' }, '= stable');
  const up = d > 0, good = inverse ? !up : up;
  return h('span', { class: 'delta ' + (good ? 'good' : 'bad') }, icon(up ? 'up' : 'down', 12), Math.abs(Math.round(d * 100)) + ' %');
}
export function kpi({ title, value, sub, spark, ic }) {
  return h('div', { class: 'card kpi' }, spark || null, h('div', { class: 't' }, ic ? icon(ic, 15) : null, title), h('div', { class: 'v num' }, value), h('div', { class: 'd' }, sub));
}
