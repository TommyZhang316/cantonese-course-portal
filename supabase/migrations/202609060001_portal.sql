-- Apply once to a dedicated Supabase project. Never expose schema portal_private.
begin;

create schema if not exists portal_private;
revoke all on schema portal_private from public, anon, authenticated;
grant usage on schema portal_private to authenticated;
alter default privileges in schema portal_private revoke execute on functions from public;

create type public.course_role as enum ('student', 'teacher', 'admin');
create type public.account_status as enum ('pending', 'approved', 'suspended');
create type public.student_policy as enum ('never', 'scheduled', 'immediate');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(display_name) between 1 and 100),
  email text not null,
  role public.course_role not null default 'student',
  status public.account_status not null default 'pending',
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.lessons (
  id integer primary key check (id between 1 and 8),
  title text not null check (length(title) between 1 and 150),
  summary text not null default '' check (length(summary) <= 2000),
  starts_at timestamptz,
  duration_minutes integer not null default 120 check (duration_minutes between 15 and 480),
  sort_order integer not null default 1 check (sort_order between 1 and 100),
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now()
);

create table public.resources (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(title) between 1 and 180),
  description text not null default '' check (length(description) <= 4000),
  lesson_id integer references public.lessons(id),
  category text not null default 'other' check (category in ('notes', 'slides', 'activity', 'game', 'exam', 'guide', 'outline', 'other')),
  student_policy public.student_policy not null default 'never',
  release_at timestamptz,
  archived_at timestamptz,
  mime_type text not null check (length(mime_type) between 1 and 150),
  file_size bigint not null check (file_size > 0 and file_size <= 52428800),
  file_name text not null check (length(file_name) between 1 and 200 and file_name !~ E'[\\r\\n/\\\\]'),
  storage_path text unique not null check (storage_path ~ '^resources/[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9][A-Za-z0-9._-]{0,180}$'),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint release_policy_consistent check (
    (student_policy = 'scheduled' and release_at is not null) or
    (student_policy <> 'scheduled' and release_at is null)
  )
);
create index resources_lesson on public.resources (lesson_id, title);
create index resources_student_release on public.resources (release_at) where archived_at is null and student_policy = 'scheduled';

create table portal_private.file_versions (
  storage_path text primary key,
  resource_id uuid not null,
  attached_at timestamptz not null default now()
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_recent on public.audit_log (created_at desc);

alter table public.profiles enable row level security;
alter table public.lessons enable row level security;
alter table public.resources enable row level security;
alter table public.audit_log enable row level security;
alter table portal_private.file_versions enable row level security;
revoke all on public.profiles, public.lessons, public.resources, public.audit_log from public, anon, authenticated;
revoke all on portal_private.file_versions from public, anon, authenticated;
grant select on public.profiles, public.lessons, public.resources, public.audit_log to authenticated;

create function portal_private.is_active() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'approved');
$$;
create function portal_private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'approved' and p.role = 'admin');
$$;
create function portal_private.can_access_resource(p_resource_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p join public.resources r on r.id = p_resource_id
    where p.id = auth.uid() and p.status = 'approved' and (
      p.role = 'admin' or (r.archived_at is null and (
        p.role = 'teacher' or (p.role = 'student' and (
          r.student_policy = 'immediate' or (r.student_policy = 'scheduled' and r.release_at <= statement_timestamp())
        ))
      ))
    )
  );
$$;
create function portal_private.can_access_path(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.resources r where r.storage_path = p_path and portal_private.can_access_resource(r.id));
$$;
create function portal_private.require_admin() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not portal_private.is_admin() then raise exception '需要已核准的管理員權限。' using errcode = '42501'; end if;
end;
$$;

create policy profiles_read on public.profiles for select to authenticated using (id = (select auth.uid()) or (select portal_private.is_admin()));
create policy lessons_read on public.lessons for select to authenticated using ((select portal_private.is_active()));
create policy resources_read on public.resources for select to authenticated using (portal_private.can_access_resource(id));
create policy audit_admin_read on public.audit_log for select to authenticated using ((select portal_private.is_admin()));

create function portal_private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, display_name, role, status)
  values (new.id, coalesce(new.email, ''), left(coalesce(nullif(btrim(new.raw_user_meta_data->>'display_name'), ''), '新同學'), 100), 'student', 'pending');
  return new;
end;
$$;
create trigger portal_new_user after insert on auth.users for each row execute function portal_private.handle_new_user();

create function portal_private.sync_user_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = coalesce(new.email, '') where id = new.id;
  end if;
  return new;
end;
$$;
create trigger portal_sync_email after update of email on auth.users for each row execute function portal_private.sync_user_email();

create function portal_private.protect_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- All admin-removal paths acquire one transaction lock, including SQL operator edits.
  perform pg_catalog.pg_advisory_xact_lock(192837465, 918273645);
  if old.role = 'admin' and old.status = 'approved' and (
    tg_op = 'DELETE' or new.role <> 'admin' or new.status <> 'approved'
  ) and not exists (select 1 from public.profiles where id <> old.id and role = 'admin' and status = 'approved') then
    raise exception '必須保留至少一位已核准的管理員。' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if new.status = 'approved' and not exists (select 1 from auth.users where id = new.id and email_confirmed_at is not null) then
    raise exception '請先完成電郵驗證，然後再核准賬戶。' using errcode = '23514';
  end if;
  new.version := old.version + 1;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
create trigger portal_protect_profile before update or delete on public.profiles for each row execute function portal_private.protect_profile();

create function portal_private.record_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_log (actor_id, action, entity_type, entity_id, before_data, after_data)
  values (auth.uid(), lower(tg_op), tg_table_name, coalesce(to_jsonb(new)->>'id', to_jsonb(old)->>'id'),
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end);
  return coalesce(new, old);
end;
$$;
create trigger portal_profiles_audit after update or delete on public.profiles for each row execute function portal_private.record_audit();
create trigger portal_lessons_audit after insert or update or delete on public.lessons for each row execute function portal_private.record_audit();
create trigger portal_resources_audit after insert or update or delete on public.resources for each row execute function portal_private.record_audit();

create function portal_private.guard_file_version() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.storage_path is distinct from old.storage_path then
    if not exists (select 1 from storage.objects where bucket_id = 'course-materials' and name = new.storage_path) then
      raise exception '請先上傳文件，再儲存教材設定。' using errcode = '23514';
    end if;
    insert into portal_private.file_versions(storage_path, resource_id) values (new.storage_path, new.id);
  end if;
  return new;
end;
$$;
create trigger portal_resource_file before insert or update of storage_path on public.resources for each row execute function portal_private.guard_file_version();

-- The default is seven local calendar days before class, at 09:00 Hong Kong time.
create function public.default_release_at(p_starts_at timestamptz) returns timestamptz
language sql immutable strict security invoker set search_path = '' as $$
  select ((((p_starts_at at time zone 'Asia/Hong_Kong')::date - 7) + time '09:00') at time zone 'Asia/Hong_Kong');
$$;

create function portal_private.admin_update_profile(p_profile_id uuid, p_expected_version integer, p_role public.course_role, p_status public.account_status)
returns public.profiles language plpgsql security definer set search_path = '' as $$
declare v_row public.profiles;
begin
  -- Serialize role changes before checking caller membership or row locks.
  perform pg_catalog.pg_advisory_xact_lock(192837465, 918273645);
  perform portal_private.require_admin();
  select * into v_row from public.profiles where id = p_profile_id for update;
  if not found then raise exception '找不到賬戶。' using errcode = 'P0002'; end if;
  if p_expected_version is null or v_row.version <> p_expected_version then raise exception '版本已更新，請重新載入後再試。' using errcode = '40001'; end if;
  if p_role is null or p_status is null then raise exception '請選擇賬戶角色及狀態。' using errcode = '22023'; end if;
  update public.profiles set role = p_role, status = p_status where id = p_profile_id returning * into v_row;
  return v_row;
end;
$$;
create function public.admin_update_profile(p_profile_id uuid, p_expected_version integer, p_role public.course_role, p_status public.account_status)
returns public.profiles language sql security invoker set search_path = '' as $$
  select portal_private.admin_update_profile(p_profile_id, p_expected_version, p_role, p_status);
$$;

create function portal_private.admin_update_lesson(p_lesson_id integer, p_expected_version integer, p_values jsonb)
returns public.lessons language plpgsql security definer set search_path = '' as $$
declare v_row public.lessons;
begin
  perform portal_private.require_admin();
  select * into v_row from public.lessons where id = p_lesson_id for update;
  if not found then raise exception '找不到課堂。' using errcode = 'P0002'; end if;
  if p_expected_version is null or v_row.version <> p_expected_version then raise exception '版本已更新，請重新載入後再試。' using errcode = '40001'; end if;
  if p_values is null or jsonb_typeof(p_values) <> 'object' or not p_values ?& array['title','summary','starts_at','duration_minutes','sort_order'] then
    raise exception '課堂資料不完整。' using errcode = '22023';
  end if;
  update public.lessons set title = btrim(p_values->>'title'), summary = coalesce(p_values->>'summary', ''),
    starts_at = (p_values->>'starts_at')::timestamptz, duration_minutes = (p_values->>'duration_minutes')::integer,
    sort_order = (p_values->>'sort_order')::integer, version = version + 1, updated_at = clock_timestamp()
  where id = p_lesson_id returning * into v_row;
  return v_row;
end;
$$;
create function public.admin_update_lesson(p_lesson_id integer, p_expected_version integer, p_values jsonb)
returns public.lessons language sql security invoker set search_path = '' as $$
  select portal_private.admin_update_lesson(p_lesson_id, p_expected_version, p_values);
$$;

create function portal_private.admin_save_resource(p_resource_id uuid, p_expected_version integer, p_values jsonb)
returns public.resources language plpgsql security definer set search_path = '' as $$
declare v_row public.resources; v_policy public.student_policy; v_release timestamptz;
begin
  perform portal_private.require_admin();
  if p_values is null or jsonb_typeof(p_values) <> 'object' or not p_values ?& array['title','description','lesson_id','category','student_policy','release_at','mime_type','file_size','file_name','storage_path'] then
    raise exception '教材資料不完整。' using errcode = '22023';
  end if;
  v_policy := (p_values->>'student_policy')::public.student_policy;
  v_release := case when v_policy = 'scheduled' then (p_values->>'release_at')::timestamptz else null end;
  if p_resource_id is null then
    if p_expected_version is not null then raise exception '新增教材不可指定舊版本。' using errcode = '22023'; end if;
    insert into public.resources (title, description, lesson_id, category, student_policy, release_at, mime_type, file_size, file_name, storage_path)
    values (btrim(p_values->>'title'), coalesce(p_values->>'description', ''), (p_values->>'lesson_id')::integer, p_values->>'category',
      v_policy, v_release, p_values->>'mime_type', (p_values->>'file_size')::bigint, p_values->>'file_name', p_values->>'storage_path') returning * into v_row;
  else
    select * into v_row from public.resources where id = p_resource_id for update;
    if not found then raise exception '找不到教材。' using errcode = 'P0002'; end if;
    if p_expected_version is null or v_row.version <> p_expected_version then raise exception '版本已更新，請重新載入後再試。' using errcode = '40001'; end if;
    if v_row.archived_at is not null then raise exception '請先恢復已封存教材。' using errcode = '23514'; end if;
    update public.resources set title = btrim(p_values->>'title'), description = coalesce(p_values->>'description', ''),
      lesson_id = (p_values->>'lesson_id')::integer, category = p_values->>'category', student_policy = v_policy, release_at = v_release,
      mime_type = p_values->>'mime_type', file_size = (p_values->>'file_size')::bigint, file_name = p_values->>'file_name', storage_path = p_values->>'storage_path',
      version = version + 1, updated_at = clock_timestamp()
    where id = p_resource_id returning * into v_row;
  end if;
  return v_row;
end;
$$;
create function public.admin_save_resource(p_resource_id uuid, p_expected_version integer, p_values jsonb)
returns public.resources language sql security invoker set search_path = '' as $$
  select portal_private.admin_save_resource(p_resource_id, p_expected_version, p_values);
$$;

create function portal_private.admin_set_resource_archived(p_resource_id uuid, p_expected_version integer, p_archived boolean)
returns public.resources language plpgsql security definer set search_path = '' as $$
declare v_row public.resources;
begin
  perform portal_private.require_admin();
  select * into v_row from public.resources where id = p_resource_id for update;
  if not found then raise exception '找不到教材。' using errcode = 'P0002'; end if;
  if p_expected_version is null or v_row.version <> p_expected_version then raise exception '版本已更新，請重新載入後再試。' using errcode = '40001'; end if;
  if p_archived is null then raise exception '請選擇封存狀態。' using errcode = '22023'; end if;
  update public.resources set archived_at = case when p_archived then clock_timestamp() else null end,
    version = version + 1, updated_at = clock_timestamp() where id = p_resource_id returning * into v_row;
  return v_row;
end;
$$;
create function public.admin_set_resource_archived(p_resource_id uuid, p_expected_version integer, p_archived boolean)
returns public.resources language sql security invoker set search_path = '' as $$
  select portal_private.admin_set_resource_archived(p_resource_id, p_expected_version, p_archived);
$$;

-- Fail closed on older Storage versions: update Storage before applying this migration.
do $$ begin
  if to_regprocedure('storage.allow_any_operation(text[])') is null then
    raise exception 'Storage operation-aware RLS helpers are required; update Supabase Storage before deployment.';
  end if;
end $$;

insert into storage.buckets (id, name, public, file_size_limit)
values ('course-materials', 'course-materials', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

create policy portal_files_read on storage.objects for select to authenticated using (
  bucket_id = 'course-materials'
  and storage.allow_any_operation(array['object.get_authenticated', 'object.get_authenticated_info'])
  and portal_private.can_access_path(name)
);
create policy portal_files_upload on storage.objects for insert to authenticated with check (
  bucket_id = 'course-materials' and (select portal_private.is_admin())
  and storage.allow_any_operation(array['object.upload'])
  and name ~ '^resources/[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9][A-Za-z0-9._-]{0,180}$'
);
-- Intentionally no UPDATE/DELETE/list/sign policy. Version replacement uses a fresh path.

revoke execute on all functions in schema portal_private from public, anon, authenticated;
grant execute on function portal_private.is_active(), portal_private.is_admin(), portal_private.can_access_resource(uuid), portal_private.can_access_path(text) to authenticated;
grant execute on function portal_private.admin_update_profile(uuid, integer, public.course_role, public.account_status),
  portal_private.admin_update_lesson(integer, integer, jsonb), portal_private.admin_save_resource(uuid, integer, jsonb),
  portal_private.admin_set_resource_archived(uuid, integer, boolean) to authenticated;

revoke execute on function public.default_release_at(timestamptz), public.admin_update_profile(uuid, integer, public.course_role, public.account_status),
  public.admin_update_lesson(integer, integer, jsonb), public.admin_save_resource(uuid, integer, jsonb),
  public.admin_set_resource_archived(uuid, integer, boolean) from public, anon, authenticated;
grant execute on function public.default_release_at(timestamptz), public.admin_update_profile(uuid, integer, public.course_role, public.account_status),
  public.admin_update_lesson(integer, integer, jsonb), public.admin_save_resource(uuid, integer, jsonb),
  public.admin_set_resource_archived(uuid, integer, boolean) to authenticated;

-- Dates deliberately unset until the administrator enters the confirmed timetable.
insert into public.lessons (id, title, summary, sort_order)
select n, '第' || n || '課', '課堂日期及主題由管理員設定。', n from generate_series(1, 8) n;

commit;
