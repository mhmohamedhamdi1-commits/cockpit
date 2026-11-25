-- =====================================================================================
-- Cockpit — éléments propres à la plateforme Supabase (non testables sur PGlite) :
-- temps réel, tâches planifiées (pg_cron), droits du rôle de service.
-- __FUNCTION_URL__ est remplacé au déploiement. Le secret d'appel est lu dans Supabase Vault.
-- =====================================================================================

-- Temps réel : diffuser les modifications aux appareils connectés (RLS appliquée)
do $$
declare t text;
begin
  foreach t in array array['tx','categories','lots','tenants','clients','invoices','recurring','accounts','snapshots','params','rappels'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Rôle de service (fonction de notifications, sauvegarde externe, migration)
grant execute on function public.ck_export(uuid), public.ck_restore(uuid, jsonb, text), public.ck_snapshot(uuid, text) to service_role;

-- Tâches planifiées
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname in ('cockpit-daily', 'cockpit-rappels');
end $$;

-- Instantané complet de chaque compte, chaque nuit (01:15 UTC)
select cron.schedule('cockpit-daily', '15 1 * * *', $$ select public.ck_daily(); $$);

-- Rappels : toutes les heures à hh:02, la fonction décide quoi envoyer selon l'heure de Paris
select cron.schedule('cockpit-rappels', '2 * * * *', $cron$
  select net.http_post(
    url := '__FUNCTION_URL__',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cockpit_cron_secret' limit 1)),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000);
$cron$);
