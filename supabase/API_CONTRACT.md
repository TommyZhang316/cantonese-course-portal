# Portal browser API contract

Supabase JS v2; public schema; bucket `course-materials` is **private**. Browser receives only project URL and publishable/anon key. NEVER a service-role key. All timestamps are ISO 8601 `timestamptz`; UI inputs/display use `Asia/Hong_Kong` and send explicit `+08:00` or UTC.

## Types and reads

- `profiles`: `id: UUID`, `display_name: string`, `email: string`, `role: 'student'|'teacher'|'admin'`, `status: 'pending'|'approved'|'suspended'`, `version: integer`, `created_at`, `updated_at`. `select('*').eq('id', user.id).single()` returns own account even pending/suspended; admin can list all. Other users cannot list classmates.
- `lessons`: `id: integer` (1–8), `title`, `summary`, `starts_at: ISO|null`, `duration_minutes: integer`, `sort_order: integer`, `version: integer`, `updated_at`. Approved users can select; pending/suspended users see no lessons.
- `resources`: `id: UUID`, `title`, `description`, `lesson_id: integer|null`, `category: string`, `student_policy: 'never'|'scheduled'|'immediate'`, `release_at: ISO|null`, `archived_at: ISO|null`, `mime_type`, `file_size: integer`, `file_name: string`, `storage_path: string`, `version: integer`, `created_at`, `updated_at`. Student rows are filtered by database RLS, including all metadata: only nonarchived immediate or due scheduled rows; never rows are invisible. Approved teachers read all nonarchived rows; approved admins read all rows including archived. Client filtering is presentation only, never the permission boundary.
- `audit_log`: admin-only read; `id`, `actor_id`, `action`, `entity_type`, `entity_id`, `before_data`, `after_data`, `created_at`.

`rpc('default_release_at', {p_starts_at: ISO})` returns the class's Hong Kong calendar date minus seven days at 09:00, as an ISO timestamp. Null class dates return null; do not automatically release unscheduled materials.

Default resource query: `from('resources').select('*').is('archived_at', null).order('lesson_id').order('title')`. Admin may omit the archive filter. Re-fetch profile/resources on window focus, every 30–60 seconds and before downloads, clearing inaccessible cached files on a role/status change. Release enforcement uses server time, so clock changes in the browser cannot unlock content.

## Sign-up/login

`auth.signUp({email,password,options:{data:{display_name}}})`; only `display_name` is accepted by the signup trigger. A new account is always a **pending student**. Email confirmation must stay enabled. Teacher roles require admin approval. Existing admin uses `admin_update_profile`; first admin is bootstrapped by a verified SQL Dashboard operator using `bootstrap-admin.sql`.

## Mutations (atomic RPCs, admin only)

No browser table INSERT/UPDATE/DELETE grants. Success returns the complete changed row. Stale `version` fails with SQLSTATE `40001` (`版本已更新，請重新載入後再試。`). Other failures use `42501` (permission), `23514`/`22023` (validation), `P0002` (missing).

### `admin_save_resource`

`rpc('admin_save_resource', {p_resource_id: UUID|null, p_expected_version: integer|null, p_values: {...}})`

`p_values` is a **complete** record containing `title, description, lesson_id, category, student_policy, release_at, mime_type, file_size, file_name, storage_path`. Optional text values may be `''`; lesson_id/release_at may be null. Create: null id/version; update: row id/current version. Policy scheduled requires release_at; immediate/never normalize release_at to null. Every newly attached file must first be uploaded to a **new** immutable path `resources/<random UUID>/<random UUID>/<ASCII-safe filename>` with `upsert:false`. New path must exist in the bucket; replacing a file never overwrites its old object. Do not remove an old object in the browser. Archived resources must be restored first.

### `admin_set_resource_archived`

`rpc('admin_set_resource_archived', {p_resource_id: UUID, p_expected_version: integer, p_archived: boolean})`.

### `admin_update_lesson`

`rpc('admin_update_lesson', {p_lesson_id: integer, p_expected_version: integer, p_values:{title, summary, starts_at, duration_minutes, sort_order}})`; complete values. Changing lesson start time **does not silently move resource release times**; save each resource release explicitly. Null dates mean to be scheduled.

### `admin_update_profile`

`rpc('admin_update_profile', {p_profile_id: UUID, p_expected_version: integer, p_role:'student'|'teacher'|'admin', p_status:'pending'|'approved'|'suspended'})`. An approved account requires confirmed email. Cannot demote/suspend the last approved admin (serialized transaction guard). Changes take effect at the next API request, including requests with an existing JWT.

## Private file download and upload

Download: `storage.from('course-materials').download(resource.storage_path)` obtains a Blob through an authenticated request. Create a temporary object URL, trigger a download using resource.file_name, and revoke it. No public URL and **no signed URLs**; storage SELECT policy permits authenticated download/info operations only (signed URL and directory-list operations denied). File replacement invalidates previous object paths for all course roles. Already downloaded copies cannot be revoked.

Upload (admin): `storage.from('course-materials').upload(newPath, file, {upsert:false,contentType:file.type,cacheControl:'0'})`; then save resource RPC. If saving fails, the unreferenced upload remains inaccessible and can be cleaned up by an operator. Max file size is 50 MiB (project plan may impose a lower cap). Never put course files, ZIP archives, exam keys, user accounts or local manifests in the public frontend build/repository.

## Administrative error handling

Keep unsaved form values on errors; surface validation and permission errors in Traditional Chinese. For stale versions re-fetch and show a conflict notice before retrying. Do not automatically replay an edit over a newer administrator's values. No hard-delete account/material control. Audit log is append-only for browser roles.

## Trusted local import (never browser)

After both migrations, service_role has `USAGE` on public, `SELECT,INSERT` on resources and `SELECT,UPDATE` on lessons. Existing broad grants on course profiles/resources/lessons/audit are removed first. It has no private file-version or audit sequence access; owner-definer triggers maintain these automatically. Platform Storage/Auth service privileges stay unchanged, so this remains a highly privileged operator credential. Upload files first with `upsert:false`, then INSERT new resource rows. Skip existing resource IDs; never overwrite their metadata/file contents on rerun. Seed lesson dates only with a conditional `version=1 AND starts_at IS NULL` update. First administrator creation still uses the trusted SQL Dashboard bootstrap.
