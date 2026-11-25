-- =====================================================================================
-- Cockpit — règles métier (portées depuis ops.go) et fonctions publiques (RPC)
-- Les fonctions publiques sont SECURITY DEFINER : chaque requête est explicitement limitée
-- à user_id = auth.uid(), et la session doit avoir validé la MFA (aal2).
-- Le client n'a qu'un droit de LECTURE sur les tables : toute écriture passe par ces fonctions.
-- =====================================================================================

create or replace function public.ck_err(p_msg text) returns void language plpgsql as $$
begin raise exception using errcode = 'CK422', message = p_msg; end $$;

create or replace function public.ck_require_aal2() returns uuid
language plpgsql stable set search_path = public, pg_temp as $$
declare v uuid := auth.uid();
begin
  if v is null then raise exception using errcode = 'CK401', message = 'non connecté'; end if;
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception using errcode = 'CK401', message = 'validation du code de sécurité (MFA) requise';
  end if;
  return v;
end $$;

create or replace function public.ck_cols(p_tbl text) returns text[]
language sql stable set search_path = public, pg_temp as $$
  select coalesce(array_agg(a.attname::text order by a.attnum), '{}')
  from pg_attribute a
  where a.attrelid = ('public.' || quote_ident(p_tbl))::regclass and a.attnum > 0 and not a.attisdropped
    and a.attname not in ('id', 'user_id', 'seq', 'created_at', 'updated_at', 'version', 'deleted_at')
$$;

create or replace function public.ck_uuid(p text) returns uuid language plpgsql immutable as $$
begin return p::uuid; exception when others then return null; end $$;

create or replace function public.ck_num(p text) returns numeric language plpgsql immutable as $$
begin return replace(replace(p, ' ', ''), ',', '.')::numeric; exception when others then return null; end $$;

create or replace function public.ck_date(p text) returns date language plpgsql immutable as $$
begin return left(p, 10)::date; exception when others then return null; end $$;

create or replace function public.ck_param(p_uid uuid, p_key text, p_def numeric) returns numeric
language sql stable set search_path = public, pg_temp as $$
  select coalesce((select public.ck_num(valeur) from public.params where user_id = p_uid and cle = p_key and deleted_at is null), p_def)
$$;

create or replace function public.ck_get(p_uid uuid, p_tbl text, p_id uuid) returns jsonb
language plpgsql stable set search_path = public, pg_temp as $$
declare v jsonb;
begin
  if p_id is null then return null; end if;
  execute format('select to_jsonb(t) from public.%I t where id = $1 and user_id = $2', p_tbl) into v using p_id, p_uid;
  return v;
end $$;

-- Écrit une ligne (insert ou update) à partir d'un jsonb aux noms de colonnes de la base.
create or replace function public.ck_write(p_uid uuid, p_tbl text, p_row jsonb, p_exists boolean) returns uuid
language plpgsql set search_path = public, pg_temp as $$
declare v_id uuid := public.ck_uuid(p_row ->> 'id'); v_cols text[]; v_list text; v_sel text; v_set text;
begin
  select coalesce(array_agg(c), '{}') into v_cols from unnest(public.ck_cols(p_tbl)) c where p_row ? c;
  if p_exists then
    if cardinality(v_cols) = 0 then return v_id; end if;
    select string_agg(format('%I = r.%I', c, c), ', ') into v_set from unnest(v_cols) c;
    execute format('update public.%I t set %s from jsonb_populate_record(null::public.%I, $1) r where t.id = $2 and t.user_id = $3',
                   p_tbl, v_set, p_tbl) using p_row, v_id, p_uid;
  else
    v_id := coalesce(v_id, gen_random_uuid());
    select coalesce(string_agg(format('%I', c), ', '), '') , coalesce(string_agg(format('r.%I', c), ', '), '')
      into v_list, v_sel from unnest(v_cols) c;
    execute format('insert into public.%I (id, user_id%s) select $2, $3%s from jsonb_populate_record(null::public.%I, $1) r',
                   p_tbl, case when v_list <> '' then ', ' || v_list else '' end,
                   case when v_sel <> '' then ', ' || v_sel else '' end, p_tbl) using p_row, v_id, p_uid;
  end if;
  return v_id;
end $$;

create or replace function public.ck_conflict(p_tbl text, p_row jsonb) returns void language plpgsql as $$
begin
  raise exception using errcode = 'CK409', message = 'modifié sur un autre appareil',
    detail = jsonb_build_object('table', p_tbl, 'row', p_row)::text;
end $$;

-- ---------- Normalisation (équivalent de fixTx / fixInvoice / fixSnapshot en Go) ----------
create or replace function public.ck_fix(p_uid uuid, p_tbl text, j jsonb) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare d date; m numeric; dev text; tx numeric; nat text; ht numeric; tva numeric; yr text; n int; st text; j2 int;
begin
  dev := case when j ->> 'devise' = 'MAD' then 'MAD' else 'EUR' end;
  if p_tbl = 'tx' then
    d := public.ck_date(j ->> 'date');
    if d is null then perform public.ck_err('date invalide'); end if;
    m := public.ck_num(j ->> 'montant');
    if m is null or m <= 0 then perform public.ck_err('le montant doit être supérieur à 0'); end if;
    if coalesce(j ->> 'activite', '') not in ('Perso', 'Freelance', 'Immobilier') then perform public.ck_err('activité invalide'); end if;
    if coalesce(j ->> 'sens', '') not in ('Revenu', 'Dépense') then perform public.ck_err('sens invalide'); end if;
    if btrim(coalesce(j ->> 'categorie', '')) = '' then perform public.ck_err('choisis une catégorie'); end if;
    m := round(m, 2);
    tx := public.ck_num(j ->> 'taux');
    if dev = 'EUR' then tx := 1;
    elsif tx is null or tx <= 0 or tx = 1 then tx := public.ck_param(p_uid, 'taux_mad_eur', 0.093); end if;
    nat := nullif(j ->> 'nature', '');
    if nat is null then
      select c.nature into nat from public.categories c
      where c.user_id = p_uid and c.activite = j ->> 'activite' and c.sens = j ->> 'sens' and c.categorie = btrim(j ->> 'categorie') and c.deleted_at is null;
    end if;
    if coalesce(nat, '') not in ('Courant', 'Investissement', 'Financement') then nat := 'Courant'; end if;
    return j || jsonb_build_object('date', d, 'montant', m, 'devise', dev, 'taux', tx, 'montant_eur', round(m * tx, 2), 'nature', nat,
      'periode', coalesce(nullif(j ->> 'periode', ''), to_char(d, 'YYYY-MM')), 'libelle', btrim(coalesce(j ->> 'libelle', '')),
      'categorie', btrim(j ->> 'categorie'));

  elsif p_tbl = 'invoices' then
    if btrim(coalesce(j ->> 'client', '')) = '' then perform public.ck_err('choisis un client'); end if;
    if length(coalesce(j ->> 'periode', '')) <> 7 then perform public.ck_err('période invalide (AAAA-MM)'); end if;
    ht := coalesce(public.ck_num(j ->> 'ht'), 0);
    if ht = 0 then ht := coalesce(public.ck_num(j ->> 'jours'), 0) * coalesce(public.ck_num(j ->> 'tjm'), 0); end if;
    ht := round(ht, 2);
    tva := coalesce(public.ck_num(j ->> 'tva'), 0);
    st := case when j ->> 'statut' in ('Planifiée', 'Envoyée', 'Payée') then j ->> 'statut' else 'Planifiée' end;
    j := j || jsonb_build_object('devise', dev, 'ht', ht, 'ttc', round(ht * (1 + tva), 2), 'statut', st);
    if coalesce(j ->> 'numero', '') = '' then
      yr := coalesce(left(nullif(j ->> 'emission', ''), 4), left(j ->> 'periode', 4));
      perform pg_advisory_xact_lock(hashtext(p_uid::text || ':invoice-number'));
      select coalesce(max(public.ck_num(substr(numero, length('F-' || yr || '-') + 1))), 0) + 1 into n
      from public.invoices where user_id = p_uid and deleted_at is null and numero like 'F-' || yr || '-%';
      j := j || jsonb_build_object('numero', format('F-%s-%s', yr, lpad(n::text, 3, '0')));
    end if;
    return j;

  elsif p_tbl = 'snapshots' then
    d := public.ck_date(j ->> 'date');
    if d is null then perform public.ck_err('date invalide'); end if;
    m := coalesce(public.ck_num(j ->> 'solde'), 0);
    return j || jsonb_build_object('date', d, 'devise', dev,
      'solde_eur', round(m * case when dev = 'MAD' then public.ck_param(p_uid, 'taux_mad_eur', 0.093) else 1 end, 2));

  elsif p_tbl = 'tenants' then
    if btrim(coalesce(j ->> 'nom', '')) = '' or coalesce(j ->> 'lot', '') = '' then perform public.ck_err('nom et lot obligatoires'); end if;
    return j || jsonb_build_object('nom', btrim(j ->> 'nom'));

  elsif p_tbl = 'clients' then
    if btrim(coalesce(j ->> 'nom', '')) = '' then perform public.ck_err('nom du client obligatoire'); end if;
    return j || jsonb_build_object('nom', btrim(j ->> 'nom'), 'devise', dev);

  elsif p_tbl = 'recurring' then
    if coalesce(public.ck_num(j ->> 'montant'), 0) <= 0 or coalesce(j ->> 'categorie', '') = '' or btrim(coalesce(j ->> 'libelle', '')) = '' then
      perform public.ck_err('libellé, catégorie et montant obligatoires');
    end if;
    j2 := coalesce(public.ck_num(j ->> 'jour'), 1)::int;
    return j || jsonb_build_object('jour', case when j2 between 1 and 31 then j2 else 1 end,
      'actif', case when j ->> 'actif' = 'Non' then 'Non' else 'Oui' end, 'devise', dev, 'libelle', btrim(j ->> 'libelle'));

  elsif p_tbl = 'accounts' then
    if btrim(coalesce(j ->> 'nom', '')) = '' then perform public.ck_err('nom du compte obligatoire'); end if;
    return j || jsonb_build_object('nom', btrim(j ->> 'nom'), 'devise', dev);

  elsif p_tbl = 'lots' then
    if btrim(coalesce(j ->> 'nom', '')) = '' then perform public.ck_err('nom du lot obligatoire'); end if;
    return j || jsonb_build_object('nom', btrim(j ->> 'nom'));

  elsif p_tbl = 'rappels' then
    if btrim(coalesce(j ->> 'titre', '')) = '' then perform public.ck_err('titre du rappel obligatoire'); end if;
    d := public.ck_date(j ->> 'date');
    if d is null then perform public.ck_err('date d''échéance invalide'); end if;
    return j || jsonb_build_object('titre', btrim(j ->> 'titre'), 'date', d,
      'frequence', case when j ->> 'frequence' in ('Une fois', 'Mensuel', 'Trimestriel', 'Annuel') then j ->> 'frequence' else 'Une fois' end,
      'avance', greatest(0, coalesce(public.ck_num(j ->> 'avance'), 0)::int),
      'actif', case when j ->> 'actif' = 'Non' then 'Non' else 'Oui' end);
  end if;
  return j;
end $$;

-- Renommage : propage le nouveau nom aux lignes qui y font référence (liens par nom hérités d'Excel)
create or replace function public.ck_cascade(p_uid uuid, p_tbl text, p_old jsonb, p_new jsonb) returns void
language plpgsql set search_path = public, pg_temp as $$
declare o text := p_old ->> 'nom'; n text := p_new ->> 'nom';
begin
  if o is null or n is null or o = n then return; end if;
  if p_tbl = 'lots' then
    update public.tx set lot = n where user_id = p_uid and lot = o and deleted_at is null;
    update public.tenants set lot = n where user_id = p_uid and lot = o and deleted_at is null;
    update public.recurring set lot = n where user_id = p_uid and lot = o and deleted_at is null;
  elsif p_tbl = 'clients' then
    update public.invoices set client = n where user_id = p_uid and client = o and deleted_at is null;
    update public.tx set tiers = n where user_id = p_uid and activite = 'Freelance' and tiers = o and deleted_at is null;
  elsif p_tbl = 'accounts' then
    update public.snapshots set compte = n where user_id = p_uid and compte = o and deleted_at is null;
  elsif p_tbl = 'tenants' then
    update public.tx set tiers = n where user_id = p_uid and activite = 'Immobilier' and tiers = o and deleted_at is null;
  end if;
end $$;

create or replace function public.ck_table_of(p_entity text) returns text language sql immutable as $$
  select case p_entity when 'tx' then 'tx' when 'lot' then 'lots' when 'tenant' then 'tenants' when 'client' then 'clients'
    when 'invoice' then 'invoices' when 'recurring' then 'recurring' when 'account' then 'accounts'
    when 'snapshot' then 'snapshots' when 'rappel' then 'rappels' end
$$;

-- ---------- Actions ----------
create or replace function public.ck_action(p_uid uuid, p_key text, p_item jsonb) returns void
language plpgsql set search_path = public, pg_temp as $$
declare v_month text; v_first date; v_last date; r record; v_ref text; v_day int; v_rate numeric;
begin
  if p_key = 'generate_recurring' then
    v_month := p_item ->> 'month';
    v_first := public.ck_date(v_month || '-01');
    if v_first is null or length(v_month) <> 7 then perform public.ck_err('mois invalide'); end if;
    v_last := (v_first + interval '1 month - 1 day')::date;
    for r in select * from public.recurring where user_id = p_uid and deleted_at is null and actif <> 'Non'
               and (debut is null or debut <= v_last) and (fin is null or fin >= v_first) order by seq loop
      v_ref := format('REC%s:%s', r.id, v_month);
      continue when exists (select 1 from public.tx where user_id = p_uid and ref = v_ref and deleted_at is null);
      v_day := least(r.jour, extract(day from v_last)::int);
      begin
        perform public.ck_write(p_uid, 'tx', public.ck_fix(p_uid, 'tx', jsonb_build_object(
          'date', format('%s-%s', v_month, lpad(v_day::text, 2, '0')), 'activite', r.activite, 'sens', r.sens,
          'categorie', r.categorie, 'libelle', r.libelle, 'montant', r.montant, 'devise', r.devise, 'nature', r.nature,
          'tiers', r.tiers, 'lot', r.lot, 'ref', v_ref)), false);
      exception when sqlstate 'CK422' then
        perform public.ck_err(format('récurrent « %s » : %s', r.libelle, sqlerrm));
      end;
    end loop;
  elsif p_key = 'recompute_rates' then
    v_rate := public.ck_param(p_uid, 'taux_mad_eur', 0.093);
    update public.tx set taux = v_rate, montant_eur = round(montant * v_rate, 2)
      where user_id = p_uid and devise = 'MAD' and deleted_at is null and (taux <> v_rate or montant_eur <> round(montant * v_rate, 2));
    update public.snapshots set solde_eur = round(solde * v_rate, 2)
      where user_id = p_uid and devise = 'MAD' and deleted_at is null and solde_eur <> round(solde * v_rate, 2);
  else
    perform public.ck_err('action inconnue : ' || coalesce(p_key, ''));
  end if;
end $$;

-- ---------- Application d'un lot d'opérations (transaction unique) ----------
create or replace function public.ck_apply(p_uid uuid, p_ops jsonb, p_device text) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare o jsonb; e text; op text; tbl text; item jsonb; v_id uuid; cur jsonb; full_row jsonb; ids uuid[] := '{}'; ver int; ex boolean;
begin
  perform set_config('cockpit.device', left(coalesce(p_device, ''), 60), true);
  if jsonb_typeof(p_ops) <> 'array' then perform public.ck_err('format invalide'); end if;
  for o in select * from jsonb_array_elements(p_ops) loop
    e := o ->> 'e'; op := coalesce(o ->> 'op', 'upsert'); item := coalesce(o -> 'item', '{}'::jsonb);

    if e = 'action' then perform public.ck_action(p_uid, o ->> 'key', item); continue; end if;

    if e = 'param' then
      if coalesce(item ->> 'cle', '') = '' then perform public.ck_err('paramètre invalide'); end if;
      update public.params set valeur = coalesce(item ->> 'valeur', ''), deleted_at = null,
             libelle = coalesce(nullif(item ->> 'libelle', ''), libelle)
       where user_id = p_uid and cle = item ->> 'cle';
      if not found then
        insert into public.params (user_id, cle, valeur, libelle)
        values (p_uid, item ->> 'cle', coalesce(item ->> 'valeur', ''), coalesce(item ->> 'libelle', ''));
      end if;
      continue;
    end if;

    if e = 'category' then
      if coalesce(item ->> 'categorie', '') = '' or coalesce(item ->> 'activite', '') = '' or coalesce(item ->> 'sens', '') = '' then
        perform public.ck_err('catégorie incomplète');
      end if;
      if op = 'delete' then
        update public.categories set deleted_at = now() where user_id = p_uid and activite = item ->> 'activite'
          and sens = item ->> 'sens' and categorie = item ->> 'categorie' and deleted_at is null;
      else
        update public.categories set groupe = coalesce(nullif(item ->> 'groupe', ''), 'Autres'),
               nature = coalesce(nullif(item ->> 'nature', ''), 'Courant'), icone = coalesce(nullif(item ->> 'icone', ''), '•'), deleted_at = null
         where user_id = p_uid and activite = item ->> 'activite' and sens = item ->> 'sens' and categorie = item ->> 'categorie';
        if not found then
          insert into public.categories (user_id, activite, sens, categorie, groupe, nature, icone)
          values (p_uid, item ->> 'activite', item ->> 'sens', btrim(item ->> 'categorie'), coalesce(nullif(item ->> 'groupe', ''), 'Autres'),
                  coalesce(nullif(item ->> 'nature', ''), 'Courant'), coalesce(nullif(item ->> 'icone', ''), '•'));
        end if;
      end if;
      continue;
    end if;

    tbl := public.ck_table_of(e);
    if tbl is null then perform public.ck_err('opération inconnue : ' || coalesce(e, '')); end if;

    if op = 'delete' then
      v_id := public.ck_uuid(o ->> 'id');
      cur := public.ck_get(p_uid, tbl, v_id);
      if cur is null or cur ->> 'deleted_at' is not null then continue; end if;   -- déjà supprimée : rien à faire
      ver := (o ->> 'version')::int;
      if ver is not null and ver <> (cur ->> 'version')::int then perform public.ck_conflict(tbl, cur); end if;
      execute format('update public.%I set deleted_at = now() where id = $1 and user_id = $2', tbl) using v_id, p_uid;
      continue;
    end if;

    v_id := public.ck_uuid(item ->> 'id');
    cur := public.ck_get(p_uid, tbl, v_id);
    if cur is null and v_id is not null then
      execute format('select exists (select 1 from public.%I where id = $1)', tbl) into ex using v_id;
      if ex then perform public.ck_err('identifiant déjà utilisé'); end if;
    end if;
    if cur is not null then
      if coalesce((item ->> '_insert')::boolean, false) then continue; end if;      -- rejeu d'une création déjà appliquée
      ver := (item ->> 'version')::int;
      if ver is not null and ver <> (cur ->> 'version')::int then perform public.ck_conflict(tbl, cur); end if;
      if cur ->> 'deleted_at' is not null then perform public.ck_conflict(tbl, cur); end if;
      full_row := cur || (item - 'version' - '_insert');
    else
      full_row := item - 'version' - '_insert';
    end if;
    full_row := public.ck_fix(p_uid, tbl, full_row);
    if cur is not null then perform public.ck_cascade(p_uid, tbl, cur, full_row); end if;
    ids := ids || public.ck_write(p_uid, tbl, full_row, cur is not null);
  end loop;
  return jsonb_build_object('ok', true, 'ids', to_jsonb(ids));
end $$;

-- ---------- Export, instantanés, restauration ----------
create or replace function public.ck_export(p_uid uuid) returns jsonb
language plpgsql stable set search_path = public, pg_temp as $$
declare t text; v jsonb := '{}'::jsonb; a jsonb;
begin
  foreach t in array array['tx','categories','lots','tenants','clients','invoices','recurring','accounts','snapshots','params','rappels'] loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x) - ''user_id'' order by x.seq), ''[]'') from public.%I x where user_id = $1 and deleted_at is null', t)
      into a using p_uid;
    v := v || jsonb_build_object(t, a);
  end loop;
  return v;
end $$;

create or replace function public.ck_snapshot(p_uid uuid, p_label text) returns bigint
language plpgsql set search_path = public, pg_temp as $$
declare v jsonb := public.ck_export(p_uid); n int := 0; k text; v_id bigint;
begin
  for k in select jsonb_object_keys(v) loop n := n + jsonb_array_length(v -> k); end loop;
  insert into public.restore_points (user_id, label, rows, data) values (p_uid, p_label, n, v) returning id into v_id;
  delete from public.restore_points where user_id = p_uid and id not in
    (select id from public.restore_points where user_id = p_uid order by created_at desc limit 30);
  return v_id;
end $$;

-- Remplace toutes les données par celles fournies (import Excel / point de restauration).
-- Un instantané de l'état actuel est créé avant. Les lignes absentes sont supprimées logiquement
-- (donc propagées aux autres appareils et récupérables). Une table absente du fichier n'est pas touchée.
create or replace function public.ck_restore(p_uid uuid, p_data jsonb, p_label text) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare t text; r jsonb; v_id uuid; keep uuid[]; cnt jsonb := '{}'::jsonb; n int; owner uuid; ex boolean;
begin
  perform public.ck_snapshot(p_uid, coalesce(p_label, 'Avant restauration'));
  perform set_config('cockpit.device', 'restauration', true);
  foreach t in array array['tx','categories','lots','tenants','clients','invoices','recurring','accounts','snapshots','params','rappels'] loop
    continue when jsonb_typeof(p_data -> t) is distinct from 'array';
    keep := '{}'; n := 0;
    for r in select * from jsonb_array_elements(p_data -> t) loop
      v_id := public.ck_uuid(r ->> 'id');
      if v_id is null and t = 'params' then
        select id into v_id from public.params where user_id = p_uid and cle = r ->> 'cle';
      elsif v_id is null and t = 'categories' then
        select id into v_id from public.categories where user_id = p_uid and activite = r ->> 'activite' and sens = r ->> 'sens' and categorie = r ->> 'categorie';
      end if;
      owner := null;
      if v_id is not null then execute format('select user_id from public.%I where id = $1', t) into owner using v_id; end if;
      if owner is not null and owner <> p_uid then v_id := null; owner := null; end if;   -- jamais toucher les lignes d'un autre
      ex := owner is not null;
      r := (r - 'id' - 'user_id' - 'seq' - 'created_at' - 'updated_at' - 'version' - 'deleted_at')
           || case when v_id is not null then jsonb_build_object('id', v_id) else '{}'::jsonb end;
      v_id := public.ck_write(p_uid, t, r, ex);
      if ex then execute format('update public.%I set deleted_at = null where id = $1 and user_id = $2 and deleted_at is not null', t) using v_id, p_uid; end if;
      keep := keep || v_id; n := n + 1;
    end loop;
    execute format('update public.%I set deleted_at = now() where user_id = $1 and deleted_at is null and not (id = any($2))', t) using p_uid, keep;
    cnt := cnt || jsonb_build_object(t, n);
  end loop;
  return jsonb_build_object('ok', true, 'counts', cnt);
end $$;

-- ---------- Fonctions publiques (appelées par l'application) ----------
create or replace function public.apply_ops(p_ops jsonb, p_device text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin return public.ck_apply(public.ck_require_aal2(), p_ops, p_device); end $$;

create or replace function public.restore_all(p_data jsonb, p_label text default 'Avant restauration depuis Excel') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin return public.ck_restore(public.ck_require_aal2(), p_data, p_label); end $$;

create or replace function public.create_restore_point(p_label text default 'Manuel') returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
begin return public.ck_snapshot(public.ck_require_aal2(), left(coalesce(p_label, 'Manuel'), 80)); end $$;

create or replace function public.restore_point(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := public.ck_require_aal2(); v jsonb; d timestamptz;
begin
  select data, created_at into v, d from public.restore_points where id = p_id and user_id = v_uid;
  if v is null then perform public.ck_err('point de restauration introuvable'); end if;
  return public.ck_restore(v_uid, v, 'Avant retour au point du ' || to_char(d at time zone 'Europe/Paris', 'DD/MM/YYYY HH24:MI'));
end $$;

-- Remet une ligne dans l'état où elle était AVANT une modification du journal
create or replace function public.restore_version(p_log_id bigint) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := public.ck_require_aal2(); l public.change_log; cur jsonb; target jsonb;
begin
  select * into l from public.change_log where id = p_log_id and user_id = v_uid;
  if l.id is null then perform public.ck_err('modification introuvable'); end if;
  perform set_config('cockpit.device', 'historique', true);
  cur := public.ck_get(v_uid, l.tbl, l.row_id);
  if l.action = 'insert' then
    -- annuler une création = supprimer la ligne
    if cur is not null and cur ->> 'deleted_at' is null then
      execute format('update public.%I set deleted_at = now() where id = $1 and user_id = $2', l.tbl) using l.row_id, v_uid;
    end if;
  else
    target := l.old_row - 'user_id' - 'seq' - 'created_at' - 'updated_at' - 'version' - 'deleted_at';
    perform public.ck_write(v_uid, l.tbl, target, cur is not null);
    execute format('update public.%I set deleted_at = $3 where id = $1 and user_id = $2', l.tbl)
      using l.row_id, v_uid, (l.old_row ->> 'deleted_at')::timestamptz;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Instantané quotidien de tous les comptes (appelé par pg_cron)
create or replace function public.ck_daily() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid;
begin
  for u in select distinct user_id from public.params loop
    perform public.ck_snapshot(u, 'Automatique (quotidien)');
  end loop;
  delete from public.notif_log where sent_at < now() - interval '400 days';
end $$;

-- ---------- Droits ----------
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.apply_ops(jsonb, text), public.restore_all(jsonb, text), public.create_restore_point(text),
  public.restore_point(bigint), public.restore_version(bigint) to authenticated;
-- Les fonctions de trigger doivent rester exécutables par le propriétaire uniquement (elles s'exécutent en tant que tel).
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
