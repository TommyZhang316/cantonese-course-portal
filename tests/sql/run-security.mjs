import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const db = new PGlite();
let checks = 0;
const ids = Object.fromEntries(['admin', 'admin2', 'teacher', 'student', 'pending', 'spoof', 'unverified'].map((name, index) => [name, `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`]));
const filePath = index => `resources/20000000-0000-4000-8000-${String(index).padStart(12, '0')}/30000000-0000-4000-8000-${String(index).padStart(12, '0')}/material.pdf`;
const query = async (sql, values = []) => (await db.query(sql, values)).rows;
const scalar = async (sql, values = []) => Object.values((await query(sql, values))[0])[0];
async function user(name, operation = 'storage.object.get_authenticated') {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('storage.operation',$2,false)", [ids[name] || '', operation]);
  await db.exec(`set role ${name === 'anon' ? 'anon' : 'authenticated'}`);
}
async function owner() { await db.exec('reset role'); }
async function importer() {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub','',false),set_config('storage.operation','storage.object.upload',false)");
  await db.exec('set role service_role');
}
async function check(name, work) { await work(); checks++; process.stdout.write(`ok ${checks} - ${name}\n`); }
async function rejects(work, code) { await assert.rejects(work, error => error.code === code); }
const values = (title, storage_path, student_policy = 'never', release_at = null) => ({ title, storage_path, student_policy, release_at, description: 'test-only fixture', lesson_id: 1, category: 'notes', mime_type: 'application/pdf', file_size: 1024, file_name: `${title}.pdf` });
async function save(record, id = null, version = null) {
  return (await query('select to_jsonb(public.admin_save_resource($1,$2,$3::jsonb)) as resource', [id, version, JSON.stringify(record)]))[0].resource;
}
async function profile(name, version, role, status) {
  return (await query('select to_jsonb(public.admin_update_profile($1,$2,$3::public.course_role,$4::public.account_status)) as profile', [ids[name], version, role, status]))[0].profile;
}

try {
  await db.exec(await readFile(path.join(here, 'bootstrap.sql'), 'utf8'));
  const migrationDirectory = path.join(here, '../../supabase/migrations');
  for (const filename of (await readdir(migrationDirectory)).filter(name => name.endsWith('.sql')).sort()) {
    await db.exec(await readFile(path.join(migrationDirectory, filename), 'utf8'));
  }
  for (const [name, id] of Object.entries(ids)) {
    await db.query('insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values ($1,$2,$3,$4::jsonb)', [id, `${name}@example.invalid`, name === 'unverified' ? null : new Date().toISOString(), JSON.stringify({ display_name: name, ...(name === 'spoof' ? { role: 'admin', status: 'approved' } : {}) })]);
  }
  await db.exec(`update public.profiles set role='admin',status='approved' where id in ('${ids.admin}','${ids.admin2}'); update public.profiles set role='teacher',status='approved' where id='${ids.teacher}'; update public.profiles set status='approved' where id='${ids.student}';`);
  for (let n = 1; n <= 9; n++) await db.query("insert into storage.objects(bucket_id,name) values ('course-materials',$1)", [filePath(n)]);
  await user('admin');
  let immediate = await save(values('公開筆記', filePath(1), 'immediate'));
  const staff = await save(values('教師答案', filePath(2), 'never'));
  let future = await save(values('未到期筆記', filePath(3), 'scheduled', '2999-01-01T01:00:00Z'));
  const due = await save(values('已到期筆記', filePath(4), 'scheduled', '2000-01-01T01:00:00Z'));
  const archive = await save(values('封存筆記', filePath(5), 'immediate'));
  await query('select public.admin_set_resource_archived($1,1,true)', [archive.id]);

  await check('migration creates a private bucket and RLS on every public course table', async () => {
    await owner();
    assert.equal(await scalar("select public from storage.buckets where id='course-materials'"), false);
    assert.equal(await scalar("select count(*)::integer from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('profiles','lessons','resources','audit_log') and c.relrowsecurity"), 4);
  });
  await check('anonymous cannot read resources or call admin RPC', async () => {
    await user('anon');
    await rejects(() => query('select * from public.resources'), '42501');
    await rejects(() => profile('student', 2, 'admin', 'approved'), '42501');
  });
  await check('signup metadata cannot promote or approve an account', async () => {
    await user('spoof');
    const rows = await query('select role,status from public.profiles');
    assert.deepEqual(rows, [{ role: 'student', status: 'pending' }]);
  });
  await check('pending account sees itself only and no course materials or lessons', async () => {
    await user('pending');
    assert.equal(await scalar('select count(*)::integer from public.profiles'), 1);
    assert.equal(await scalar('select count(*)::integer from public.resources'), 0);
    assert.equal(await scalar('select count(*)::integer from public.lessons'), 0);
    assert.equal(await scalar('select count(*)::integer from storage.objects'), 0);
  });
  await check('students cannot self-promote through table write or guarded RPC', async () => {
    await user('student');
    await rejects(() => query("update public.profiles set role='admin' where id=$1", [ids.student]), '42501');
    await rejects(() => profile('student', 2, 'admin', 'approved'), '42501');
    await rejects(() => query('select portal_private.admin_update_profile($1,2,\'admin\',\'approved\')', [ids.student]), '42501');
    await rejects(() => query('delete from public.profiles where id=$1', [ids.student]), '42501');
  });
  await check('student resource metadata is filtered before it leaves the database', async () => {
    await user('student');
    assert.deepEqual((await query('select title from public.resources order by title')).map(x => x.title).sort(), ['公開筆記', '已到期筆記'].sort());
    for (const resource of [staff, future, archive]) assert.equal(await scalar('select count(*)::integer from public.resources where id=$1', [resource.id]), 0);
    assert.equal(await scalar('select count(*)::integer from public.profiles'), 1);
    assert.equal(await scalar('select count(*)::integer from public.audit_log'), 0);
  });
  await check('guessed paths cannot download never, future, archived or unreferenced files', async () => {
    await user('student');
    for (const n of [2, 3, 5, 6]) assert.equal(await scalar('select count(*)::integer from storage.objects where name=$1', [filePath(n)]), 0);
    for (const n of [1, 4]) assert.equal(await scalar('select count(*)::integer from storage.objects where name=$1', [filePath(n)]), 1);
  });
  await check('all browser roles are denied signed URLs and bucket-list operations', async () => {
    for (const name of ['student', 'teacher', 'admin']) for (const op of ['storage.object.sign', 'storage.object.sign_many', 'storage.object.list', 'storage.object.list_v2', 'storage.object.get_public', 'storage.s3.object.get', '']) {
      await user(name, op);
      assert.equal(await scalar('select count(*)::integer from storage.objects'), 0, `${name}:${op}`);
    }
  });
  await check('teacher reads unreleased and staff material but no archives or user directory', async () => {
    await user('teacher');
    assert.equal(await scalar('select count(*)::integer from public.resources'), 4);
    assert.equal(await scalar('select count(*)::integer from public.profiles'), 1);
    assert.equal(await scalar('select count(*)::integer from storage.objects'), 4);
    await rejects(() => save(values('教師嘗試新增', filePath(6))), '42501');
  });
  await check('student cannot mutate materials, audit history, lessons or files', async () => {
    await user('student', 'storage.object.upload');
    await rejects(() => query("update public.resources set student_policy='immediate' where id=$1", [staff.id]), '42501');
    await rejects(() => query('delete from public.audit_log'), '42501');
    await rejects(() => query("update public.lessons set title='hacked' where id=1"), '42501');
    await rejects(() => query("insert into storage.objects(bucket_id,name) values ('course-materials',$1)", [filePath(10)]), '42501');
    await rejects(() => query('select public.admin_set_resource_archived($1,1,false)', [staff.id]), '42501');
  });
  await check('administrator can upload a new immutable path, but cannot sign an upload', async () => {
    await user('admin', 'storage.object.upload');
    await query("insert into storage.objects(bucket_id,name) values ('course-materials',$1)", [filePath(10)]);
    await user('admin', 'storage.object.sign_upload_url');
    await rejects(() => query("insert into storage.objects(bucket_id,name) values ('course-materials',$1)", [filePath(11)]), '42501');
    await user('admin', 'storage.object.upload');
    await rejects(() => query("insert into storage.objects(bucket_id,name) values ('course-materials','../unsafe.pdf')"), '42501');
  });
  await check('browser cannot overwrite or delete storage files, even as administrator', async () => {
    await user('admin', 'storage.object.upload_update');
    assert.equal((await query("update storage.objects set name='overwritten' where name=$1 returning id", [filePath(1)])).length, 0);
    await user('admin', 'storage.object.delete');
    assert.equal((await query('delete from storage.objects where name=$1 returning id', [filePath(1)])).length, 0);
  });
  await check('Hong Kong default release uses seven calendar days earlier at 09:00', async () => {
    await user('admin');
    const release = await scalar("select public.default_release_at('2026-10-03T14:30:00+08:00')::text");
    assert.equal(new Date(release).toISOString(), '2026-09-26T01:00:00.000Z');
    assert.equal(await scalar('select public.default_release_at(null)'), null);
  });
  await check('release boundary is inclusive and evaluated on server statement time', async () => {
    await owner();
    await db.exec(`do $$ begin
      update public.resources set release_at=statement_timestamp() where id='${future.id}';
      perform set_config('request.jwt.claim.sub','${ids.student}',false);
      if not portal_private.can_access_resource('${future.id}') then raise exception 'Due boundary must be visible'; end if;
      update public.resources set release_at=statement_timestamp() + interval '1 microsecond' where id='${future.id}';
      if portal_private.can_access_resource('${future.id}') then raise exception 'Future boundary must be hidden'; end if;
      update public.resources set release_at='2999-01-01T01:00:00Z' where id='${future.id}';
    end $$;`);
  });
  await check('resource mutations reject stale versions without partial edits', async () => {
    await user('admin');
    immediate = await save(values('公開筆記修訂', filePath(1), 'immediate'), immediate.id, immediate.version);
    assert.equal(immediate.version, 2);
    await rejects(() => save(values('舊版覆蓋', filePath(1), 'immediate'), immediate.id, 1), '40001');
    assert.equal(await scalar('select title from public.resources where id=$1', [immediate.id]), '公開筆記修訂');
  });
  await check('a scheduled resource without release time and missing file both fail', async () => {
    await user('admin');
    await rejects(() => save(values('無日期', filePath(6), 'scheduled')), '23514');
    await rejects(() => save(values('未上傳', filePath(99), 'never')), '23514');
    assert.equal(await scalar("select count(*)::integer from public.resources where title in ('無日期','未上傳')"), 0);
  });
  await check('replacement removes access to old paths and history paths cannot be reattached', async () => {
    await user('admin');
    immediate = await save(values('公開筆記新版', filePath(6), 'immediate'), immediate.id, immediate.version);
    await user('student');
    assert.equal(await scalar('select count(*)::integer from storage.objects where name=$1', [filePath(1)]), 0);
    assert.equal(await scalar('select count(*)::integer from storage.objects where name=$1', [filePath(6)]), 1);
    await user('admin');
    await rejects(() => save(values('重綁歷史檔案', filePath(1), 'immediate')), '23505');
  });
  await check('archive and restore change student access, and editing archived rows fails', async () => {
    await user('admin');
    const row = (await query('select to_jsonb(public.admin_set_resource_archived($1,$2,true)) as r', [immediate.id, immediate.version]))[0].r;
    await rejects(() => save(values('封存不可改', filePath(6), 'immediate'), row.id, row.version), '23514');
    await user('student');
    assert.equal(await scalar('select count(*)::integer from public.resources where id=$1', [row.id]), 0);
    await user('admin');
    immediate = (await query('select to_jsonb(public.admin_set_resource_archived($1,$2,false)) as r', [row.id, row.version]))[0].r;
  });
  await check('unconfirmed email cannot be approved, even with admin RPC', async () => {
    await user('admin');
    await rejects(() => profile('unverified', 1, 'student', 'approved'), '23514');
  });
  await check('approving a pending student unlocks existing due materials only', async () => {
    await user('admin');
    const row = await profile('pending', 1, 'student', 'approved');
    assert.equal(row.version, 2);
    await user('pending');
    assert.equal(await scalar('select count(*)::integer from public.resources'), 2);
  });
  await check('suspension revokes materials using the same existing user identity', async () => {
    await user('admin');
    await profile('student', 2, 'student', 'suspended');
    await user('student');
    assert.equal(await scalar('select count(*)::integer from public.resources'), 0);
    assert.equal(await scalar('select count(*)::integer from storage.objects'), 0);
    assert.equal(await scalar('select count(*)::integer from public.profiles'), 1);
  });
  await check('teacher demotion immediately removes staff-only access', async () => {
    await user('admin');
    await profile('teacher', 2, 'student', 'approved');
    await user('teacher');
    assert.equal(await scalar('select count(*)::integer from public.resources where id=$1', [staff.id]), 0);
    assert.equal(await scalar('select count(*)::integer from storage.objects where name=$1', [filePath(2)]), 0);
  });
  await check('lesson edits validate versions and do not silently move release dates', async () => {
    await user('admin');
    const before = await scalar('select release_at::text from public.resources where id=$1', [due.id]);
    const input = JSON.stringify({ title: '第一課：見面打招呼', summary: '測試', starts_at: '2026-10-03T14:00:00+08:00', duration_minutes: 120, sort_order: 1 });
    await query('select public.admin_update_lesson(1,1,$1::jsonb)', [input]);
    await rejects(() => query('select public.admin_update_lesson(1,1,$1::jsonb)', [input]), '40001');
    assert.equal(await scalar('select release_at::text from public.resources where id=$1', [due.id]), before);
  });
  await check('role changes use optimistic versions and retain the last active administrator', async () => {
    await user('admin');
    await profile('admin2', 2, 'teacher', 'approved');
    await rejects(() => profile('admin2', 2, 'student', 'approved'), '40001');
    await rejects(() => profile('admin', 2, 'teacher', 'approved'), '23514');
    await rejects(() => profile('admin', 2, 'admin', 'suspended'), '23514');
    assert.equal(await scalar("select count(*)::integer from public.profiles where role='admin' and status='approved'"), 1);
  });
  await check('database operator deletion also cannot remove the final administrator', async () => {
    await owner();
    await rejects(() => query('delete from auth.users where id=$1', [ids.admin]), '23514');
    await user('admin');
    assert.equal(await scalar('select count(*)::integer from public.profiles where id=$1', [ids.admin]), 1);
  });
  await check('admin can inspect audit records but cannot rewrite them', async () => {
    await user('admin');
    assert.ok(await scalar('select count(*)::integer from public.audit_log') > 10);
    assert.ok(await scalar("select count(*)::integer from public.audit_log where actor_id=$1 and entity_type='resources'", [ids.admin]) > 0);
    await rejects(() => query('delete from public.audit_log'), '42501');
  });
  await check('all private definer functions pin search_path; anonymous execute is revoked', async () => {
    await owner();
    assert.equal(await scalar("select count(*)::integer from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='portal_private' and p.prosecdef and not (p.proconfig @> array['search_path=\"\"'])"), 0);
    assert.equal(await scalar("select has_function_privilege('anon','public.admin_save_resource(uuid,integer,jsonb)','EXECUTE')"), false);
    assert.equal(await scalar("select has_function_privilege('authenticated','portal_private.require_admin()','EXECUTE')"), false);
  });
  let importedId;
  await check('trusted import uploads first then inserts metadata without private-table grants', async () => {
    await importer();
    await query("insert into storage.objects(bucket_id,name) values ('course-materials',$1)", [filePath(20)]);
    const input = values('本機可信匯入測試', filePath(20));
    const row = (await query(`insert into public.resources(title,description,lesson_id,category,student_policy,release_at,mime_type,file_size,file_name,storage_path)
      values ($1,$2,$3,$4,$5::public.student_policy,$6,$7,$8,$9,$10) returning id,version`, [input.title,input.description,input.lesson_id,input.category,input.student_policy,input.release_at,input.mime_type,input.file_size,input.file_name,input.storage_path]))[0];
    importedId = row.id;
    assert.equal(row.version, 1);
    assert.equal(await scalar('select count(*)::integer from public.resources where id=$1', [row.id]), 1);
    await rejects(() => query('select * from portal_private.file_versions'), '42501');
    await rejects(() => query('select * from public.audit_log'), '42501');
    await owner();
    assert.equal(await scalar('select count(*)::integer from portal_private.file_versions where storage_path=$1', [filePath(20)]), 1);
    assert.equal(await scalar("select count(*)::integer from public.audit_log where entity_id=$1 and actor_id is null", [row.id]), 1);
  });
  await check('trusted import cannot overwrite resources, promote accounts or delete rows', async () => {
    await importer();
    await rejects(() => query("update public.resources set title='覆寫' where id=$1", [importedId]), '42501');
    await rejects(() => query('delete from public.resources where id=$1', [importedId]), '42501');
    await rejects(() => query("update public.profiles set role='admin'"), '42501');
    await rejects(() => query('select * from public.profiles'), '42501');
    await rejects(() => query('delete from public.lessons where id=8'), '42501');
    await rejects(() => query("select nextval('public.audit_log_id_seq')"), '42501');
  });
  await check('trusted importer seeds only untouched lessons with conditional update', async () => {
    await importer();
    assert.equal(await scalar('select count(*)::integer from public.lessons'), 8);
    assert.equal((await query("update public.lessons set title='可信初始課表',starts_at='2026-11-13T18:00:00+08:00' where id=8 and version=1 and starts_at is null returning id")).length, 1);
    assert.equal((await query("update public.lessons set title='重跑不覆寫' where id=8 and version=1 and starts_at is null returning id")).length, 0);
    assert.equal(await scalar('select title from public.lessons where id=8'), '可信初始課表');
  });
  await check('trusted importer still cannot attach a nonexistent file or reuse an immutable path', async () => {
    await importer();
    await rejects(() => query(`insert into public.resources(title,lesson_id,category,student_policy,mime_type,file_size,file_name,storage_path)
      values ('未上傳測試',1,'notes','never','application/pdf',1024,'test.pdf',$1)`, [filePath(21)]), '23514');
    await rejects(() => query(`insert into public.resources(title,lesson_id,category,student_policy,mime_type,file_size,file_name,storage_path)
      values ('重用路徑測試',1,'notes','never','application/pdf',1024,'test.pdf',$1)`, [filePath(20)]), '23505');
    await user('pending');
    assert.equal(await scalar('select count(*)::integer from public.resources where id=$1', [importedId]), 0);
    assert.equal(await scalar('select count(*)::integer from storage.objects where name=$1', [filePath(20)]), 0);
  });
  process.stdout.write(`\nPASS: ${checks} PostgreSQL security scenarios. Auth/Storage adapters are not an HTTP or multi-connection acceptance test.\n`);
} finally {
  await db.close();
}
