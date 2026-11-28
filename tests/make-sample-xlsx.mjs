// Fabrique un classeur Excel de démonstration (format d'export Cockpit) à partir des données fictives : node tests/make-sample-xlsx.mjs [sortie.xlsx]
import fs from 'node:fs';
import * as XLSX from 'xlsx';
import { TABLES, fromDb } from '../app/js/schema.js';
import { buildWorkbook } from '../app/js/xlsxio.js';
import { buildMockDb } from './mockdata.mjs';
const out = process.argv[2] || '/tmp/audit/live.xlsx';
const db = buildMockDb();
const data = {};
for (const t of TABLES) data[t.key] = (db[t.key] || []).map((r) => fromDb(t, r));
fs.mkdirSync(out.replace(/\/[^/]+$/, ''), { recursive: true });
fs.writeFileSync(out, XLSX.write(buildWorkbook(XLSX, data), { type: 'buffer', bookType: 'xlsx' }));
console.log('écrit', out);
