-- Hosted Auth inserts a user before applying custom app metadata and email
-- confirmation. Finalize the exact managed identity after Auth returns, and
-- allow a safe retry to finish an interrupted creation without a password reset.
begin;

create or replace function portal_private.protect_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(192837465, 918273645);
  if old.role = 'admin' and old.status = 'approved' and not old.must_change_password and (
    tg_op = 'DELETE' or new.role <> 'admin' or new.status <> 'approved' or new.must_change_password
  ) and not exists (select 1 from public.profiles where id <> old.id and role = 'admin' and status = 'approved' and not must_change_password) then
    raise exception '必須保留至少一位已核准的管理員。' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if new.username is distinct from old.username and not (
    old.username is null and old.role = 'student' and old.status = 'pending'
    and old.version = 1 and not old.must_change_password
    and new.username is not null and new.role = 'student' and new.status = 'approved' and new.must_change_password
    and exists (
      select 1 from auth.users u join public.profiles actor
        on actor.id::text = u.raw_app_meta_data->>'course_created_by'
      where u.id = old.id and u.email = lower(new.username) || '@accounts.cantonese.invalid'
        and u.email_confirmed_at is not null and u.raw_app_meta_data->>'course_managed' = 'true'
        and u.raw_app_meta_data->>'course_username' = new.username
        and actor.id <> old.id and actor.role = 'admin' and actor.status = 'approved' and not actor.must_change_password
    )
  ) then
    raise exception '登入賬戶名稱建立後不可更改。' using errcode = '23514';
  end if;
  if new.must_change_password and new.role <> 'student' then
    raise exception '請先完成首次更改密碼，再提升賬戶角色。' using errcode = '23514';
  end if;
  if new.status = 'approved' and not exists (select 1 from auth.users where id = new.id and email_confirmed_at is not null) then
    raise exception '請先完成電郵驗證，然後再核准賬戶。' using errcode = '23514';
  end if;
  new.version := old.version + 1;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create function public.service_finalize_managed_account(p_username text, p_actor_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user auth.users; v_profile public.profiles;
begin
  perform pg_catalog.pg_advisory_xact_lock(192837465, 918273645);
  if p_username is null or p_username !~ '^[A-Z][A-Z0-9]{1,59}$'
    or not exists (select 1 from public.profiles where id = p_actor_id and role = 'admin' and status = 'approved' and not must_change_password) then
    raise exception 'Invalid managed account provisioning actor.' using errcode = '42501';
  end if;
  select * into v_user from auth.users where email = lower(p_username) || '@accounts.cantonese.invalid';
  if not found then return null; end if;
  if (select count(*) from auth.users where email = lower(p_username) || '@accounts.cantonese.invalid') <> 1 then
    raise exception 'Managed Auth identity is ambiguous.' using errcode = '23514';
  end if;
  if v_user.id = p_actor_id or v_user.email_confirmed_at is null
    or v_user.raw_app_meta_data->>'course_managed' is distinct from 'true'
    or v_user.raw_app_meta_data->>'course_username' is distinct from p_username then
    raise exception 'Managed Auth identity is not ready.' using errcode = '42501';
  end if;
  select * into v_profile from public.profiles where id = v_user.id for update;
  if not found then raise exception 'Managed profile is missing.' using errcode = '23514'; end if;
  if v_profile.username = p_username then
    -- A repeated create must preserve status, role, version, password-change
    -- state and the provider password, including suspended existing accounts.
    return jsonb_build_object('id',v_profile.id,'provisioned',false);
  end if;
  if v_user.raw_app_meta_data->>'course_created_by' is distinct from p_actor_id::text
    or v_profile.username is not null or v_profile.role <> 'student' or v_profile.status <> 'pending'
    or v_profile.version <> 1 or v_profile.must_change_password then
    raise exception 'Managed creation cannot overwrite an existing account.' using errcode = '23514';
  end if;
  update public.profiles set username = p_username, status = 'approved', must_change_password = true
    where id = v_profile.id returning * into v_profile;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,after_data)
  values (p_actor_id,'create_managed_account','profiles',v_profile.id::text,
    jsonb_build_object('display_name',v_profile.display_name,'username',p_username,'role','student','must_change_password',true));
  return jsonb_build_object('id',v_profile.id,'provisioned',true);
end;
$$;
revoke execute on function public.service_finalize_managed_account(text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.service_finalize_managed_account(text,uuid) to service_role;
-- No direct profile grants, Auth mutations or automatic bulk repair are added.
notify pgrst, 'reload schema';
commit;
