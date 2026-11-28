// Projections d'objectifs et d'indépendance financière (calculs purs). Taux annuels en fraction (0,05 = 5 %).
const monthlyRate = (annual) => Math.pow(1 + annual, 1 / 12) - 1;

// Valeur après n mois : capital initial c, versement mensuel m en fin de mois, rendement annuel r
export function futureValue(c, m, r, n) {
  const i = monthlyRate(r);
  if (Math.abs(i) < 1e-12) return c + m * n;
  return c * Math.pow(1 + i, n) + m * ((Math.pow(1 + i, n) - 1) / i);
}
// Nombre de mois pour atteindre la cible (null si inatteignable avant `max` mois)
export function monthsToTarget(c, m, r, target, max = 1200) {
  if (c >= target) return 0;
  const i = monthlyRate(r);
  let v = c;
  for (let n = 1; n <= max; n++) { v = v * (1 + i) + m; if (v >= target) return n; if (n > 12 && v <= c && m <= 0 && i <= 0) return null; }
  return null;
}
// Versement mensuel nécessaire pour atteindre la cible en n mois
export function requiredMonthly(c, target, r, n) {
  if (n <= 0) return Math.max(0, target - c);
  const i = monthlyRate(r), grown = c * Math.pow(1 + i, n);
  if (grown >= target) return 0;
  return Math.abs(i) < 1e-12 ? (target - c) / n : ((target - grown) * i) / (Math.pow(1 + i, n) - 1);
}
// Courbe annuelle : valeur nominale, versements cumulés, et valeur en pouvoir d'achat d'aujourd'hui (inflation)
export function projectSeries(c, m, r, years, inflation = 0) {
  const out = [];
  for (let y = 0; y <= years; y++) {
    const n = y * 12;
    out.push({ year: y, value: futureValue(c, m, r, n), paid: c + m * n, real: futureValue(c, m, r, n) / Math.pow(1 + inflation, y) });
  }
  return out;
}
// Capital d'indépendance financière : dépenses annuelles / taux de retrait (règle des 4 % par défaut)
export const fireTarget = (annualExpenses, swr = 0.04) => (swr > 0 ? annualExpenses / swr : null);
// Addition de mois à une date AAAA-MM-JJ → AAAA-MM
export function addMonthsTo(date, n) {
  const y = +date.slice(0, 4), m = +date.slice(5, 7) - 1 + n;
  return `${y + Math.floor(m / 12)}-${String(((m % 12) + 12) % 12 + 1).padStart(2, '0')}`;
}
// État d'un objectif : progression, mois restants, date projetée, versement nécessaire à l'échéance
export function goalStatus({ current, target, monthly = 0, rate = 0, deadline = '', today }) {
  const progress = target > 0 ? Math.min(1, Math.max(0, current / target)) : 0;
  const months = monthsToTarget(current, monthly, rate, target);
  const reachedAt = months == null ? null : addMonthsTo(today, months);
  let monthsLeft = null, needed = null, projectedAtDeadline = null, onTrack = null;
  if (deadline) {
    monthsLeft = Math.max(0, (+deadline.slice(0, 4) - +today.slice(0, 4)) * 12 + (+deadline.slice(5, 7) - +today.slice(5, 7)));
    needed = requiredMonthly(current, target, rate, monthsLeft);
    projectedAtDeadline = futureValue(current, monthly, rate, monthsLeft);
    onTrack = projectedAtDeadline >= target;
  }
  return { progress, months, reachedAt, monthsLeft, needed, projectedAtDeadline, onTrack, done: current >= target };
}
