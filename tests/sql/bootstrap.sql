-- Test-only adapters for Supabase Auth/Storage in a disposable PostgreSQL engine.
-- NEVER apply this file to an existing Supabase project.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create schema storage;
grant usage on schema public, auth, storage to anon, authenticated, service_role;
-- Model hosted projects that grant service_role broad privileges by default.
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz, raw_user_meta_data jsonb default '{}', raw_app_meta_data jsonb default '{}', encrypted_password text);
create table auth.sessions (id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade, not_after timestamptz);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''),'{}')::jsonb;
$$;
create table storage.buckets (id text primary key, name text not null, public boolean not null default false, file_size_limit bigint);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text not null, unique(bucket_id,name));
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to authenticated;
grant select, insert, update, delete on storage.objects to service_role;
grant select on storage.buckets to service_role;
create function storage.allow_any_operation(p_operations text[]) returns boolean language sql stable as $$
  select exists (select 1 from unnest(p_operations) op where replace(op, 'storage.', '') = replace(coalesce(current_setting('storage.operation', true), ''), 'storage.', ''));
$$;
