-- Trusted local importer only. Never put a service-role key in a browser/build.
-- Supabase projects may have broad default service_role table grants; narrow
-- this course's public tables explicitly instead of depending on those defaults.
begin;

grant usage on schema public to service_role;
revoke all on public.profiles, public.lessons, public.resources, public.audit_log from service_role;
revoke all on sequence public.audit_log_id_seq from service_role;
revoke all on portal_private.file_versions from service_role;
grant select, insert on public.resources to service_role;
grant select, update on public.lessons to service_role;

-- No browser grants or RLS policies change. Supabase's platform Storage/Auth
-- service privileges are untouched. Audit/file-version triggers run as their
-- trusted owner, so the importer needs no audit sequence or private-table grant.
commit;
