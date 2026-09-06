-- Administrators may assign a role before the account first signs in.
-- Preserve the initial-password lock for every role and the last active admin.
-- No account roles, statuses, passwords or grants are changed by this migration.
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
  -- Role assignment does not clear the password flag. is_active(), is_admin()
  -- and Storage policies deny every role until its initial password is changed.
  if new.status = 'approved' and not exists (select 1 from auth.users where id = new.id and email_confirmed_at is not null) then
    raise exception '請先完成電郵驗證，然後再核准賬戶。' using errcode = '23514';
  end if;
  new.version := old.version + 1;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create or replace function portal_private.enforce_managed_auth() returns trigger
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
      -- Keep the existing prohibition on returning an unlocked staff account
      -- to predictable credentials; this no longer depends on role assignment.
      if v_profile.role <> 'student' then
        raise exception '教職員帳戶不能重設為初始密碼。' using errcode = '23514';
      end if;
      update public.profiles set must_change_password = true where id = new.id;
    end if;
  end if;
  return new;
end;
$$;

commit;
