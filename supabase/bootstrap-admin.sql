-- Run only in the trusted Supabase SQL Dashboard AFTER the owner has signed up
-- and verified their email. Replace the placeholder locally; do not commit real emails.
-- This is intentionally not a callable browser RPC.
begin;
do $$
declare
  v_email text := 'REPLACE_WITH_VERIFIED_ADMIN_EMAIL';
  v_id uuid;
begin
  if v_email = 'REPLACE_WITH_VERIFIED_ADMIN_EMAIL' then
    raise exception 'Replace the placeholder with the verified course administrator email.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(192837465, 918273645);
  if exists (select 1 from public.profiles where role = 'admin' and status = 'approved') then
    raise exception 'An active administrator already exists. Use the portal administrator screen.';
  end if;
  select id into strict v_id from auth.users where lower(email) = lower(v_email) and email_confirmed_at is not null;
  update public.profiles set role = 'admin', status = 'approved' where id = v_id;
  if not found then raise exception 'No matching profile exists.'; end if;
end;
$$;
commit;
