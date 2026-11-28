// Tests de la migration 0007 (v3) : devises, Entreprise, lots, import de relevés, objectifs, impôt, déclarations.
// Lancement : node --test tests/
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const A = '33333333-3333-4333-8333-333333333333';
const B = '44444444-4444-4444-8444-444444444444';
let db;
const mig = (f) => readFileSync(new URL(`../supabase/migrations/${f}`, import.meta.url), 'utf8');
const STUB = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt() ->> 'sub')::uuid $$;
grant usage on schema public, auth to anon, authenticated, service_role;
grant execute on function auth.jwt(), auth.uid() to anon, authenticated;
`;
async function as(uid, aal = 'aal2') {
  await db.exec('reset role');
  await db.exec(`select set_config('request.jwt.claims', '${JSON.stringify({ sub: uid, aal, role: 'authenticated' })}', false); set role authenticated;`);
}
const q = async (sql, params) => (await db.query(sql, params)).rows;
const ops = (list) => q('select public.apply_ops($1::jsonb, $2) as r', [JSON.stringify(list), 'test']);
async function rejects(p, code) {
  try { await p; } catch (e) { if (code) assert.equal(e.code, code, `attendu ${code}, reçu ${e.code} : ${e.message}`); return e; }
  assert.fail(`aurait dû échouer (${code})`);
}
const uuid = () => crypto.randomUUID();
const files = ['0001_schema.sql', '0002_logic.sql', '0004_accounts.sql', '0005_projets.sql', '0006_bourse.sql', '0007_v3.sql'];

before(async () => {
  db = new PGlite();
  await db.exec(STUB);
  for (const f of files) await db.exec(mig(f));
  await db.exec(`insert into auth.users values ('${A}'), ('${B}')`);   // ck_on_signup : bases de départ créées
  await db.exec(`insert into public.fx_rates (date, pair, rate, source) values
    ('2026-11-20', 'USD/EUR', 0.86, 't'), ('2026-11-26', 'USD/EUR', 0.87, 't'), ('2026-11-26', 'GBP/EUR', 1.14, 't'), ('2026-11-26', 'CHF/EUR', 1.07, 't')`);
});

test('devises : USD, GBP, CHF avec le taux réel de la date, MAD inchangé, devise inconnue = EUR', async () => {
  await as(A);
  const base = { date: '2026-11-26', activite: 'Perso', sens: 'Dépense', categorie: 'Courses', montant: 100 };
  await ops([{ e: 'tx', item: { ...base, devise: 'USD', libelle: 'usd' } }, { e: 'tx', item: { ...base, devise: 'gbp', libelle: 'gbp' } },
    { e: 'tx', item: { ...base, devise: 'CHF', libelle: 'chf' } }, { e: 'tx', item: { ...base, devise: 'XYZ', libelle: 'xyz' } },
    { e: 'tx', item: { ...base, date: '2026-11-21', devise: 'USD', libelle: 'usd ancien' } }]);
  const rows = Object.fromEntries((await q('select libelle, devise, taux, montant_eur from tx')).map((r) => [r.libelle, r]));
  assert.equal(Number(rows.usd.montant_eur), 87); assert.equal(rows.usd.devise, 'USD');
  assert.equal(Number(rows.gbp.montant_eur), 114); assert.equal(Number(rows.chf.montant_eur), 107);
  assert.equal(rows.xyz.devise, 'EUR'); assert.equal(Number(rows.xyz.montant_eur), 100);
  assert.equal(Number(rows['usd ancien'].montant_eur), 86, 'taux du 20/11 (dernier connu avant l\'opération)');
  const [s] = await q(`select public.apply_ops($1::jsonb) r`, [JSON.stringify([{ e: 'snapshot', item: { date: '2026-11-26', compte: 'Compte US', solde: 1000, devise: 'USD' } }])]);
  assert.equal(Number((await q(`select solde_eur from snapshots where compte = 'Compte US'`))[0].solde_eur), 870);
  // un taux fourni par l'appareil est respecté
  await ops([{ e: 'tx', item: { ...base, devise: 'USD', taux: 0.9, libelle: 'usd fixe' } }]);
  assert.equal(Number((await q(`select montant_eur from tx where libelle = 'usd fixe'`))[0].montant_eur), 90);
});

test('devise sans taux connu : refus clair', async () => {
  await as(A);
  await db.exec('reset role'); await db.exec(`delete from fx_rates where pair = 'CHF/EUR'`); await as(A);
  const e = await rejects(ops([{ e: 'tx', item: { date: '2026-11-26', activite: 'Perso', sens: 'Dépense', categorie: 'Courses', montant: 5, devise: 'CHF' } }]), 'CK422');
  assert.match(e.message, /CHF/);
  await db.exec('reset role'); await db.exec(`insert into fx_rates (date, pair, rate, source) values ('2026-11-26', 'CHF/EUR', 1.07, 't')`); await as(A);
});

test('« Freelance » accepté et converti en « Entreprise » (anciens appareils, sauvegardes, Excel)', async () => {
  await as(A);
  await ops([{ e: 'tx', item: { date: '2026-11-26', activite: 'Freelance', sens: 'Revenu', categorie: 'Prestations', montant: 500, libelle: 'ancien client' } },
    { e: 'recurring', item: { libelle: 'Logiciel', activite: 'Freelance', sens: 'Dépense', categorie: 'Logiciels & abonnements', montant: 10, jour: 5 } }]);
  assert.equal((await q(`select activite from tx where libelle = 'ancien client'`))[0].activite, 'Entreprise');
  assert.equal((await q(`select activite from recurring where libelle = 'Logiciel'`))[0].activite, 'Entreprise');
  const cats = await q(`select count(*)::int n from categories where activite = 'Freelance'`);
  assert.equal(cats[0].n, 0);
  assert.ok((await q(`select count(*)::int n from categories where activite = 'Entreprise'`))[0].n >= 15);
  // restauration d'un ancien export contenant « Freelance »
  await db.exec('reset role');
  const exp = (await q(`select public.ck_export('${A}') e`))[0].e;
  await as(A);
  exp.tx = exp.tx.map((t) => (t.libelle === 'ancien client' ? { ...t, activite: 'Freelance' } : t));
  exp.categories = exp.categories.map((c) => (c.activite === 'Entreprise' ? { ...c, activite: 'Freelance' } : c));
  await q('select public.restore_all($1::jsonb, $2)', [JSON.stringify(exp), 'test']);
  assert.equal((await q(`select activite from tx where libelle = 'ancien client'`))[0].activite, 'Entreprise');
  assert.equal((await q(`select count(*)::int n from categories where activite = 'Freelance' and deleted_at is null`))[0].n, 0);
});

test('lots : code incrémental par projet, code saisi respecté', async () => {
  await as(A);
  const p1 = uuid(), p2 = uuid();
  await ops([{ e: 'projet', item: { id: p1, nom: 'Immeuble 1', type: 'Immobilier' } }, { e: 'projet', item: { id: p2, nom: 'Immeuble 2', type: 'Immobilier' } }]);
  await ops([{ e: 'lot', item: { nom: 'RDC', projet_id: p1 } }]);
  await ops([{ e: 'lot', item: { nom: 'Étage 1', projet_id: p1 } }, { e: 'lot', item: { nom: 'Étage 2', projet_id: p1 } }]);
  await ops([{ e: 'lot', item: { nom: 'Spécial', code: '41', projet_id: p1 } }]);
  await ops([{ e: 'lot', item: { nom: 'Suite', projet_id: p1 } }]);
  await ops([{ e: 'lot', item: { nom: 'Autre immeuble', projet_id: p2 } }]);
  const codes = Object.fromEntries((await q('select nom, code from lots')).map((r) => [r.nom, r.code]));
  assert.deepEqual([codes['RDC'], codes['Étage 1'], codes['Étage 2'], codes['Spécial'], codes['Suite'], codes['Autre immeuble']], ['00', '01', '02', '41', '42', '00']);
});

test('entreprise = projet : méta, clients, factures et opérations rattachés, numérotation par entreprise', async () => {
  await as(A);
  const e1 = uuid(), e2 = uuid();
  await ops([{ e: 'projet', item: { id: e1, nom: 'Ma micro', type: 'Entreprise', part: 1, devise: 'EUR', meta: { forme: 'micro_bnc', date_debut: '2027-01-01' } } },
    { e: 'projet', item: { id: e2, nom: 'Ma SASU', type: 'Entreprise', part: 0.5, devise: 'usd', meta: { forme: 'sasu' } } }]);
  const [p] = await q('select meta, part, devise from projets where id = $1', [e2]);
  assert.deepEqual(p.meta, { forme: 'sasu' }); assert.equal(Number(p.part), 0.5); assert.equal(p.devise, 'USD');
  await rejects(ops([{ e: 'projet', item: { nom: 'X', type: 'Autre' } }]), 'CK422');
  await ops([{ e: 'client', item: { nom: 'Client A', tjm: 500, projet_id: e1 } }, { e: 'client', item: { nom: 'Client B', tjm: 600, projet_id: e2 } }]);
  await ops([{ e: 'invoice', item: { client: 'Client A', periode: '2027-01', jours: 10, tjm: 500, tva: 0, projet_id: e1 } },
    { e: 'invoice', item: { client: 'Client B', periode: '2027-01', jours: 5, tjm: 600, tva: 0.2, projet_id: e2 } },
    { e: 'invoice', item: { client: 'Client A', periode: '2027-02', jours: 20, tjm: 500, tva: 0, projet_id: e1 } }]);
  const nums = (await q(`select numero, projet_id, ht from invoices order by numero, (projet_id = '${e1}') desc`)).map((r) => `${r.numero}:${r.projet_id === e1 ? 1 : 2}`);
  assert.deepEqual(nums, ['F-2027-001:1', 'F-2027-001:2', 'F-2027-002:1'], 'une séquence par entreprise');
  await ops([{ e: 'tx', item: { date: '2027-02-10', activite: 'Entreprise', sens: 'Revenu', categorie: 'Prestations', montant: 5000, projet_id: e1 } },
    { e: 'tx', item: { date: '2027-02-10', activite: 'Perso', sens: 'Revenu', categorie: 'Salaire & primes', montant: 1, projet_id: e1 } }]);
  assert.equal((await q(`select projet_id from tx where montant = 5000`))[0].projet_id, e1, 'une opération Entreprise garde son projet');
  assert.equal((await q(`select projet_id from tx where activite = 'Perso' and montant = 1`))[0].projet_id, null, 'une opération Perso n\'a pas de projet');
  await rejects(ops([{ e: 'client', item: { nom: 'Pirate', projet_id: uuid() } }]), 'CK422');
});

test('import de relevé : lignes en attente, validation atomique, doublons refusés', async () => {
  await as(A);
  const l1 = uuid(), l2 = uuid();
  await ops([{ e: 'ligne', item: { id: l1, _insert: true, date: '2026-11-20', libelle: 'Lidl', montant: -23.4, devise: 'EUR', hash: 'h1', source: 'Revolut', type_op: 'Card Payment' } },
    { e: 'ligne', item: { id: l2, _insert: true, date: '2026-11-21', libelle: 'Salaire', montant: 3000, devise: 'eur', hash: 'h2' } }]);
  const rows = await q('select libelle, montant, statut, activite from import_lignes order by date');
  assert.equal(rows.length, 2); assert.equal(rows[0].statut, 'attente'); assert.equal(Number(rows[0].montant), -23.4);
  await rejects(ops([{ e: 'ligne', item: { date: '2026-11-22', libelle: 'doublon', montant: -1, hash: 'h1' } }]), '23505');
  await rejects(ops([{ e: 'ligne', item: { date: '2026-11-22', libelle: 'nul', montant: 0, hash: 'h3' } }]), 'CK422');
  await rejects(ops([{ e: 'ligne', item: { date: '2026-11-22', libelle: 'sans hash', montant: 5 } }]), 'CK422');
  // validation : la dépense et le statut passent ensemble ; si la dépense est refusée, la ligne reste en attente
  const [r1] = await q('select version from import_lignes where id = $1', [l1]);
  await rejects(ops([{ e: 'tx', item: { date: '2026-11-20', activite: 'Perso', sens: 'Dépense', categorie: '', montant: 23.4, ref: 'REV:h1' } }, { e: 'ligne', item: { id: l1, version: r1.version, statut: 'valide' } }]), 'CK422');
  assert.equal((await q('select statut from import_lignes where id = $1', [l1]))[0].statut, 'attente');
  await ops([{ e: 'tx', item: { date: '2026-11-20', activite: 'Perso', sens: 'Dépense', categorie: 'Courses', libelle: 'Lidl', montant: 23.4, ref: 'REV:h1' } }, { e: 'ligne', item: { id: l1, version: r1.version, statut: 'valide', tx_ref: 'REV:h1', categorie: 'Courses' } }]);
  assert.equal((await q('select statut from import_lignes where id = $1', [l1]))[0].statut, 'valide');
  assert.equal((await q(`select count(*)::int n from tx where ref = 'REV:h1'`))[0].n, 1);
  // une ligne ignorée garde son empreinte : un nouvel import ne la recrée pas
  await as(B);
  assert.equal((await q('select count(*)::int n from import_lignes'))[0].n, 0, 'privé');
});

test('objectifs, impôt, déclarations : contrôles et unicité', async () => {
  await as(A);
  await ops([{ e: 'objectif', item: { nom: 'Apport appartement', type: 'Patrimoine', cible: 50000, mensuel: 500, rendement: 0.03, echeance: '2030-01-01' } }]);
  await rejects(ops([{ e: 'objectif', item: { nom: 'Rien', cible: 0 } }]), 'CK422');
  await ops([{ e: 'fiscal', item: { annee: 2026, data: { situation: 'celibataire', enfants: 0 } } }]);
  await rejects(ops([{ e: 'fiscal', item: { annee: 2026, data: {} } }]), '23505');
  await rejects(ops([{ e: 'fiscal', item: { annee: 1999, data: {} } }]), 'CK422');
  const [f] = await q('select data from fiscal where annee = 2026');
  assert.equal(f.data.situation, 'celibataire');
  const e1 = (await q(`select id from projets where nom = 'Ma micro'`))[0].id;
  await ops([{ e: 'declaration', item: { projet_id: e1, code: 'urssaf', periode: '2027-01', statut: 'paye', date: '2027-02-28', montant: 1200 } }]);
  await rejects(ops([{ e: 'declaration', item: { projet_id: e1, code: 'urssaf', periode: '2027-01', statut: 'fait' } }]), '23505');
  await as(B);
  assert.equal((await q('select count(*)::int n from objectifs'))[0].n + (await q('select count(*)::int n from fiscal'))[0].n + (await q('select count(*)::int n from declarations'))[0].n, 0, 'privé');
  assert.ok((await q('select count(*)::int n from bareme_fiscal'))[0].n >= 0, 'barèmes lisibles par tous les comptes connectés');
  await db.exec('reset role');
  const [{ e }] = await q(`select public.ck_export('${A}') as e`);
  for (const k of ['import_lignes', 'objectifs', 'fiscal', 'declarations']) assert.ok(Array.isArray(e[k]), `export ${k}`);
});

test('migration v3 rejouable : renomme, crée l\'entreprise de reprise une seule fois', async () => {
  await db.exec('reset role');
  const C = uuid();
  await db.exec(`insert into auth.users values ('${C}')`);
  // état « avant v3 » : une opération Freelance, un client, une facture sans entreprise
  await db.exec(`alter table public.tx drop constraint tx_activite_check`);
  await db.exec(`insert into public.tx (user_id, date, activite, sens, categorie, montant, montant_eur) values ('${C}', '2026-05-01', 'Freelance', 'Revenu', 'Prestations', 100, 100)`);
  await db.exec(`insert into public.clients (user_id, nom, tjm) values ('${C}', 'Talan', 500)`);
  await db.exec(`insert into public.invoices (user_id, numero, client, periode, jours, tjm, ht, ttc) values ('${C}', 'F-2027-001', 'Talan', '2027-01', 10, 500, 5000, 5000)`);
  await db.exec(`update public.params set valeur = '2027-01-01' where user_id = '${C}' and cle = 'micro_debut'`);
  await db.exec(`delete from public.params where user_id = '${C}' and cle = 'migr_v3_entreprise'`);
  await db.exec(mig('0007_v3.sql'));
  await db.exec(mig('0007_v3.sql'));
  const projets = await q(`select id, nom, meta from projets where user_id = '${C}' and type = 'Entreprise'`);
  assert.equal(projets.length, 1);
  assert.equal(projets[0].meta.forme, 'micro_bnc'); assert.equal(projets[0].meta.date_debut, '2027-01-01');
  assert.equal((await q(`select activite, projet_id from tx where user_id = '${C}'`))[0].activite, 'Entreprise');
  assert.equal((await q(`select projet_id from clients where user_id = '${C}'`))[0].projet_id, projets[0].id);
  assert.equal((await q(`select projet_id from invoices where user_id = '${C}'`))[0].projet_id, projets[0].id);
});
