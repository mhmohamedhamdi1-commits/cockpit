// Tests de l'import / export Excel sur une COPIE du vrai fichier (chemin dans COCKPIT_XLSX).
// Vérifie : lecture complète, aucune erreur, aller-retour export -> import sans perte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { parseWorkbook, buildWorkbook, parseDate, dateToSerial, serialToDate } from '../app/js/xlsxio.js';
import { TABLES, fromDb } from '../app/js/schema.js';

const FILE = process.env.COCKPIT_XLSX || '/tmp/audit/live.xlsx';

test('conversion de dates Excel', () => {
  assert.equal(serialToDate(dateToSerial('2026-11-24')), '2026-11-24');
  assert.equal(parseDate(46350), serialToDate(46350));
  assert.equal(parseDate('24/11/2026'), '2026-11-24');
  assert.equal(parseDate('2026-11-24T00:00:00Z'), '2026-11-24');
  assert.equal(parseDate(''), '');
});

test('lecture du fichier réel : tout est lu, aucune erreur', { skip: !existsSync(FILE) && 'copie absente' }, () => {
  const r = parseWorkbook(XLSX, readFileSync(FILE));
  assert.deepEqual(r.errors, []);
  assert.equal(r.counts.tx, 2565);
  assert.equal(r.counts.categories, 77);
  assert.equal(r.counts.lots, 8);
  assert.equal(r.counts.tenants, 23);
  assert.equal(r.counts.clients, 2);
  assert.equal(r.counts.invoices, 30);
  assert.equal(r.counts.recurring, 9);
  assert.equal(r.counts.accounts, 12);
  assert.equal(r.counts.snapshots, 4);
  assert.ok(r.data.tx.every((t) => t.legacy_id > 0 && /^\d{4}-\d{2}-\d{2}$/.test(t.date)));
  assert.equal(new Set(r.data.tx.map((t) => t.legacy_id)).size, 2565);
});

test('aller-retour export -> import sans perte', { skip: !existsSync(FILE) && 'copie absente' }, () => {
  const a = parseWorkbook(XLSX, readFileSync(FILE));
  // simule les données telles que l'application les a (id, seq) puis exporte
  const ui = {};
  for (const def of TABLES) {
    ui[def.key] = (a.data[def.key] || []).map((r, i) => fromDb(def, { ...r, id: crypto.randomUUID(), seq: i + 1, version: 1 }));
  }
  const buf = XLSX.write(buildWorkbook(XLSX, ui), { type: 'buffer', bookType: 'xlsx', compression: true });
  const b = parseWorkbook(XLSX, buf);
  assert.deepEqual(b.errors, []);
  for (const def of TABLES) {
    const byId = new Map(ui[def.key].map((r) => [r.id, r]));
    assert.equal(b.data[def.key].length, ui[def.key].length, def.key);
    for (const row of b.data[def.key]) {
      const orig = byId.get(row.id);
      assert.ok(orig, `${def.key} : ligne sans UUID correspondant`);
      const back = fromDb(def, { ...row, seq: orig.seq, version: 1 });
      for (const c of def.cols) assert.deepEqual(back[c.k], orig[c.k], `${def.key}.${c.k}`);
    }
  }
});
