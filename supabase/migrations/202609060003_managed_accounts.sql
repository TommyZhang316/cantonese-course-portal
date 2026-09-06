-- Managed classroom accounts. Student names are initial credentials only;
-- a mandatory password change is enforced by database and Storage policies.
begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
do $$ begin
  if to_regprocedure('extensions.crypt(text,text)') is null or to_regprocedure('extensions.digest(text,text)') is null then
    raise exception 'pgcrypto must be installed in the extensions schema before applying this migration.';
  end if;
end $$;

alter table public.profiles
  add column username text unique check (username is null or username ~ '^[A-Z][A-Z0-9]{1,59}$'),
  add column must_change_password boolean not null default false;

create table portal_private.account_resets (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  token uuid unique not null default gen_random_uuid(),
  actor_id uuid not null,
  started_at timestamptz not null default clock_timestamp()
);
alter table portal_private.account_resets enable row level security;
revoke all on portal_private.account_resets from public, anon, authenticated, service_role;

create function portal_private.current_session_is_valid() returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_session text := auth.jwt()->>'session_id';
begin
  -- Signed JWTs remain cryptographically valid after logout/password change.
  -- Auth removes revoked sessions, so consult the live row on every protected
  -- operation rather than treating a JWT subject as continuing authorization.
  if v_session is null or v_session !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return false;
  end if;
  return exists (select 1 from auth.sessions s where s.id = v_session::uuid and s.user_id = auth.uid()
    and (s.not_after is null or s.not_after > statement_timestamp()));
end;
$$;
revoke execute on function portal_private.current_session_is_valid() from public, anon, authenticated, service_role;
grant execute on function portal_private.current_session_is_valid() to authenticated;

create or replace function portal_private.is_active() returns boolean
language sql stable security definer set search_path = '' as $$
  select portal_private.current_session_is_valid() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'approved' and not p.must_change_password);
$$;
create or replace function portal_private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select portal_private.current_session_is_valid() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'approved' and p.role = 'admin' and not p.must_change_password);
$$;
create or replace function portal_private.can_access_resource(p_resource_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select portal_private.current_session_is_valid() and exists (
    select 1 from public.profiles p join public.resources r on r.id = p_resource_id
    where p.id = auth.uid() and p.status = 'approved' and not p.must_change_password and (
      p.role = 'admin' or (r.archived_at is null and (
        p.role = 'teacher' or (p.role = 'student' and (
          r.student_policy = 'immediate' or (r.student_policy = 'scheduled' and r.release_at <= statement_timestamp())
        ))
      ))
    )
  );
$$;

drop policy profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (
  (select portal_private.current_session_is_valid()) and (id = (select auth.uid()) or (select portal_private.is_admin()))
);

create or replace function portal_private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_username text; v_actor uuid;
begin
  -- Auth Admin API alone can set raw_app_meta_data. Never trust user metadata
  -- for account type, username, approval, or password-change state.
  if new.raw_app_meta_data->>'course_managed' = 'true' then
    v_username := new.raw_app_meta_data->>'course_username';
    v_actor := (new.raw_app_meta_data->>'course_created_by')::uuid;
    if v_username is null or v_username !~ '^[A-Z][A-Z0-9]{1,59}$'
      or new.email is distinct from lower(v_username) || '@accounts.cantonese.invalid'
      or not exists (select 1 from public.profiles where id = v_actor and role = 'admin' and status = 'approved' and not must_change_password) then
      raise exception 'Invalid managed account provisioning context.' using errcode = '42501';
    end if;
    -- email_confirm:true in Auth Admin creation represents a login alias,
    -- never a real student email address or an email delivery request.
    insert into public.profiles(id,email,display_name,role,status,username,must_change_password)
    values (new.id,new.email,left(coalesce(nullif(btrim(new.raw_user_meta_data->>'display_name'), ''),v_username),100),'student','approved',v_username,true);
    insert into public.audit_log(actor_id,action,entity_type,entity_id,after_data)
    values (v_actor,'create_managed_account','profiles',new.id::text,jsonb_build_object('display_name',new.raw_user_meta_data->>'display_name','username',v_username,'role','student','must_change_password',true));
  else
    insert into public.profiles(id,email,display_name,role,status)
    values (new.id,coalesce(new.email,''),left(coalesce(nullif(btrim(new.raw_user_meta_data->>'display_name'), ''),'新同學'),100),'student','pending');
  end if;
  return new;
end;
$$;

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
  if new.username is distinct from old.username then
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

create function portal_private.enforce_managed_auth() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_profile public.profiles; v_initial text;
begin
  select * into v_profile from public.profiles where id = new.id;
  if v_profile.username is null then return new; end if;
  if new.email is distinct from lower(v_profile.username) || '@accounts.cantonese.invalid' then
    raise exception '由後臺建立的賬戶使用固定登入名稱。' using errcode = '23514';
  end if;
  if new.encrypted_password is distinct from old.encrypted_password and not v_profile.must_change_password then
    v_initial := encode(extensions.digest('course-initial-v1:' || v_profile.username, 'sha256'), 'hex');
    if new.encrypted_password is null or new.encrypted_password = ''
      or extensions.crypt(v_initial,new.encrypted_password) = new.encrypted_password
      or extensions.crypt(v_profile.username,new.encrypted_password) = new.encrypted_password then
      -- A late provider reset or a direct Auth call can never restore initial
      -- credentials while leaving course access unlocked. Privileged accounts
      -- cannot be reset to these predictable credentials (profile guard).
      update public.profiles set must_change_password = true where id = new.id;
    end if;
  end if;
  return new;
end;
$$;
create trigger portal_enforce_managed_auth after update of encrypted_password,email on auth.users
for each row execute function portal_private.enforce_managed_auth();

create function public.complete_initial_password_change() returns public.profiles
language plpgsql security definer set search_path = '' as $$
declare v_profile public.profiles; v_encrypted text; v_initial text;
begin
  -- Use the same lock order as profile changes and admin reset initiation.
  perform pg_catalog.pg_advisory_xact_lock(192837465, 918273645);
  if not portal_private.current_session_is_valid() then raise exception '登入已失效，請重新登入。' using errcode = '42501'; end if;
  select * into v_profile from public.profiles where id = auth.uid() for update;
  if not found then raise exception '請先登入。' using errcode = '42501'; end if;
  if not v_profile.must_change_password then return v_profile; end if;
  if v_profile.username is null then raise exception '此賬戶無法完成首次密碼設定。' using errcode = '23514'; end if;
  if exists (select 1 from portal_private.account_resets where profile_id = v_profile.id) then
    raise exception '管理員正在重設密碼，請稍後重新登入。' using errcode = '40001';
  end if;
  select encrypted_password into v_encrypted from auth.users where id = v_profile.id for share;
  -- Public transport encoding only accommodates Auth's >=12 character rule.
  -- It does NOT make a predictable name password stronger or secret.
  v_initial := encode(extensions.digest('course-initial-v1:' || v_profile.username, 'sha256'), 'hex');
  if v_encrypted is null or v_encrypted = ''
    or extensions.crypt(v_initial,v_encrypted) = v_encrypted
    or extensions.crypt(v_profile.username,v_encrypted) = v_encrypted then
    raise exception '請先設定與賬戶名稱不同的新密碼。' using errcode = '23514';
  end if;
  update public.profiles set must_change_password = false where id = v_profile.id returning * into v_profile;
  return v_profile;
end;
$$;

create function public.admin_begin_account_reset(p_profile_id uuid, p_expected_version integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_profile public.profiles; v_reset portal_private.account_resets;
begin
  perform pg_catalog.pg_advisory_xact_lock(192837465, 918273645);
  perform portal_private.require_admin();
  select * into v_profile from public.profiles where id = p_profile_id for update;
  if not found then raise exception '找不到賬戶。' using errcode = 'P0002'; end if;
  if p_expected_version is null or v_profile.version <> p_expected_version then
    raise exception '版本已更新，請重新載入後再試。' using errcode = '40001';
  end if;
  if v_profile.username is null or v_profile.role <> 'student' then
    raise exception '只可重設由後臺建立的學生賬戶。' using errcode = '23514';
  end if;
  if exists (select 1 from portal_private.account_resets where profile_id = p_profile_id and started_at > clock_timestamp() - interval '5 minutes') then
    raise exception '重設進行中，請稍後再試。' using errcode = '40001';
  end if;
  insert into portal_private.account_resets(profile_id,actor_id) values (p_profile_id,auth.uid())
  on conflict (profile_id) do update set token = gen_random_uuid(),actor_id = excluded.actor_id,started_at = clock_timestamp()
  returning * into v_reset;
  update public.profiles set must_change_password = true where id = p_profile_id returning * into v_profile;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,after_data)
  values (auth.uid(),'begin_account_reset','profiles',p_profile_id::text,jsonb_build_object('username',v_profile.username,'must_change_password',true));
  return jsonb_build_object('id',v_profile.id,'username',v_profile.username,'name',v_profile.display_name,'version',v_profile.version,'reset_token',v_reset.token);
end;
$$;

create function public.service_finish_account_reset(p_profile_id uuid, p_reset_token uuid, p_succeeded boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_reset portal_private.account_resets;
begin
  perform pg_catalog.pg_advisory_xact_lock(192837465, 918273645);
  select * into v_reset from portal_private.account_resets where profile_id = p_profile_id and token = p_reset_token for update;
  if not found or p_succeeded is null then raise exception 'Reset operation is no longer current.' using errcode = '40001'; end if;
  delete from portal_private.account_resets where profile_id = p_profile_id and token = p_reset_token;
  -- Success and failure both retain must_change_password=true. A failed Auth
  -- reset never silently grants access or restores a previous account state.
  insert into public.audit_log(actor_id,action,entity_type,entity_id,after_data)
  values (v_reset.actor_id,case when p_succeeded then 'finish_account_reset' else 'fail_account_reset' end,'profiles',p_profile_id::text,jsonb_build_object('must_change_password',true));
  return true;
end;
$$;

revoke execute on function public.complete_initial_password_change(), public.admin_begin_account_reset(uuid,integer), public.service_finish_account_reset(uuid,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.complete_initial_password_change(), public.admin_begin_account_reset(uuid,integer) to authenticated;
grant execute on function public.service_finish_account_reset(uuid,uuid,boolean) to service_role;
-- Existing table grants remain deliberately unchanged. Edge Functions read
-- profiles through the caller JWT and use narrow RPCs for trusted operations.

commit;
