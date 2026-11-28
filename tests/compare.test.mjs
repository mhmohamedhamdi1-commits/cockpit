// Tests du module « Où je me situe » (app/js/compare.js) : percentiles, conversions, textes, sources.
// Lancement : node --test tests/compare.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COUNTRIES, DATA, percentileOf, priceFactor, compareIncome, compareWealth, compareSavings, explain,
} from '../app/js/compare.js';

const fx = { MAD: 0.093, USD: 0.86 }; // 1 MAD = 0,093 €, 1 USD = 0,86 €
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} attendu ≈ ${b}, obtenu ${a}`);
const allDists = () => [
  ...Object.values(DATA.income).map((d) => ['revenu', d]),
  ...Object.values(DATA.wealth).map((d) => ['patrimoine', d]),
];
const flat = (s) => s.replace(/[  ]/g, ' ');

test('COUNTRIES : FR, MA, WORLD avec libellé, drapeau et devise', () => {
  assert.deepEqual(COUNTRIES.map((c) => c.code), ['FR', 'MA', 'WORLD']);
  for (const c of COUNTRIES) assert.ok(c.label && c.flag && c.currency, c.code);
  assert.deepEqual(COUNTRIES.map((c) => c.currency), ['EUR', 'MAD', 'USD']);
});

test('chaque jeu de données a une source, une année et une URL', () => {
  for (const [kind, d] of allDists()) {
    assert.ok(typeof d.source === 'string' && d.source.length > 10, `${kind} ${d.code} : source`);
    assert.ok(Number.isInteger(d.year) && d.year >= 2019 && d.year <= DATA.refYear, `${kind} ${d.code} : année`);
    assert.match(d.url, /^https:\/\//, `${kind} ${d.code} : url`);
    assert.ok(['deciles', 'lognormal'].includes(d.method), `${kind} ${d.code} : méthode`);
    assert.ok(d.median > 0, `${kind} ${d.code} : médiane`);
  }
  for (const code of ['FR', 'MA', 'EA']) {
    const s = DATA.savings[code];
    assert.ok(s.source && s.year && s.url && s.rate > 0 && s.rate < 1, `épargne ${code}`);
  }
  assert.equal(DATA.savings.WORLD.rate, null); // pas de moyenne mondiale homogène : assumé, pas inventé
  for (const k of ['ppp', 'inflation']) assert.ok(DATA[k].source && DATA[k].year && DATA[k].url, k);
});

test('points des distributions triés et strictement croissants (valeurs et probabilités)', () => {
  for (const [kind, d] of allDists()) {
    const pts = d.points;
    for (let i = 1; i < pts.length; i++) {
      assert.ok(pts[i].v > pts[i - 1].v && pts[i].p > pts[i - 1].p, `${kind} ${d.code} point ${i}`);
    }
  }
});

test('ancrages : la médiane donne 50 %, chaque décile publié est restitué', () => {
  for (const [kind, d] of allDists()) {
    near(percentileOf(d.median, d), 0.5, 0.005, `${kind} ${d.code} médiane`);
    for (const { p, v } of d.points) {
      if (v > 0) near(percentileOf(v, d), p, d.method === 'lognormal' ? 0.003 : 1e-9, `${kind} ${d.code} P${p * 100}`);
    }
  }
  near(percentileOf(48580, DATA.income.FR), 0.9, 1e-9, 'France D9');
  near(percentileOf(41705, DATA.income.MA), 0.9, 0.002, 'Maroc P90');
  near(percentileOf(6270, DATA.income.MA), 0.1, 0.002, 'Maroc P10');
});

test('monotonie : plus de revenu ou de patrimoine ⇒ percentile plus haut (ou égal au plafond)', () => {
  for (const [kind, d] of allDists()) {
    let prev = -1;
    for (let v = -10000; v <= 2e8; v = v < 1000 ? v + 500 : v * 1.07) {
      const p = percentileOf(v, d);
      assert.ok(p >= prev - 1e-12, `${kind} ${d.code} non monotone en ${v} (${prev} → ${p})`);
      assert.ok(p >= 0 && p <= 0.9999, `${kind} ${d.code} hors bornes en ${v}`);
      prev = p;
    }
  }
  for (const make of [(x) => compareIncome(x, { fx }), (x) => compareWealth(x, { fx }), (x) => compareIncome(x, { fx, ppp: true })]) {
    const a = make(20000).zones;
    const b = make(60000).zones;
    a.forEach((z, i) => assert.ok(b[i].percentile > z.percentile, `${z.code} : 60 k > 20 k`));
  }
});

test('cas limites : 0, négatif, très élevé, NaN', () => {
  for (const [kind, d] of allDists()) {
    assert.equal(percentileOf(-50000, d), 0, `${kind} ${d.code} négatif`);
    assert.equal(percentileOf(1e12, d), 0.9999, `${kind} ${d.code} très élevé : borné à 0,9999`);
    assert.equal(percentileOf(Infinity, d), 0.9999, `${kind} ${d.code} infini`);
    assert.ok(Number.isNaN(percentileOf(NaN, d)), `${kind} ${d.code} NaN`);
  }
  for (const d of Object.values(DATA.income)) assert.equal(percentileOf(0, d), 0, `revenu ${d.code} nul`);
  // Patrimoine mondial : le P10 est négatif (−168 $), un patrimoine nul dépasse donc ~11 % des adultes.
  near(percentileOf(0, DATA.wealth.WORLD), 0.116, 0.002, 'patrimoine nul (monde)');
  // Au-delà du P99 : extrapolation de Pareto, strictement entre P99 et le plafond.
  const w = DATA.income.WORLD;
  const p = percentileOf(90000, w);
  assert.ok(p > 0.99 && p < 0.9999, `Pareto au-delà du P99 : ${p}`);
  // France : P99 extrapolé ≈ 105 k€ (Pareto P90–P95), cohérent avec le seuil Filosofi 2021 revalorisé.
  near(percentileOf(104700, DATA.income.FR), 0.99, 0.001, 'France P99 extrapolé');
  const z = compareIncome(0, { fx }).zones;
  assert.ok(z.every((x) => x.percentile === 0 && x.topPct === 100));
  const big = compareIncome(5e7, { fx }).zones;
  assert.ok(big.every((x) => x.percentile === 0.9999 && x.topPct === 0.01));
});

test('log-normale : forme et queue de Pareto continue', () => {
  const d = { method: 'lognormal', median: 1000, sigma: 0.5 };
  near(percentileOf(1000, d), 0.5, 1e-7);
  near(percentileOf(1000 * Math.exp(0.5 * 1.2815516), d), 0.9, 1e-6);
  near(percentileOf(1000 * Math.exp(-0.5 * 1.2815516), d), 0.1, 1e-6);
  const m = DATA.income.MA;
  near(percentileOf(m.tail.v * 0.9999, m), percentileOf(m.tail.v * 1.0001, m), 1e-4, 'continuité au raccord');
  // Paramètres cohérents avec les chiffres publiés (P10/P90) : σ = ln(P90/P10)/(2·1,28155), médiane = √(P10·P90).
  near(m.sigma, Math.log(41705 / 6270) / (2 * 1.2815516), 1e-4);
  near(m.median, Math.sqrt(6270 * 41705), 1);
  near(m.median * Math.exp(m.sigma ** 2 / 2), m.mean, 0.02 * m.mean, 'moyenne implicite ≈ moyenne publiée');
});

test('cohérence des unités : conversions EUR → MAD / USD (nominal et PPA)', () => {
  const r = compareIncome(52000, { fx, inflation: false });
  const [frz, ma, wo] = r.zones;
  assert.equal(frz.value, 52000);
  assert.equal(frz.currency, 'EUR');
  near(ma.value, 52000 / 0.093, 1e-6, 'MAD');
  assert.equal(ma.currency, 'MAD');
  near(wo.value, 52000 / 0.86, 1e-6, 'USD');
  assert.equal(wo.currency, 'USD');
  near(ma.ratioToMedian, ma.value / ma.medianLocal, 1e-9);
  near(ma.medianEur, DATA.income.MA.median * 0.093, 1e-6);
  // PPA : 1 € vaut PPP.MA / PPP.FR dirhams « de pouvoir d'achat » et 1 / PPP.FR dollars internationaux.
  const p = compareIncome(52000, { fx, ppp: true, inflation: false }).zones;
  near(p[1].value, (52000 / DATA.ppp.FR) * DATA.ppp.MA, 1e-6);
  near(p[2].value, 52000 / DATA.ppp.FR, 1e-6);
  assert.equal(compareIncome(52000, { ppp: true }).zones.length, 3, 'le mode PPA du revenu n’exige pas de taux de change');
  // Revalorisation de l'inflation : la médiane affichée est la médiane publiée × facteur de prix.
  const inf = compareIncome(52000, { fx }).zones[0];
  near(inf.medianLocal, 26740 * priceFactor('FR', 2024), 1e-6);
  near(priceFactor('FR', 2024, 2026), 1.009 * 1.024, 1e-9);
  assert.equal(priceFactor('FR', 2026, 2026), 1);
  // Patrimoine : distributions en USD
  const w = compareWealth(100000, { fx }).zones;
  assert.ok(w.every((z) => z.currency === 'USD'));
  near(w[0].value, 100000 / 0.86, 1e-6);
  near(w[0].valueEur, 100000, 1e-6);
  near(w[0].medianEur, 133137 * 0.86, 1e-6);
  const wp = compareWealth(100000, { fx, ppp: true }).zones;
  near(wp[1].value, (100000 / DATA.ppp.FR) * DATA.ppp.MA * 0.093 / 0.86, 1e-6, 'Maroc PPA');
  near(wp[2].value, 100000 / DATA.ppp.FR, 1e-6, 'monde PPA');
  assert.throws(() => compareIncome(52000, {}), /fx\.MAD/);
  assert.throws(() => compareWealth(1000, { fx: { MAD: 0.093 } }), /fx\.USD/);
});

test('champs retournés par zone', () => {
  for (const res of [compareIncome(40000, { fx }), compareWealth(80000, { fx })]) {
    assert.equal(res.zones.length, 3);
    for (const z of res.zones) {
      for (const k of ['code', 'label', 'flag', 'value', 'percentile', 'topPct', 'medianLocal', 'ratioToMedian', 'method', 'year', 'source']) {
        assert.ok(z[k] !== undefined && z[k] !== null, `${res.kind} ${z.code}.${k}`);
      }
      near(z.topPct, (1 - z.percentile) * 100, Math.max(0.6, z.topPct * 0.06), `${z.code} topPct`);
    }
  }
});

test('explain : phrases françaises', () => {
  const s = flat(explain(compareIncome(52000, { fx })));
  assert.match(s, /^Avec 52 000 € nets par an, tu fais partie des [\d,]+ % les mieux rémunérés en France, des [\d,]+ % au Maroc et des [\d,]+ % dans le monde \(valeurs nominales\)\.$/);
  const low = flat(explain(compareIncome(15000, { fx })));
  assert.match(low, /tu dépasses \d+ % de la population en France/);
  assert.match(low, /au Maroc/);
  assert.match(flat(explain(compareIncome(52000, { fx, ppp: true }))), /\(en parité de pouvoir d’achat\)\.$/);
  assert.match(flat(explain(compareIncome(0, { fx }))), /tout en bas de l'échelle en France, au Maroc et dans le monde/);
  const w = flat(explain(compareWealth(150000, { fx })));
  assert.match(w, /^Avec un patrimoine net de 150 000 €, tu fais partie des [\d,]+ % les plus fortunés en France/);
  assert.match(flat(explain(compareWealth(-2000, { fx }))), /−2 000 €/);
  const sv = flat(explain(compareSavings(0.25)));
  assert.equal(sv, "Ton taux d'épargne de 25 % est supérieur à la moyenne des ménages en France (17,9 %), au Maroc (11,3 %) et dans la zone euro (15,2 %).");
  assert.match(flat(explain(compareSavings(14))), /supérieur .* au Maroc .* mais inférieur ou égal .* en France/);
  assert.equal(explain(null), '');
});

test('compareSavings : écarts en points et lecture des pourcentages', () => {
  const r = compareSavings(0.2);
  assert.equal(r.rate, 0.2);
  assert.deepEqual(r.zones.map((z) => z.code), ['FR', 'MA', 'EA']);
  assert.equal(r.zones[0].diffPts, 2.1);
  assert.equal(r.zones[1].above, true);
  assert.equal(compareSavings(20).rate, 0.2);
  assert.equal(compareSavings(-0.05).zones[0].above, false);
});
