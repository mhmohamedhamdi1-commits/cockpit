#!/usr/bin/env node
// Migration de Finances_Data.xlsx vers la base centrale + rapprochement ligne à ligne + rapport.
//   node tools/cloud/migrate.mjs <chemin du xlsx> [--dry-run]
// Le fichier source est copié puis lu en lecture seule : son empreinte SHA-256 est vérifiée avant / après.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import * as XLSX from 'xlsx';
import { ROOT, SB_URL, loadEnv, setEnv, need, sql, apiKeys, serviceHeaders } from './lib.mjs';
import { parseWorkbook, buildWorkbook } from '../../app/js/xlsxio.js';
import { TABLES, fromDb, toDb, dbCol } from '../../app/js/schema.js';

const env = loadEnv();
const src = process.argv[2];
const dry = process.argv.includes('--dry-run');
if (!src) { console.error('Usage : node tools/cloud/migrate.mjs <fichier.xlsx> [--dry-run]'); process.exit(1); }
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const log = (...a) => console.log('•', ...a);
const report = [];
const R = (s = '') => report.push(s);

// ---------- 1. Copie + lecture ----------
const h0 = sha(src);
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-mig-')), 'source.xlsx');
fs.copyFileSync(src, tmp);
const parsed = parseWorkbook(XLSX, fs.readFileSync(tmp));
if (parsed.errors.length) { console.error('Fichier invalide :\n' + parsed.errors.join('\n')); process.exit(1); }
log('Lu :', Object.entries(parsed.counts).map(([k, v]) => `${k}=${v}`).join(' '));
const data = parsed.data;

// ---------- 2. Rappels d'échéances initiaux ----------
const today = new Date().toISOString().slice(0, 10);
if (!data.rappels || !data.rappels.length) {
  data.rappels = [
    { titre: 'Déclaration URSSAF micro-entreprise (chiffre d’affaires)', categorie: 'Fiscal', frequence: 'Trimestriel', date: '2027-04-30', avance: 7, actif: 'Oui', note: 'Déclaration trimestrielle par défaut (30/04, 31/07, 31/10, 31/01). Si tu optes pour le mensuel, passe la fréquence en « Mensuel ». À confirmer sur autoentrepreneur.urssaf.fr.' },
    { titre: 'Cotisation foncière des entreprises (CFE)', categorie: 'Fiscal', frequence: 'Annuel', date: '2028-12-15', avance: 14, actif: 'Oui', note: 'Normalement exonérée l’année de création. Avis dans l’espace professionnel impots.gouv.fr : vérifier la date chaque année.' },
    { titre: 'Déclaration de revenus (impots.gouv.fr)', categorie: 'Fiscal', frequence: 'Annuel', date: '2027-05-20', avance: 14, actif: 'Oui', note: 'La date limite dépend du département (mi-mai à début juin) : ajuste-la chaque année. Penser aux revenus étrangers (Maroc) et au chiffre d’affaires micro.' },
    { titre: 'Taxes et déclarations Amal 1 (Maroc) — date à confirmer', categorie: 'Immobilier', frequence: 'Annuel', date: '2027-03-31', avance: 21, actif: 'Non', note: 'Renseigne la vraie échéance (revenus fonciers, taxe de services communaux…) puis active ce rappel.' },
  ];
  for (const t of data.tenants || []) {
    if (t.sortie && t.sortie > today) data.rappels.push({ titre: `Départ prévu : ${t.nom} (${t.lot.replace(/^\d+\.\s*/, '')})`, categorie: 'Immobilier', frequence: 'Une fois', date: t.sortie, avance: 15, actif: 'Oui', note: `État des lieux, relevés, restitution de la caution (${t.caution} MAD).` });
  }
  log(`${data.rappels.length} rappels d’échéances préparés`);
}

if (dry) { log('Simulation terminée (--dry-run) : rien n’a été écrit.'); process.exit(0); }

// ---------- 3. Propriétaire ----------
need(env, 'SUPABASE_ACCESS_TOKEN');
let owner = env.COCKPIT_OWNER_ID;
const users = await sql(env, 'select id, email, created_at from auth.users order by created_at');
if (!owner) {
  if (users.length !== 1) { console.error(`Il faut exactement 1 compte (trouvé : ${users.length}). Crée ton compte dans l’application d’abord.`); process.exit(1); }
  owner = users[0].id; setEnv('COCKPIT_OWNER_ID', owner);
}
const email = (users.find((u) => u.id === owner) || {}).email;
log('Compte propriétaire :', email);

// ---------- 4. Chargement ----------
const keys = await apiKeys(env);
const rest = async (p, body) => {
  const r = await fetch(`${SB_URL}/rest/v1/${p}`, { method: body ? 'POST' : 'GET', headers: serviceHeaders(keys.service), body: body && JSON.stringify(body) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${p} -> ${r.status} ${t.slice(0, 500)}`);
  return t ? JSON.parse(t) : null;
};
const t0 = Date.now();
const res = await rest('rpc/ck_restore', { p_uid: owner, p_data: data, p_label: 'Avant migration initiale depuis Excel' });
log(`Chargé en ${((Date.now() - t0) / 1000).toFixed(1)} s :`, JSON.stringify(res.counts));

// ---------- 5. Rapprochement ----------
async function fetchAll(table) {
  const out = [];
  for (let off = 0; ; off += 1000) {
    const rows = await rest(`${table}?select=*&user_id=eq.${owner}&deleted_at=is.null&order=seq&limit=1000&offset=${off}`);
    out.push(...rows); if (rows.length < 1000) break;
  }
  return out;
}
const cloud = {};
for (const def of TABLES) cloud[def.key] = await fetchAll(def.key);

const keyOf = { categories: (r) => `${r.activite}|${r.sens}|${r.categorie}`, params: (r) => r.cle };
let mismatches = 0;
R('# Cockpit — rapport de migration'); R();
R(`Date : ${new Date().toLocaleString('fr-FR')} · Source : \`${path.basename(src)}\` (SHA-256 \`${h0.slice(0, 16)}…\`) · Compte : ${email}`); R();
R('## 1. Nombre de lignes'); R(); R('| Table | Excel | Base centrale | Écart |'); R('|---|---:|---:|---:|');
for (const def of TABLES) {
  const a = (data[def.key] || []).length, b = cloud[def.key].length;
  if (a !== b) mismatches++;
  R(`| ${def.sheet} | ${a} | ${b} | ${a === b ? '✅ 0' : '❌ ' + (b - a)} |`);
}
R(); R('## 2. Comparaison champ par champ'); R();
const fieldIssues = [];
const eq = (c, a, b) => (c.t === 'money' || c.t === 'rate' || c.t === 'int') ? Math.abs(Number(a || 0) - Number(b || 0)) < 0.005 : String(a ?? '') === String(b ?? '');
for (const def of TABLES) {
  const kf = keyOf[def.key] || ((r) => r.legacy_id ? 'L' + r.legacy_id : JSON.stringify(def.cols.map((c) => r[dbCol(c)])));
  const map = new Map(cloud[def.key].map((r) => [kf(r), r]));
  let ok = 0;
  for (const r of data[def.key] || []) {
    const c = map.get(kf(r));
    if (!c) { fieldIssues.push(`${def.sheet} : ligne absente (${kf(r)})`); continue; }
    const bad = def.cols.filter((col) => !eq(col, r[dbCol(col)], col.t === 'date' && c[dbCol(col)] ? String(c[dbCol(col)]).slice(0, 10) : c[dbCol(col)]));
    if (bad.length) fieldIssues.push(`${def.sheet} ${kf(r)} : ${bad.map((b) => b.x).join(', ')}`); else ok++;
  }
  R(`- ${def.sheet} : ${ok}/${(data[def.key] || []).length} lignes identiques sur toutes les colonnes`);
}
if (fieldIssues.length) { mismatches += fieldIssues.length; R(); R('Écarts :'); fieldIssues.slice(0, 50).forEach((x) => R(`- ❌ ${x}`)); }
R(); R('## 3. Totaux par activité et par année (Montant EUR, Excel = base)'); R(); R('| Activité | Année | Excel | Base | Écart |'); R('|---|---|---:|---:|---:|');
const sums = (rows) => { const m = new Map(); for (const t of rows) { const k = `${t.activite}|${String(t.date).slice(0, 4)}|${t.sens}`; m.set(k, (m.get(k) || 0) + Number(t.montant_eur)); } return m; };
const sa = sums(data.tx), sb2 = sums(cloud.tx);
for (const k of [...new Set([...sa.keys(), ...sb2.keys()])].sort()) {
  const [act, y, sens] = k.split('|'); const a = sa.get(k) || 0, b = sb2.get(k) || 0;
  if (Math.abs(a - b) > 0.01) mismatches++;
  R(`| ${act} (${sens}) | ${y} | ${a.toFixed(2)} | ${b.toFixed(2)} | ${Math.abs(a - b) < 0.01 ? '✅' : '❌ ' + (b - a).toFixed(2)} |`);
}
// ---------- 6. Aller-retour Excel depuis la base ----------
const ui = {}; for (const def of TABLES) ui[def.key] = cloud[def.key].map((r) => fromDb(def, r));
const exp = parseWorkbook(XLSX, XLSX.write(buildWorkbook(XLSX, ui), { type: 'buffer', bookType: 'xlsx', compression: true }));
let rt = 0;
for (const def of TABLES) {
  const byId = new Map(ui[def.key].map((r) => [r.id, r]));
  for (const r of exp.data[def.key] || []) { const o = byId.get(r.id); if (!o || def.cols.some((c) => !eq(c, fromDb(def, r)[c.k], o[c.k]))) rt++; }
}
if (rt || exp.errors.length) mismatches++;
R(); R('## 4. Export Excel depuis la base puis relecture'); R(); R(rt || exp.errors.length ? `❌ ${rt} écarts` : `✅ ${Object.values(exp.counts).reduce((a, b) => a + b, 0)} lignes exportées et relues à l’identique (identifiants UUID conservés)`);
// ---------- 7. Fichier source intact ----------
const h1 = sha(src);
R(); R('## 5. Fichier Excel d’origine'); R(); R(h0 === h1 ? `✅ Inchangé (SHA-256 identique avant et après : \`${h1}\`)` : '❌ LE FICHIER A CHANGÉ PENDANT LA MIGRATION');
if (h0 !== h1) mismatches++;
R(); R(`## Verdict : ${mismatches ? `❌ ${mismatches} écart(s) à analyser` : '✅ migration sans perte'}`);
R(); R('Un point de restauration « Avant migration initiale depuis Excel » a été créé dans la base avant le chargement.');
const out = path.join(ROOT, 'docs/03_Rapport_Migration.md');
fs.writeFileSync(out, report.join('\n') + '\n');
log(mismatches ? `ÉCARTS : ${mismatches} (voir ${out})` : 'Migration sans perte ✅', '— rapport :', path.relative(ROOT, out));
process.exit(mismatches ? 3 : 0);
