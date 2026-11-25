#!/usr/bin/env node
// Crée le projet « Amal 1 » du propriétaire et y rattache ses lots, locataires et opérations immobilières (idempotent).
import { loadEnv, sql } from './lib.mjs';
const env = loadEnv();
const uid = env.COCKPIT_OWNER_ID;
const [{ n }] = await sql(env, `select count(*)::int n from public.projets where user_id = '${uid}' and deleted_at is null`);
if (n) { console.log('Projet déjà présent : rien à faire'); process.exit(0); }
const part = (await sql(env, `select valeur from public.params where user_id = '${uid}' and cle = 'part_immo'`))[0]?.valeur || '0.67';
const r = await sql(env, `
  select public.ck_snapshot('${uid}', 'Avant création des projets immobiliers');
  select set_config('cockpit.device', 'migration projets', true);
  with p as (insert into public.projets (user_id, nom, part, devise, note) values ('${uid}', 'Amal 1', ${Number(part)}, 'MAD', 'Immeuble — 8 appartements') returning id),
  l as (update public.lots set projet_id = (select id from p) where user_id = '${uid}' and deleted_at is null returning 1),
  t as (update public.tenants set projet_id = (select id from p) where user_id = '${uid}' and deleted_at is null returning 1),
  x as (update public.tx set projet_id = (select id from p) where user_id = '${uid}' and activite = 'Immobilier' and deleted_at is null returning 1),
  rc as (update public.recurring set projet_id = (select id from p) where user_id = '${uid}' and activite = 'Immobilier' and deleted_at is null returning 1)
  select (select count(*) from l) lots, (select count(*) from t) locataires, (select count(*) from x) operations, (select count(*) from rc) recurrents;`);
console.log('Projet « Amal 1 » créé (part', part, ') :', JSON.stringify(r[r.length - 1] || r));
const check = await sql(env, `select (select count(*)::int from public.tx where user_id = '${uid}' and activite = 'Immobilier' and deleted_at is null and projet_id is null) sans_projet,
  (select count(*)::int from public.tx where user_id = '${uid}' and deleted_at is null) total_tx`);
console.log('Contrôle :', JSON.stringify(check));
