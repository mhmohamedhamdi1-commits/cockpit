// Tests de la base (schéma, RLS + MFA, règles métier, conflits, doublons, restauration)
// sur un PostgreSQL local (PGlite) avec des bouchons du schéma auth de Supabase.
// Lancement : node --test tests/
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
let db;

const STUB = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt() ->> 'sub')::uuid $$;
grant usage on schema public, auth to anon, authenticated, service_role;
grant execute on function auth.jwt(), auth.uid() to anon, authenticated;
insert into auth.users values ('${A}'), ('${B}');
`;

async function as(uid, aal = 'aal2') {
  await db.exec('reset role');
  if (!uid) { await db.exec(`select set_config('request.jwt.claims', '', false); set role anon;`); return; }
  await db.exec(`select set_config('request.jwt.claims', '${JSON.stringify({ sub: uid, aal, role: 'authenticated' })}', false); set role authenticated;`);
}
const q = async (sql, params) => (await db.query(sql, params)).rows;
const ops = (list) => q('select public.apply_ops($1::jsonb, $2) as r', [JSON.stringify(list), 'test']);
async function rejects(p, code) {
  try { await p; } catch (e) { if (code) assert.equal(e.code, code, `attendu ${code}, reçu ${e.code} : ${e.message}`); return e; }
  assert.fail(`aurait dû échouer (${code})`);
}
const uuid = () => crypto.randomUUID();

before(async () => {
  db = new PGlite();
  await db.exec(STUB);
  await db.exec(readFileSync(new URL('../supabase/migrations/0001_schema.sql', import.meta.url), 'utf8'));
  await db.exec(readFileSync(new URL('../supabase/migrations/0002_logic.sql', import.meta.url), 'utf8'));
  await db.exec(readFileSync(new URL('../supabase/migrations/0004_accounts.sql', import.meta.url), 'utf8'));
  await db.exec(readFileSync(new URL('../supabase/migrations/0005_projets.sql', import.meta.url), 'utf8'));
  await db.exec(readFileSync(new URL('../supabase/migrations/0006_bourse.sql', import.meta.url), 'utf8'));
  await as(A);
  await ops([
    { e: 'param', item: { cle: 'taux_mad_eur', valeur: '0.1' } },
    { e: 'category', op: 'upsert', item: { activite: 'Perso', sens: 'Dépense', categorie: 'Courses', groupe: 'Alimentation', nature: 'Courant', icone: '🛒' } },
    { e: 'category', op: 'upsert', item: { activite: 'Perso', sens: 'Dépense', categorie: 'La bourse', groupe: 'Investissements', nature: 'Investissement' } },
  ]);
});

test('création d\'une opération : normalisation identique à la version Go', async () => {
  await as(A);
  const id = uuid();
  await ops([{ e: 'tx', op: 'upsert', item: { id, _insert: true, date: '2026-11-24', activite: 'Perso', sens: 'Dépense', categorie: ' Courses ', libelle: ' Pain ', montant: 4.799, devise: 'EUR' } }]);
  const [t] = await q('select * from tx where id = $1', [id]);
  assert.equal(Number(t.montant), 4.8);
  assert.equal(Number(t.montant_eur), 4.8);
  assert.equal(Number(t.taux), 1);
  assert.equal(t.nature, 'Courant');
  assert.equal(t.periode, '2026-11');
  assert.equal(t.libelle, 'Pain');
  assert.equal(t.categorie, 'Courses');
  assert.equal(t.version, 1);
  const id2 = uuid();
  await ops([{ e: 'tx', op: 'upsert', item: { id: id2, date: '2026-11-25', activite: 'Perso', sens: 'Dépense', categorie: 'La bourse', montant: 1000, devise: 'MAD' } }]);
  const [t2] = await q('select * from tx where id = $1', [id2]);
  assert.equal(Number(t2.taux), 0.1);
  assert.equal(Number(t2.montant_eur), 100);
  assert.equal(t2.nature, 'Investissement');
});

test('validations : montant, date, activité, catégorie', async () => {
  await as(A);
  const base = { date: '2026-11-24', activite: 'Perso', sens: 'Dépense', categorie: 'Courses', montant: 5 };
  await rejects(ops([{ e: 'tx', item: { ...base, montant: 0 } }]), 'CK422');
  await rejects(ops([{ e: 'tx', item: { ...base, date: '2026-13-45' } }]), 'CK422');
  await rejects(ops([{ e: 'tx', item: { ...base, activite: 'Autre' } }]), 'CK422');
  await rejects(ops([{ e: 'tx', item: { ...base, categorie: '' } }]), 'CK422');
});

test('un lot est atomique : une erreur annule tout le lot', async () => {
  await as(A);
  const [{ n: before }] = await q('select count(*)::int n from tx');
  await rejects(ops([
    { e: 'tx', item: { date: '2026-11-24', activite: 'Perso', sens: 'Dépense', categorie: 'Courses', montant: 5 } },
    { e: 'tx', item: { date: '2026-11-24', activite: 'Perso', sens: 'Dépense', categorie: 'Courses', montant: -1 } },
  ]), 'CK422');
  const [{ n: after }] = await q('select count(*)::int n from tx');
  assert.equal(after, before);
});

test('sécurité : RLS, MFA obligatoire, lecture seule directe, anonyme bloqué', async () => {
  await as(A);
  const [{ n: mine }] = await q('select count(*)::int n from tx');
  assert.ok(mine > 0);
  await as(B);
  assert.equal((await q('select count(*)::int n from tx'))[0].n, 0, 'B ne voit pas les données de A');
  await as(A, 'aal1');
  assert.equal((await q('select count(*)::int n from tx'))[0].n, 0, 'session sans MFA : rien de visible');
  await rejects(ops([{ e: 'param', item: { cle: 'x', valeur: '1' } }]), 'CK401');
  await as(A);
  await rejects(q(`insert into tx (date, activite, sens, categorie, montant) values ('2026-01-01','Perso','Dépense','Courses',1)`), '42501');
  await rejects(q(`update tx set montant = 1`), '42501');
  await rejects(q(`delete from tx`), '42501');
  await rejects(q(`select public.ck_apply('${A}', '[]'::jsonb, 'x')`), '42501');
  await rejects(q(`select public.ck_restore('${A}', '{}'::jsonb, 'x')`), '42501');
  await as(null);
  await rejects(q('select * from tx'), '42501');
  await rejects(q(`select public.apply_ops('[]'::jsonb)`), '42501');
});

test('B ne peut pas modifier ni supprimer une ligne de A, même avec son identifiant', async () => {
  await as(A);
  const [t] = await q('select id, version, montant from tx limit 1');
  await as(B);
  await rejects(ops([{ e: 'tx', item: { id: t.id, date: '2026-01-01', activite: 'Perso', sens: 'Dépense', categorie: 'X', montant: 999 } }]), 'CK422');
  await ops([{ e: 'tx', op: 'delete', id: t.id }]);
  await as(A);
  const [t2] = await q('select montant, deleted_at from tx where id = $1', [t.id]);
  assert.equal(Number(t2.montant), Number(t.montant));
  assert.equal(t2.deleted_at, null);
});

test('conflits : version périmée refusée, version à jour acceptée, version incrémentée', async () => {
  await as(A);
  const id = uuid();
  await ops([{ e: 'tx', item: { id, _insert: true, date: '2026-11-01', activite: 'Perso', sens: 'Dépense', categorie: 'Courses', montant: 10 } }]);
  await ops([{ e: 'tx', item: { id, version: 1, montant: 11 } }]);                 // appareil 1
  const err = await rejects(ops([{ e: 'tx', item: { id, version: 1, libelle: 'x' } }]), 'CK409');   // appareil 2, base périmée
  const det = JSON.parse(err.detail);
  assert.equal(det.table, 'tx');
  assert.equal(det.row.version, 2);
  await ops([{ e: 'tx', item: { id, version: 2, libelle: 'fusion' } }]);
  const [t] = await q('select montant, libelle, version from tx where id = $1', [id]);
  assert.equal(Number(t.montant), 11);
  assert.equal(t.libelle, 'fusion');
  assert.equal(t.version, 3);
});

test('doublons : rejeu d\'une création ignoré, même référence refusée', async () => {
  await as(A);
  const id = uuid();
  const item = { id, _insert: true, date: '2026-11-02', activite: 'Perso', sens: 'Dépense', categorie: 'Courses', montant: 7, ref: 'LOYX:2026-11' };
  await ops([{ e: 'tx', item }]);
  await ops([{ e: 'tx', item }]);
  assert.equal((await q('select count(*)::int n from tx where id = $1', [id]))[0].n, 1);
  await rejects(ops([{ e: 'tx', item: { ...item, id: uuid() } }]), '23505');
});

test('suppression logique, conflit de suppression, historique et restauration d\'une version', async () => {
  await as(A);
  const id = uuid();
  await ops([{ e: 'tx', item: { id, _insert: true, date: '2026-11-03', activite: 'Perso', sens: 'Dépense', categorie: 'Courses', montant: 20, libelle: 'avant' } }]);
  await ops([{ e: 'tx', item: { id, version: 1, libelle: 'après' } }]);
  await rejects(ops([{ e: 'tx', op: 'delete', id, version: 1 }]), 'CK409');
  await ops([{ e: 'tx', op: 'delete', id, version: 2 }]);
  const [t] = await q('select deleted_at, version from tx where id = $1', [id]);
  assert.ok(t.deleted_at);
  const log = await q('select id, action from change_log where row_id = $1 order by id', [id]);
  assert.deepEqual(log.map((l) => l.action), ['insert', 'update', 'delete']);
  await q('select public.restore_version($1)', [log[2].id]);     // annule la suppression
  const [t2] = await q('select deleted_at, libelle from tx where id = $1', [id]);
  assert.equal(t2.deleted_at, null);
  assert.equal(t2.libelle, 'après');
  await q('select public.restore_version($1)', [log[1].id]);     // revient avant la modification
  assert.equal((await q('select libelle from tx where id = $1', [id]))[0].libelle, 'avant');
  await as(B);
  await rejects(q('select public.restore_version($1)', [log[1].id]), 'CK422');
});

test('factures : numérotation automatique, HT/TTC, statut', async () => {
  await as(A);
  await ops([{ e: 'client', item: { nom: 'Talan', devise: 'EUR', tjm: 810, tva: 0.2, micro: 'Oui' } }]);
  await ops([
    { e: 'invoice', item: { client: 'Talan', periode: '2027-01', jours: 20, tjm: 810, tva: 0.2, ht: 0, statut: 'bidon' } },
    { e: 'invoice', item: { client: 'Talan', periode: '2027-02', jours: 18.5, tjm: 810, tva: 0.2 } },
  ]);
  const inv = await q('select numero, ht, ttc, statut from invoices order by seq');
  assert.deepEqual(inv.map((i) => i.numero), ['F-2027-001', 'F-2027-002']);
  assert.equal(Number(inv[0].ht), 16200);
  assert.equal(Number(inv[0].ttc), 19440);
  assert.equal(inv[0].statut, 'Planifiée');
  assert.equal(Number(inv[1].ht), 14985);
});

test('récurrents : génération idempotente, jour ramené à la fin du mois', async () => {
  await as(A);
  await ops([{ e: 'recurring', item: { libelle: 'Loyer', activite: 'Perso', sens: 'Dépense', categorie: 'Courses', montant: 900, jour: 31, actif: 'Oui' } }]);
  await ops([{ e: 'action', key: 'generate_recurring', item: { month: '2027-02' } }]);
  await ops([{ e: 'action', key: 'generate_recurring', item: { month: '2027-02' } }]);
  const rows = await q(`select date::text, ref from tx where ref like 'REC%:2027-02'`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, '2027-02-28');
});

test('renommer un lot ou un client met à jour toutes les références', async () => {
  await as(A);
  await ops([{ e: 'lot', item: { code: '11', nom: '11. Ancien nom', loyer: 1800 } }]);
  const [lot] = await q(`select id, version from lots where nom = '11. Ancien nom'`);
  await ops([
    { e: 'tenant', item: { lot: '11. Ancien nom', nom: 'Ali', loyer: 1800 } },
    { e: 'tx', item: { date: '2026-11-05', activite: 'Immobilier', sens: 'Revenu', categorie: 'Loyer', montant: 1800, devise: 'MAD', lot: '11. Ancien nom', tiers: 'Ali' } },
  ]);
  await ops([{ e: 'lot', item: { id: lot.id, version: lot.version, nom: '11. Nouveau nom' } }]);
  assert.equal((await q(`select count(*)::int n from tx where lot = '11. Nouveau nom'`))[0].n, 1);
  assert.equal((await q(`select count(*)::int n from tenants where lot = '11. Nouveau nom'`))[0].n, 1);
  const [c] = await q(`select id, version from clients where nom = 'Talan'`);
  await ops([{ e: 'client', item: { id: c.id, version: c.version, nom: 'Talan (Givenchy)' } }]);
  assert.equal((await q(`select count(*)::int n from invoices where client = 'Talan (Givenchy)'`))[0].n, 2);
});

test('paramètres et catégories : mise à jour, suppression, réactivation', async () => {
  await as(A);
  await ops([{ e: 'param', item: { cle: 'taux_mad_eur', valeur: '0.092' } }]);
  assert.equal((await q(`select valeur from params where cle = 'taux_mad_eur'`))[0].valeur, '0.092');
  const cat = { activite: 'Perso', sens: 'Dépense', categorie: 'Courses' };
  await ops([{ e: 'category', op: 'delete', item: cat }]);
  assert.ok((await q(`select deleted_at from categories where categorie = 'Courses'`))[0].deleted_at);
  await ops([{ e: 'category', op: 'upsert', item: { ...cat, groupe: 'Alim', icone: '🥖' } }]);
  const [c] = await q(`select deleted_at, icone from categories where categorie = 'Courses'`);
  assert.equal(c.deleted_at, null);
  assert.equal(c.icone, '🥖');
});

test('recalcul des taux MAD', async () => {
  await as(A);
  await ops([{ e: 'action', key: 'recompute_rates', item: {} }]);
  const rows = await q(`select taux, montant, montant_eur from tx where devise = 'MAD' and deleted_at is null`);
  assert.ok(rows.length > 0);
  for (const r of rows) assert.equal(Number(r.montant_eur), Math.round(Number(r.montant) * 0.092 * 100) / 100);
});

test('restauration complète : remplacement, suppression logique, instantané préalable, retour arrière', async () => {
  await as(A);
  const before = await q('select id from tx where deleted_at is null');
  const keep = before[0].id;
  const data = { tx: [
    { id: keep, date: '2020-01-01', activite: 'Perso', sens: 'Revenu', categorie: 'Salaire', montant: 3000, devise: 'EUR', taux: 1, montant_eur: 3000, nature: 'Courant', periode: '2020-01' },
    { date: '2020-02-01', activite: 'Perso', sens: 'Revenu', categorie: 'Salaire', montant: 3100, devise: 'EUR', taux: 1, montant_eur: 3100, nature: 'Courant', periode: '2020-02', legacy_id: 42 },
  ] };
  const [{ r }] = await q('select public.restore_all($1::jsonb) as r', [JSON.stringify(data)]);
  assert.equal(r.counts.tx, 2);
  const live = await q('select id, montant, legacy_id from tx where deleted_at is null order by date');
  assert.equal(live.length, 2);
  assert.equal(live[0].id, keep);
  assert.equal(live[1].legacy_id, 42);
  assert.ok((await q('select count(*)::int n from lots where deleted_at is null'))[0].n > 0, 'table absente du fichier : intacte');
  const pts = await q('select id, label, rows from restore_points order by id');
  assert.ok(pts.length >= 1);
  await q('select public.restore_point($1)', [pts[pts.length - 1].id]);
  assert.equal((await q('select count(*)::int n from tx where deleted_at is null'))[0].n, before.length);
  await as(B);
  await rejects(q('select public.restore_point($1)', [pts[0].id]), 'CK422');
  assert.equal((await q('select count(*)::int n from restore_points'))[0].n, 0);
});

test('nouvel inscrit : base de départ créée automatiquement, isolée des autres', async () => {
  await db.exec('reset role');
  const C = crypto.randomUUID();
  await q(`insert into auth.users values ('${C}')`);
  await as(C);
  const [c] = await q('select (select count(*)::int from categories) cats, (select count(*)::int from params) params, (select count(*)::int from accounts) accs, (select count(*)::int from tx) tx');
  assert.equal(c.cats, 71);
  assert.equal(c.params, 22);
  assert.equal(c.accs, 2);
  assert.equal(c.tx, 0, 'aucune donnée d\'un autre compte');
  assert.equal((await q(`select valeur from params where cle = 'nom'`))[0].valeur, '');
});

test('taux réel : utilisé à la date de l\'opération, mise à jour automatique, recalcul historique', async () => {
  await db.exec('reset role');
  await q(`select public.ck_fx_store('2026-11-20', 0.0915, 'test'), public.ck_fx_store('2026-11-24', 0.0912, 'test')`);
  await as(A);
  assert.equal((await q(`select valeur from params where cle = 'taux_mad_eur'`))[0].valeur, '0.0912', 'paramètre mis à jour automatiquement');
  const id = crypto.randomUUID();
  await ops([{ e: 'tx', item: { id, date: '2026-11-21', activite: 'Immobilier', sens: 'Revenu', categorie: 'Loyer', montant: 1000, devise: 'MAD' } }]);
  const [t] = await q('select taux, montant_eur from tx where id = $1', [id]);
  assert.equal(Number(t.taux), 0.0915, 'taux du jour de l\'opération');
  assert.equal(Number(t.montant_eur), 91.5);
  const old = crypto.randomUUID();
  await ops([{ e: 'tx', item: { id: old, date: '2020-01-01', activite: 'Immobilier', sens: 'Revenu', categorie: 'Loyer', montant: 1000, devise: 'MAD', taux: 0.093 } }]);
  await ops([{ e: 'action', key: 'recompute_rates', item: { mode: 'historique' } }]);
  assert.equal(Number((await q('select taux from tx where id = $1', [old]))[0].taux), 0.0912, 'sans taux connu à cette date : taux actuel');
  await ops([{ e: 'param', item: { cle: 'taux_auto', valeur: 'Non' } }]);
  await db.exec('reset role');
  await q(`select public.ck_fx_store('2026-11-25', 0.0999, 'test')`);
  await as(A);
  assert.equal((await q(`select valeur from params where cle = 'taux_mad_eur'`))[0].valeur, '0.0912', 'suivi automatique désactivé : inchangé');
});

test('suppression de compte : tout est effacé, rien chez les autres', async () => {
  await db.exec('reset role');
  const D = crypto.randomUUID();
  await q(`insert into auth.users values ('${D}')`);
  await as(D);
  await ops([{ e: 'tx', item: { date: '2026-11-01', activite: 'Perso', sens: 'Dépense', categorie: 'Courses', montant: 3 } }]);
  await rejects(q(`select public.delete_my_account('oui')`), 'CK422');
  await q(`select public.delete_my_account('SUPPRIMER')`);
  await db.exec('reset role');
  const [r] = await q(`select (select count(*)::int from auth.users where id = '${D}') u, (select count(*)::int from tx where user_id = '${D}') tx, (select count(*)::int from change_log where user_id = '${D}') log, (select count(*)::int from tx where user_id = '${A}') a`);
  assert.deepEqual([r.u, r.tx, r.log], [0, 0, 0]);
  assert.ok(r.a > 0, 'données des autres comptes intactes');
});

test('projets partagés : invitation à usage unique, lecture seule, isolation des autres projets et du perso', async () => {
  await db.exec('reset role');
  const O = crypto.randomUUID(), S = crypto.randomUUID(), X = crypto.randomUUID();     // propriétaire, sœur, inconnu
  await q(`insert into auth.users values ('${O}'), ('${S}'), ('${X}')`);
  await as(O);
  const p1 = crypto.randomUUID(), p2 = crypto.randomUUID();
  await ops([
    { e: 'projet', item: { id: p1, _insert: true, nom: 'Amal 1', part: 0.67 } },
    { e: 'projet', item: { id: p2, _insert: true, nom: 'Projet 2', part: 1 } },
    { e: 'lot', item: { nom: '11. Rue', code: '11', loyer: 2000, projet_id: p1 } },
    { e: 'lot', item: { nom: '21. Neuf', code: '21', loyer: 3000, projet_id: p2 } },
    { e: 'tenant', item: { lot: '11. Rue', nom: 'Ali', loyer: 2000 } },                          // projet déduit du lot
    { e: 'tx', item: { date: '2026-11-05', activite: 'Immobilier', sens: 'Revenu', categorie: 'Loyer', montant: 2000, devise: 'MAD', lot: '11. Rue' } },
    { e: 'tx', item: { date: '2026-11-06', activite: 'Immobilier', sens: 'Revenu', categorie: 'Loyer', montant: 3000, devise: 'MAD', lot: '21. Neuf' } },
    { e: 'tx', item: { date: '2026-11-07', activite: 'Perso', sens: 'Dépense', categorie: 'Courses', montant: 50, libelle: 'perso privé' } },
  ]);
  assert.equal((await q(`select projet_id from tenants where nom = 'Ali'`))[0].projet_id, p1, 'projet déduit du lot');
  const [{ r: inv }] = await q('select public.invite_to_projet($1, $2, $3) as r', [p1, 'Sœur', 0.33]);
  assert.equal(inv.code.length, 64);
  // avant acceptation : rien
  await as(S);
  assert.equal((await q('select count(*)::int n from tx'))[0].n, 0);
  await rejects(q('select public.accept_invitation($1)', ['mauvais-code']), 'CK422');
  await q('select public.accept_invitation($1)', [inv.code]);
  // la sœur voit Amal 1 uniquement
  assert.deepEqual((await q('select nom from projets order by nom')).map((r) => r.nom), ['Amal 1']);
  assert.deepEqual((await q('select nom from lots')).map((r) => r.nom), ['11. Rue']);
  assert.deepEqual((await q('select nom from tenants')).map((r) => r.nom), ['Ali']);
  const seen = await q('select montant, activite from tx');
  assert.equal(seen.length, 1, 'uniquement l’opération du projet partagé');
  assert.equal(Number(seen[0].montant), 2000);
  const [m] = await q('select part, role, status from projet_membres');
  assert.deepEqual([Number(m.part), m.role, m.status], [0.33, 'lecteur', 'actif']);
  // lecture seule : impossible de modifier, supprimer ou injecter des lignes dans le projet
  const [t] = await q('select id, version from tx');
  await rejects(ops([{ e: 'tx', item: { id: t.id, version: t.version, montant: 1 } }]), 'CK422');
  await ops([{ e: 'tx', op: 'delete', id: t.id }]);
  await rejects(ops([{ e: 'tx', item: { date: '2026-11-08', activite: 'Immobilier', sens: 'Revenu', categorie: 'Loyer', montant: 9, devise: 'MAD', projet_id: p1 } }]), 'CK422');
  await rejects(ops([{ e: 'lot', item: { nom: 'intrus', projet_id: p1 } }]), 'CK422');
  await rejects(q('select public.invite_to_projet($1, $2, $3)', [p1, 'x', 0]), 'CK422');
  await as(O);
  assert.equal((await q('select deleted_at from tx where id = $1', [t.id]))[0].deleted_at, null, 'rien supprimé');
  // le code ne sert qu'une fois
  await as(X);
  await rejects(q('select public.accept_invitation($1)', [inv.code]), 'CK422');
  assert.equal((await q('select count(*)::int n from tx'))[0].n, 0);
  // invitation expirée
  await as(O);
  const [{ r: inv2 }] = await q('select public.invite_to_projet($1, $2, $3) as r', [p2, 'X', 0]);
  await db.exec('reset role');
  await q(`update projet_membres set expires_at = now() - interval '1 day' where id = '${inv2.id}'`);
  await as(X);
  await rejects(q('select public.accept_invitation($1)', [inv2.code]), 'CK422');
  // révocation : la sœur perd l'accès immédiatement
  await as(O);
  const [mem] = await q(`select id from projet_membres where status = 'actif'`);
  await q('select public.remove_membre($1)', [mem.id]);
  await as(S);
  assert.equal((await q('select count(*)::int n from tx'))[0].n, 0);
  assert.equal((await q('select count(*)::int n from projets'))[0].n, 0);
  // un projet qui contient des lots ne peut pas être supprimé
  await as(O);
  const [pr] = await q('select version from projets where id = $1', [p1]);
  await rejects(ops([{ e: 'projet', op: 'delete', id: p1, version: pr.version }]), 'CK422');
});

test('déplacer un lot vers un autre projet entraîne ses locataires et opérations', async () => {
  await db.exec('reset role');
  const O = crypto.randomUUID();
  await q(`insert into auth.users values ('${O}')`);
  await as(O);
  const p1 = crypto.randomUUID(), p2 = crypto.randomUUID();
  await ops([{ e: 'projet', item: { id: p1, nom: 'A' } }, { e: 'projet', item: { id: p2, nom: 'B' } },
    { e: 'lot', item: { nom: 'L1', projet_id: p1 } }]);
  await ops([{ e: 'tenant', item: { lot: 'L1', nom: 'T' } }, { e: 'tx', item: { date: '2026-11-01', activite: 'Immobilier', sens: 'Revenu', categorie: 'Loyer', montant: 1, devise: 'MAD', lot: 'L1' } }]);
  const [l] = await q(`select id, version from lots where nom = 'L1'`);
  await ops([{ e: 'lot', item: { id: l.id, version: l.version, projet_id: p2 } }]);
  assert.equal((await q(`select projet_id from tenants where nom = 'T'`))[0].projet_id, p2);
  assert.equal((await q(`select projet_id from tx where lot = 'L1'`))[0].projet_id, p2);
});

test('bourse : ordres validés, privés, inclus dans l’export', async () => {
  await db.exec('reset role');
  const O = crypto.randomUUID(), Z = crypto.randomUUID();
  await q(`insert into auth.users values ('${O}'), ('${Z}')`);
  await as(O);
  await ops([{ e: 'ordre', item: { date: '2026-01-10', symbole: ' cw8.pa ', nom: 'Amundi MSCI World', type: 'ETF', compte: 'PEA', sens: 'Achat', quantite: 3, prix: 540.5, frais: 1.99, devise: 'eur' } }]);
  const [o] = await q('select symbole, devise, quantite from ordres');
  assert.deepEqual([o.symbole, o.devise, Number(o.quantite)], ['CW8.PA', 'EUR', 3]);
  await rejects(ops([{ e: 'ordre', item: { date: '2026-01-10', symbole: 'X', sens: 'Achat', quantite: 0, prix: 1 } }]), 'CK422');
  await rejects(ops([{ e: 'ordre', item: { date: '2026-01-10', symbole: 'X', sens: 'Pari', quantite: 1, prix: 1 } }]), 'CK422');
  await as(Z);
  assert.equal((await q('select count(*)::int n from ordres'))[0].n, 0, 'invisible pour un autre compte');
  await db.exec('reset role');
  const [{ e }] = await q(`select public.ck_export('${O}') as e`);
  assert.equal(e.ordres.length, 1);
});
