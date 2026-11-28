import { test } from 'node:test';
import assert from 'node:assert/strict';
import { futureValue, monthsToTarget, requiredMonthly, projectSeries, fireTarget, goalStatus, addMonthsTo } from '../app/js/goals-calc.js';

test('valeur future : sans rendement, versements simples ; avec rendement, intérêts composés', () => {
  assert.equal(futureValue(1000, 100, 0, 12), 2200);
  // 10 000 € à 5 %/an pendant 10 ans, sans versement : 10 000 × 1,05^10
  assert.ok(Math.abs(futureValue(10000, 0, 0.05, 120) - 16288.95) < 0.01);
  assert.ok(futureValue(0, 200, 0.05, 120) > 200 * 120);
});
test('mois pour atteindre une cible et versement nécessaire sont cohérents', () => {
  assert.equal(monthsToTarget(5000, 0, 0.05, 4000), 0);
  assert.equal(monthsToTarget(0, 0, 0.0, 1000), null);
  const n = monthsToTarget(1000, 500, 0.03, 20000);
  assert.ok(futureValue(1000, 500, 0.03, n) >= 20000 && futureValue(1000, 500, 0.03, n - 1) < 20000);
  const m = requiredMonthly(1000, 20000, 0.03, 36);
  assert.ok(Math.abs(futureValue(1000, m, 0.03, 36) - 20000) < 0.5);
  assert.equal(requiredMonthly(30000, 20000, 0.03, 24), 0);
  assert.equal(Math.round(requiredMonthly(0, 12000, 0, 12)), 1000);
});
test('courbe, indépendance financière, état d\'un objectif', () => {
  const s = projectSeries(1000, 100, 0.04, 10, 0.02);
  assert.equal(s.length, 11); assert.equal(s[0].value, 1000); assert.ok(s[10].real < s[10].value && s[10].value > s[10].paid);
  assert.equal(fireTarget(24000), 600000); assert.equal(fireTarget(24000, 0.03), 800000);
  assert.equal(addMonthsTo('2026-11-28', 3), '2027-02'); assert.equal(addMonthsTo('2026-01-31', 13), '2027-02');
  const g = goalStatus({ current: 10000, target: 20000, monthly: 500, rate: 0, deadline: '2028-11-01', today: '2026-11-28' });
  assert.equal(g.progress, 0.5); assert.equal(g.months, 20); assert.equal(g.reachedAt, '2028-07'); assert.equal(g.monthsLeft, 24);
  assert.equal(Math.round(g.needed), 417); assert.equal(g.onTrack, true);
  assert.equal(goalStatus({ current: 20, target: 10, today: '2026-01-01' }).done, true);
});
