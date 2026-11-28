// Fabrique un classeur Excel de démonstration (format d'export Cockpit) à partir des données fictives : node tests/make-sample-xlsx.mjs [sortie.xlsx]
import fs from 'node:fs';
import * as XLSX from 'xlsx';
import { TABLES, fromDb } from '../app/js/schema.js';
import { buildWorkbook } from '../app/js/xlsxio.js';
import { buildMockDb } from './mockdata.mjs';
const out = process.argv[2] || '/tmp/cockpit-sample/sample.xlsx';
const db = buildMockDb();
const data = {};
for (const t of TABLES) data[t.key] = (db[t.key] || []).map((r) => { const o = fromDb(t, r); if (t.key === 'categories' || t.key === 'params') delete o.id; return o; });   // catégories et paramètres : retrouvés par leur clé
// comme l'ancien classeur : aucun projet (les écrans de test créent les leurs)
data.projets = [];
for (const k of Object.keys(data)) for (const r of data[k]) if ('projetId' in r) r.projetId = '';
fs.mkdirSync(out.replace(/\/[^/]+$/, ''), { recursive: true });
fs.writeFileSync(out, XLSX.write(buildWorkbook(XLSX, data), { type: 'buffer', bookType: 'xlsx' }));
console.log('écrit', out);
