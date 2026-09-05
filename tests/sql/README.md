# Database security tests

Run from `portal/` after dependencies are installed:

```sh
node tests/sql/run-security.mjs
```

The runner uses `@electric-sql/pglite`, a real PostgreSQL core compiled to WebAssembly. It creates a fresh in-memory database; `bootstrap.sql` supplies minimal Supabase Auth/Storage schemas and roles, then the full production migration runs unchanged. Fixtures use only `example.invalid` email addresses and fake file metadata. No cloud mutations or messages are sent.

Coverage: anonymous denial; profile isolation; signup role spoofing; pending/suspended denial; direct REST-equivalent table writes; hidden resource metadata; private storage path guessing; signed URL/listing denial; student/teacher/admin matrix; approved email gating; exact release boundary and Hong Kong default date; optimistic conflict checks; archive/restore; immutable file paths; audit append-only; last active admin demotion/deletion guards; function privilege and search_path checks; trusted service-role upload-then-insert; removal of broad default course-table grants; conditional initial lesson seeding; service-role inability to overwrite resources, read/change profiles, manipulate audit sequence or attach absent/reused paths.

The runner applies every migration in filename order, including the explicit trusted-import grant migration. Its test-only `service_role` has PostgreSQL `BYPASSRLS`, as on Supabase, and starts with simulated broad public-table defaults so narrowing is actually exercised.

## Run against a dedicated local Supabase

For full API acceptance, use `supabase start`/`supabase db reset` with a current CLI/Storage image, create temporary test users through Auth, verify them in the local mail viewer, and make requests with their actual tokens using the Supabase JS client. Do not run the test adapter against Supabase. The operation-aware Storage helpers must exist; migration fails closed otherwise.

Validate HTTP endpoints for each role:

- `GET /rest/v1/resources?select=*`: student excludes never/future/archive metadata.
- `GET /storage/v1/object/authenticated/course-materials/<known-path>`: only current entitled users receive bytes.
- `POST /storage/v1/object/sign/course-materials/<known-path>` and bulk sign: rejected even for currently entitled users.
- Storage list, public object URL, update, remove, signed upload and unauthorized new upload: rejected.
- Reuse an existing teacher JWT after admin demotion/suspension: private teacher download fails immediately on the next request.
- A student changes their local clock: no effect on release availability.
- Admin fresh-path upload followed by `admin_save_resource`: succeeds; replacing a resource makes the old path unavailable.

## Concurrent last-admin test (two real database connections)

PGlite serializes queries and does not prove multi-connection scheduling. In a disposable database with two approved admins, start two transactions as their respective authenticated identities. In transaction A call `admin_update_profile(A, currentVersion, 'teacher', 'approved')` and hold the transaction open. In B call `admin_update_profile(B, currentVersion, 'teacher', 'approved')`; B must block on the shared advisory transaction lock. Commit A; B must then fail with `23514` because it would remove the last admin. Roll back B and assert one approved admin remains. Repeat with both admins targeting each other: the second transaction must fail `42501` after its caller has been demoted. Use statement/lock timeouts for the test so accidental blocking cannot hang a job.

Hosted Supabase HTTP/Auth/Storage acceptance, SMTP delivery and this multi-connection scenario remain required deployment checks; the in-memory test cannot claim them.
