// Tests des calculs : trésorerie, santé financière, portefeuille boursier
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { cashPosition, financialHealth, portfolio, simulateSale, buildIndex } from '../app/js/core.js';
import { parseWorkbook } from '../app/js/xlsxio.js';
import { TABLES, fromDb } from '../app/js/schema.js';

const FILE = '/tmp/audit/live.xlsx';
function ctxFromFile() {
  const r = parseWorkbook(XLSX, readFileSync(FILE));
  const data = {};
  for (const d of TABLES) data[d.key] = (r.data[d.key] || []).map((x, i) => fromDb(d, { ...x, id: 'id' + i, seq: i }));
  return { data, today: '2026-11-25', ...buildIndex(data) };
}

test('trésorerie : perso + freelance = 1 908,73 € et projet immobilier = 1 408 MAD (données réelles)', { skip: !existsSync(FILE) }, () => {
  const c = cashPosition(ctxFromFile());
  assert.equal(Math.round(c.perso.eur * 100) / 100, 1908.73);
  assert.equal(Math.round(c.projets[0].mad), 1408);
  assert.equal(Math.round(c.perso.rev - c.perso.dep - c.perso.inv + c.perso.fin), Math.round(c.perso.eur));
});

test('santé financière : score et indicateurs cohérents', { skip: !existsSync(FILE) }, () => {
  const hlt = financialHealth(ctxFromFile());
  assert.ok(hlt.score >= 0 && hlt.score <= 100);
  assert.ok(hlt.indicators.length >= 4);
  for (const i of hlt.indicators) assert.ok(['good', 'warn', 'bad'].includes(i.level) && i.text.length > 10, i.id);
});

test('portefeuille : PRU moyen pondéré, vente partielle, plus-value latente et réalisée, ROI', () => {
  const ordres = [
    { date: '2025-01-10', symbole: 'CW8.PA', sens: 'Achat', quantite: 10, prix: 400, frais: 2, devise: 'EUR' },
    { date: '2025-06-10', symbole: 'CW8.PA', sens: 'Achat', quantite: 10, prix: 500, frais: 2, devise: 'EUR' },
    { date: '2026-01-10', symbole: 'CW8.PA', sens: 'Vente', quantite: 5, prix: 600, frais: 1, devise: 'EUR' },
    { date: '2026-02-10', symbole: 'AAPL', sens: 'Achat', quantite: 2, prix: 200, frais: 0, devise: 'USD' },
    { date: '2026-03-10', symbole: 'AAPL', sens: 'Dividende', quantite: 0, prix: 1, frais: 0, devise: 'USD' },
  ];
  const pf = portfolio(ordres, { 'CW8.PA': { prix: 550, devise: 'EUR' }, AAPL: { prix: 250, devise: 'USD' } }, (d) => (d === 'EUR' ? 1 : d === 'USD' ? 0.9 : null));
  const cw = pf.positions.find((p) => p.symbole === 'CW8.PA');
  assert.equal(cw.qty, 15);
  assert.equal(Math.round(cw.pru * 100) / 100, 450.2);           // (4002 + 5002) / 20
  assert.equal(Math.round(cw.realized * 100) / 100, 748);          // (5×600 − 1) − 5×450,2
  assert.equal(Math.round(cw.latent * 100) / 100, 1497);           // 15×550 − 15×450,2
  const ap = pf.positions.find((p) => p.symbole === 'AAPL');
  assert.equal(Math.round(ap.value * 100) / 100, 450);             // 2×250×0,9
  assert.equal(Math.round(ap.dividends * 100) / 100, 0.9);
  assert.ok(Math.abs(pf.total.roi - (pf.total.gain / pf.total.invested)) < 1e-12);
  const s = simulateSale(cw, 15, 550, { fee: 1, taxRate: 0.3 });
  assert.equal(Math.round(s.gain * 100) / 100, 1496);
  assert.equal(Math.round(s.tax * 100) / 100, 448.8);
  assert.equal(s.remaining, 0);
});
