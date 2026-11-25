-- =====================================================================================
-- Cockpit — comptes multiples : chaque nouvel inscrit reçoit sa propre base (catégories, paramètres,
-- comptes par défaut), isolée par la RLS. Suppression de compte (RGPD). Taux de change automatiques.
-- =====================================================================================

-- ---------- Données de départ d'un nouveau compte ----------
create or replace function public.ck_seed(p_uid uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.params where user_id = p_uid) then return; end if;
  perform set_config('cockpit.device', 'création du compte', true);
  insert into public.params (user_id, cle, valeur, libelle) values
    (p_uid, 'nom', '', 'Prénom affiché dans l''application'),
    (p_uid, 'taux_mad_eur', coalesce((select rtrim(rtrim(rate::text, '0'), '.') from public.fx_rates where pair = 'MAD/EUR' order by date desc limit 1), '0.093'), 'Taux de change : 1 MAD = x EUR (mis à jour chaque jour si le suivi automatique est activé)'),
    (p_uid, 'taux_auto', 'Oui', 'Mettre à jour automatiquement le taux MAD/EUR chaque jour (taux réel du marché)'),
    (p_uid, 'part_immo', '1', 'Ma part des biens immobiliers suivis, entre 0 et 1'),
    (p_uid, 'micro_debut', to_char(date_trunc('year', now()), 'YYYY-MM-DD'), 'Début de la micro-entreprise : seuls les CA à partir de cette date comptent pour les plafonds'),
    (p_uid, 'seuil_micro', '83600', 'Plafond de CA annuel HT du régime micro-BNC (2026-2028)'),
    (p_uid, 'seuil_tva', '37500', 'Seuil de franchise en base de TVA (prestations de services)'),
    (p_uid, 'seuil_tva_maj', '41250', 'Seuil majoré de TVA (TVA due immédiatement au-delà)'),
    (p_uid, 'taux_cotis', '0.256', 'Cotisations sociales micro-BNC (% du CA encaissé)'),
    (p_uid, 'taux_cfp', '0.002', 'Contribution à la formation professionnelle (% du CA)'),
    (p_uid, 'taux_provision', '0.40', 'Part de chaque encaissement freelance à mettre de côté (estimation)'),
    (p_uid, 'notif_heure', '8', 'Heure (Paris) du point du matin'),
    (p_uid, 'notif_factures', 'Oui', 'Factures en retard / à envoyer'),
    (p_uid, 'notif_jours', 'Oui', 'Jours travaillés en fin de mois'),
    (p_uid, 'notif_loyers', 'Oui', 'Loyers en retard / à encaisser'),
    (p_uid, 'notif_loyer_jour', '5', 'Jour du mois à partir duquel un loyer non reçu est en retard'),
    (p_uid, 'notif_saisie', 'Oui', 'Rappel de saisie'),
    (p_uid, 'notif_saisie_jours', '3', 'Jours sans saisie avant le rappel'),
    (p_uid, 'notif_recurrents', 'Oui', 'Opérations récurrentes à générer'),
    (p_uid, 'notif_releve', 'Oui', 'Relevé de soldes de fin de mois'),
    (p_uid, 'notif_echeances', 'Oui', 'Échéances et rappels'),
    (p_uid, 'notif_provision', 'Oui', 'Montant à mettre de côté après une facture payée');
  insert into public.accounts (user_id, nom, devise, dispo, ordre) values
    (p_uid, 'Compte courant', 'EUR', 'Oui', 1), (p_uid, 'Épargne', 'EUR', 'Oui', 2);
  insert into public.categories (user_id, activite, sens, groupe, nature, icone, categorie)
  select p_uid, g.a, g.s, g.grp, g.n, split_part(c.i, '|', 1), split_part(c.i, '|', 2)
  from (values
    ('Perso','Dépense','Logement','Courant', array['🏠|Loyer','💡|Charges','🛡️|Assurance Habitation','🔧|Entretien & Bricolage']),
    ('Perso','Dépense','Mobilité','Courant', array['🚇|Transports en Commun','⛽|Carburant','🛠️|Entretien Véhicule','🚘|Assurance Auto','🅿️|Stationnement','🛣️|Autoroute']),
    ('Perso','Dépense','Alimentation','Courant', array['🛒|Courses','🍴|Restaurant','☕|Café']),
    ('Perso','Dépense','Santé & Bien-être','Courant', array['💊|Soins Médicaux','🏥|Assurance Santé','💈|Soin & Coiffure','🏃|Activité Sportive']),
    ('Perso','Dépense','Shopping & Loisirs','Courant', array['👕|Vêtements','🎬|Loisirs & Divertissements']),
    ('Perso','Dépense','Télécoms & abonnements','Courant', array['📱|Mobile','🌐|Internet','💻|Abonnements Numériques']),
    ('Perso','Dépense','Cadeaux & dons','Courant', array['🎁|Cadeaux','🤲|Dons']),
    ('Perso','Dépense','Impôts & frais admin','Courant', array['🏛️|Impôts','🧾|Taxes','🏦|Frais Bancaires','⚠️|Amendes']),
    ('Perso','Dépense','Voyages','Courant', array['✈️|Voyages']),
    ('Perso','Dépense','Équipement','Courant', array['☎️|Téléphone','🖥️|Ordinateur','🧺|Electroménager']),
    ('Perso','Dépense','Exceptionnel','Courant', array['🛋️|Meubles','🚙|Acquisition voiture']),
    ('Perso','Dépense','Investissements','Investissement', array['📈|La bourse','🏗️|Immobilier']),
    ('Perso','Dépense','Autres','Courant', array['❓|Autres']),
    ('Perso','Revenu','Revenus','Courant', array['💶|Salaire & primes','📈|Revenu boursier','🏘️|Revenu immobilier','📦|E-commerce','➕|Autres']),
    ('Freelance','Revenu','Revenus','Courant', array['🧾|Prestations']),
    ('Freelance','Revenu','Financement','Financement', array['🧾|TVA collectée']),
    ('Freelance','Dépense','Charges','Courant', array['🏛️|Cotisations URSSAF','🏛️|CFE & taxes','💻|Logiciels & abonnements','🖥️|Matériel','📒|Comptable & banque','🚆|Déplacements pro','➖|Autres frais pro']),
    ('Freelance','Dépense','Financement','Financement', array['🧾|TVA reversée']),
    ('Immobilier','Revenu','Revenus','Courant', array['🏠|Loyer','💡|Charges refacturées']),
    ('Immobilier','Revenu','Investissement','Investissement', array['🔁|Remboursement travaux']),
    ('Immobilier','Revenu','Financement','Financement', array['💰|Apport en capital','🤝|Prêt reçu','🔑|Caution reçue']),
    ('Immobilier','Dépense','Exploitation','Courant', array['💡|Eau & électricité','🧹|Ménage','🔧|Entretien & bricolage','🧑‍💼|Agence & commissions','🧾|Taxes','🏦|Frais bancaires','🚗|Déplacements','📄|Administratif']),
    ('Immobilier','Dépense','Investissement','Investissement', array['🧱|Travaux','🏢|Acquisition']),
    ('Immobilier','Dépense','Financement','Financement', array['🤝|Remboursement prêt','🔑|Restitution caution','💸|Distribution aux associés'])
  ) as g(a, s, grp, n, items) cross join lateral unnest(g.items) as c(i);
end $$;

-- À chaque inscription : création automatique de la base de départ
create or replace function public.ck_on_signup() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.ck_seed(new.id);
  return new;
end $$;
drop trigger if exists ck_on_signup on auth.users;
create trigger ck_on_signup after insert on auth.users for each row execute function public.ck_on_signup();

-- ---------- Suppression définitive du compte (droit à l'effacement) ----------
create or replace function public.delete_my_account(p_confirm text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := public.ck_require_aal2(); t text;
begin
  if p_confirm is distinct from 'SUPPRIMER' then perform public.ck_err('confirmation manquante'); end if;
  delete from public.projet_membres where owner_id = v_uid or user_id = v_uid;
  foreach t in array array['projets','tx','categories','lots','tenants','clients','invoices','recurring','accounts','snapshots','params','rappels','push_subscriptions','notif_log','restore_points','change_log'] loop
    execute format('delete from public.%I where user_id = $1', t) using v_uid;
  end loop;
  delete from auth.users where id = v_uid;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- Taux de change automatiques ----------
-- Enregistre le taux du jour et met à jour le paramètre des comptes en suivi automatique
create or replace function public.ck_fx_store(p_date date, p_rate numeric, p_source text) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int; v text := rtrim(rtrim(round(p_rate, 6)::text, '0'), '.');
begin
  insert into public.fx_rates (date, pair, rate, source) values (p_date, 'MAD/EUR', p_rate, p_source)
  on conflict (pair, date) do update set rate = excluded.rate, source = excluded.source, fetched_at = now();
  perform set_config('cockpit.device', 'taux automatique', true);
  update public.params p set valeur = v
   where p.cle = 'taux_mad_eur' and p.deleted_at is null and p.valeur <> v
     and coalesce((select valeur from public.params a where a.user_id = p.user_id and a.cle = 'taux_auto' and a.deleted_at is null), 'Oui') <> 'Non';
  get diagnostics n = row_count;
  return n;
end $$;

-- Liste des comptes à sauvegarder (rôle de service uniquement)
create or replace function public.ck_backup_users() returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select distinct user_id from public.params
$$;

revoke execute on function public.ck_seed(uuid), public.ck_on_signup(), public.ck_fx_store(date, numeric, text), public.ck_backup_users() from public, anon, authenticated;
grant execute on function public.ck_seed(uuid), public.ck_fx_store(date, numeric, text), public.ck_backup_users() to service_role;
grant execute on function public.delete_my_account(text) to authenticated;
