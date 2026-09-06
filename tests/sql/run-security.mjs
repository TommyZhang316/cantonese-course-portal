import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const db = new PGlite({ extensions: { pgcrypto } });
let checks = 0;
const ids = Object.fromEntries(['admin', 'admin2', 'teacher', 'student', 'pending', 'spoof', 'unverified'].map((name, index) => [name, `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`]));
const sessionId = id => id.replace(/^10000000/, '40000000');
const claims = id => JSON.stringify(id ? { sub: id, session_id: sessionId(id) } : {});
const filePath = index => `resources/20000000-0000-4000-8000-${String(index).padStart(12, '0')}/30000000-0000-4000-8000-${String(index).padStart(12, '0')}/material.pdf`;
const query = async (sql, values = []) => (await db.query(sql, values)).rows;
const scalar = async (sql, values = []) => Object.values((await query(sql, values))[0])[0];
async function user(name, operation = 'storage.object.get_authenticated') {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('storage.operation',$2,false),set_config('request.jwt.claims',$3,false)", [ids[name] || '', operation, claims(ids[name])]);
  await db.exec(`set role ${name === 'anon' ? 'anon' : 'authenticated'}`);
}
async function owner() { await db.exec('reset role'); }
async function importer() {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claims','{}',false),set_config('storage.operation','storage.object.upload',false)");
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
    await db.query('insert into auth.sessions(id,user_id) values ($1,$2)',[sessionId(id),id]);
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
      perform set_config('request.jwt.claims','${claims(ids.student)}',false);
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
  ids.managed = '10000000-0000-4000-8000-000000000101';
  ids.fakeManaged = '10000000-0000-4000-8000-000000000102';
  ids.delayedManaged = '10000000-0000-4000-8000-000000000104';
  await check('real Auth insert then app-metadata update is finalized before the account is reported ready', async () => {
    await owner();
    // Auth.adminUserCreate inserts provider metadata first, then updates custom
    // app metadata and confirmation in the same provider transaction.
    await db.exec('begin');
    await query(`insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data,encrypted_password)
      values ($1,'chenming@accounts.cantonese.invalid','{"display_name":"陳明"}','{"provider":"email"}',extensions.crypt('preserve-this-chosen-password',extensions.gen_salt('bf',4)))`,[ids.delayedManaged]);
    await query('update auth.users set raw_app_meta_data=$2::jsonb,email_confirmed_at=now() where id=$1', [ids.delayedManaged,JSON.stringify({course_managed:true,course_username:'CHENMING',course_created_by:ids.admin})]);
    await db.exec('commit');
    assert.deepEqual(await query('select username,status,must_change_password from public.profiles where id=$1',[ids.delayedManaged]),[{username:null,status:'pending',must_change_password:false}]);
    const originalHash = await scalar('select encrypted_password from auth.users where id=$1',[ids.delayedManaged]);
    await importer();
    const finished = await scalar("select public.service_finalize_managed_account('CHENMING',$1)",[ids.admin]);
    assert.deepEqual(finished,{id:ids.delayedManaged,provisioned:true});
    await owner();
    assert.deepEqual(await query('select username,role,status,must_change_password from public.profiles where id=$1',[ids.delayedManaged]),[{username:'CHENMING',role:'student',status:'approved',must_change_password:true}]);
    assert.equal(await scalar('select encrypted_password from auth.users where id=$1',[ids.delayedManaged]),originalHash);
    await query('insert into auth.sessions(id,user_id) values ($1,$2)',[sessionId(ids.delayedManaged),ids.delayedManaged]);
    await user('delayedManaged');
    assert.equal(await scalar('select count(*)::integer from public.resources'),0);
    await query('select public.complete_initial_password_change()');
    const version = await scalar('select version from public.profiles');
    await importer();
    assert.deepEqual(await scalar("select public.service_finalize_managed_account('CHENMING',$1)",[ids.admin]),{id:ids.delayedManaged,provisioned:false});
    await user('delayedManaged');
    assert.equal(await scalar('select version from public.profiles'),version);
    assert.equal(await scalar('select must_change_password from public.profiles'),false);
    await owner();
    assert.equal(await scalar('select encrypted_password from auth.users where id=$1',[ids.delayedManaged]),originalHash);
    assert.equal(await scalar("select count(*)::integer from public.audit_log where action='create_managed_account' and entity_id=$1",[ids.delayedManaged]),1);
  });
  await check('trusted finalization is unavailable to every browser role and cannot target a nonadmin actor', async () => {
    for (const name of ['anon','student','teacher','admin']) {
      await user(name);
      await rejects(() => query("select public.service_finalize_managed_account('CHENMING',$1)",[ids.admin]),'42501');
    }
    await importer();
    await rejects(() => query("select public.service_finalize_managed_account('CHENMING',$1)",[ids.student]),'42501');
    await rejects(() => query("select public.service_finalize_managed_account('bad-alias',$1)",[ids.admin]),'42501');
    assert.equal(await scalar("select public.service_finalize_managed_account('MISSINGNAME',$1)",[ids.admin]),null);
  });
  await check('finalization rejects forged user metadata, unconfirmed identities, mismatched creators and edited pending profiles', async () => {
    for (const [index, kind, code] of [[1,'user-metadata','42501'],[2,'unconfirmed','42501'],[3,'other-creator','23514'],[4,'edited-profile','23514']]) {
      const id = `10000000-0000-4000-8000-${String(200+index).padStart(12,'0')}`;
      const username = `GUARDCASE${index}`;
      const metadata = {course_managed:true,course_username:username,course_created_by:kind === 'other-creator' ? ids.student : ids.admin};
      await owner();
      await query("insert into auth.users(id,email,raw_user_meta_data,encrypted_password) values ($1,$2,$3::jsonb,'unchanged-test-hash')",[id,`${username.toLowerCase()}@accounts.cantonese.invalid`,JSON.stringify({display_name:'測試',...metadata})]);
      await query('update auth.users set raw_app_meta_data=$2::jsonb,email_confirmed_at=$3 where id=$1',[id,JSON.stringify(kind === 'user-metadata' ? {} : metadata),kind === 'unconfirmed' ? null : new Date().toISOString()]);
      if (kind === 'edited-profile') await query("update public.profiles set status='suspended' where id=$1",[id]);
      const before = await scalar('select to_jsonb(p) from public.profiles p where id=$1',[id]);
      await importer();
      await rejects(() => query('select public.service_finalize_managed_account($1,$2)',[username,ids.admin]),code);
      await owner();
      assert.deepEqual(await scalar('select to_jsonb(p) from public.profiles p where id=$1',[id]),before);
      assert.equal(await scalar('select encrypted_password from auth.users where id=$1',[id]),'unchanged-test-hash');
    }
  });
  await check('repeat finalization never reactivates a suspended completed account', async () => {
    await owner();
    await query("update public.profiles set status='suspended' where id=$1",[ids.delayedManaged]);
    const before = await scalar('select to_jsonb(p) from public.profiles p where id=$1',[ids.delayedManaged]);
    await importer();
    assert.deepEqual(await scalar("select public.service_finalize_managed_account('CHENMING',$1)",[ids.admin]),{id:ids.delayedManaged,provisioned:false});
    await owner();
    assert.deepEqual(await scalar('select to_jsonb(p) from public.profiles p where id=$1',[ids.delayedManaged]),before);
  });
  const managedInitial = "encode(extensions.digest('course-initial-v1:LIWU','sha256'),'hex')";
  const hashPassword = passwordSql => `extensions.crypt(${passwordSql},extensions.gen_salt('bf',4))`;
  const managedMetadata = { course_managed: true, course_username: 'LIWU', course_created_by: ids.admin };
  async function setManagedPassword(passwordSql) {
    await owner();
    await db.query(`update auth.users set encrypted_password=${hashPassword(passwordSql)} where id=$1`, [ids.managed]);
  }
  await check('managed Auth Admin insert creates an approved student locked to initial password change', async () => {
    await owner();
    await db.query(`insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data,raw_app_meta_data,encrypted_password)
      values ($1,'liwu@accounts.cantonese.invalid',now(),'{"display_name":"李武"}',$2::jsonb,${hashPassword(managedInitial)})`, [ids.managed,JSON.stringify(managedMetadata)]);
    await db.query('insert into auth.sessions(id,user_id) values ($1,$2)',[sessionId(ids.managed),ids.managed]);
    await user('managed');
    assert.deepEqual(await query('select username,role,status,must_change_password from public.profiles'), [{ username:'LIWU',role:'student',status:'approved',must_change_password:true }]);
    for (const table of ['lessons','resources','audit_log','storage.objects']) assert.equal(await scalar(`select count(*)::integer from ${table}`), 0);
    await rejects(() => profile('managed',1,'admin','approved'), '42501');
  });
  await check('spoofed user metadata cannot provision a managed account or clear its password flag', async () => {
    await owner();
    await db.query('insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values ($1,$2,now(),$3::jsonb)', [ids.fakeManaged,'fake@example.invalid',JSON.stringify({ ...managedMetadata,username:'LIWU',must_change_password:false })]);
    await db.query('insert into auth.sessions(id,user_id) values ($1,$2)',[sessionId(ids.fakeManaged),ids.fakeManaged]);
    await user('fakeManaged');
    assert.deepEqual(await query('select username,status,must_change_password from public.profiles'), [{username:null,status:'pending',must_change_password:false}]);
    await user('managed');
    await rejects(() => query('update public.profiles set must_change_password=false'), '42501');
    await rejects(() => query('select public.service_finish_account_reset($1,$2,true)', [ids.managed,ids.admin]), '42501');
  });
  await check('managed creation rejects stale actor roles, malformed aliases, and duplicate usernames atomically', async () => {
    await owner();
    const insert = (email,metadata) => query('insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values (gen_random_uuid(),$1,now(),$2::jsonb)', [email,JSON.stringify(metadata)]);
    await rejects(() => insert('wangwu@accounts.cantonese.invalid',{...managedMetadata,course_username:'WANGWU',course_created_by:ids.student}), '42501');
    await rejects(() => insert('wrong@accounts.cantonese.invalid',{...managedMetadata,course_username:'WANGWU'}), '42501');
    await rejects(() => insert('liwu@accounts.cantonese.invalid',managedMetadata), '23505');
    assert.equal(await scalar("select count(*)::integer from public.profiles where username='LIWU'"), 1);
  });
  await check('completion RPC checks actual Auth password, rejecting unchanged encoded and plaintext names', async () => {
    await user('managed');
    await rejects(() => query('select public.complete_initial_password_change()'), '23514');
    await setManagedPassword("'LIWU'");
    await user('managed');
    await rejects(() => query('select public.complete_initial_password_change()'), '23514');
    assert.equal(await scalar('select must_change_password from public.profiles'), true);
    await user('anon');
    await rejects(() => query('select public.complete_initial_password_change()'), '42501');
  });
  await check('approved admin can assign roles before first login without unlocking initial credentials', async () => {
    await owner();
    ids.roleSetup='10000000-0000-4000-8000-000000000900';
    try {
      await query(`insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data,raw_app_meta_data,encrypted_password)
        values($1,'maaan@accounts.cantonese.invalid',now(),'{"display_name":"Role setup fixture"}',$2::jsonb,${hashPassword("encode(extensions.digest('course-initial-v1:MAAAN','sha256'),'hex')")})`,
        [ids.roleSetup,JSON.stringify({...managedMetadata,course_username:'MAAAN'})]);
      await query('insert into auth.sessions(id,user_id) values($1,$2)',[sessionId(ids.roleSetup),ids.roleSetup]);
      await user('admin');
      const teacher=await profile('roleSetup',1,'teacher','approved');
      assert.equal(teacher.role,'teacher');
      assert.equal(teacher.must_change_password,true);
      await user('roleSetup');
      for(const table of ['resources','lessons','storage.objects']) assert.equal(await scalar(`select count(*)::integer from ${table}`),0);
      await rejects(()=>profile('student',1,'admin','approved'),'42501');
      await rejects(()=>query('select public.complete_initial_password_change()'),'23514');
      await user('admin');
      const administrator=await profile('roleSetup',teacher.version,'admin','approved');
      assert.equal(administrator.must_change_password,true);
      const currentAdminVersion=await scalar('select version from public.profiles where id=$1',[ids.admin]);
      assert.equal(await scalar("select count(*)::integer from public.profiles where role='admin' and status='approved'"),2);
      await rejects(()=>profile('admin',currentAdminVersion,'teacher','approved'),'23514');
      await rejects(()=>profile('admin',currentAdminVersion,'admin','suspended'),'23514');
      await user('roleSetup');
      assert.equal(await scalar('select portal_private.is_admin()'),false);
      await rejects(()=>profile('student',1,'admin','approved'),'42501');
      assert.equal(await scalar('select count(*)::integer from public.resources'),0);
      await owner();
      await query(`update auth.users set encrypted_password=${hashPassword("'abcxyz'")} where id=$1`,[ids.roleSetup]);
      await user('roleSetup');
      const completed=await scalar('select to_jsonb(public.complete_initial_password_change())');
      assert.equal(completed.must_change_password,false);
      assert.equal(completed.role,'admin');
      assert.equal(await scalar('select portal_private.is_admin()'),true);
      assert.equal(await scalar('select count(*)::integer from public.resources where id=$1',[staff.id]),1);
      await user('admin');
      const suspended=await profile('roleSetup',completed.version,'teacher','suspended');
      await user('roleSetup');
      assert.equal(await scalar('select count(*)::integer from public.resources'),0);
      await user('admin');
      const restored=await profile('roleSetup',suspended.version,'student','approved');
      assert.equal(restored.must_change_password,false);
      await user('roleSetup');
      assert.equal(await scalar('select count(*)::integer from public.resources where id=$1',[staff.id]),0);
    } finally { await owner(); await query('delete from auth.users where id=$1',[ids.roleSetup]); }
  });
  await check('managed login names remain immutable while roles can change', async () => {
    await owner();
    await rejects(() => query("update public.profiles set username='RENAMED' where id=$1",[ids.managed]), '23514');
    await rejects(() => query("update auth.users set email='new@example.invalid' where id=$1",[ids.managed]), '23514');
  });
  await check('actual strong password change plus completion unlocks only released student files', async () => {
    await setManagedPassword("'A-new-private-password-2026'");
    await user('managed');
    assert.equal(await scalar('select count(*)::integer from public.resources'), 0);
    assert.equal(await scalar('select (public.complete_initial_password_change()).must_change_password'), false);
    assert.equal(await scalar('select count(*)::integer from public.resources'), 2);
    assert.equal(await scalar('select count(*)::integer from storage.objects'), 2);
    assert.equal(await scalar('select (public.complete_initial_password_change()).version'), 2);
  });
  let managedReset;
  await check('reset uses current versions, denies nonmanaged or privileged targets, and locks student access first', async () => {
    await user('admin');
    await rejects(() => query('select public.admin_begin_account_reset($1,1)', [ids.managed]), '40001');
    await rejects(() => query('select public.admin_begin_account_reset($1,2)', [ids.admin]), '23514');
    managedReset = await scalar('select public.admin_begin_account_reset($1,2)', [ids.managed]);
    assert.equal(managedReset.username,'LIWU');
    assert.equal(managedReset.version,3);
    await rejects(() => query('select public.admin_begin_account_reset($1,3)', [ids.managed]), '40001');
    await user('managed');
    assert.equal(await scalar('select count(*)::integer from public.resources'),0);
    await rejects(() => query('select public.complete_initial_password_change()'),'40001');
    await rejects(() => query('select public.admin_begin_account_reset($1,3)', [ids.managed]),'42501');
  });
  await check('reset completion requires the service role and matching operation, while failed reset stays locked', async () => {
    await importer();
    await rejects(() => query('select public.service_finish_account_reset($1,$2,false)',[ids.managed,ids.admin]),'40001');
    assert.equal(await scalar('select public.service_finish_account_reset($1,$2,false)',[ids.managed,managedReset.reset_token]),true);
    await user('managed');
    assert.equal(await scalar('select must_change_password from public.profiles'),true);
    assert.equal(await scalar('select count(*)::integer from public.resources'),0);
    // Auth reset failed, so the previous strong credential still exists. The
    // student may complete a real password setup, never use the initial name.
    assert.equal(await scalar('select (public.complete_initial_password_change()).must_change_password'),false);
  });
  await check('successful reset still requires changing the initial password and blocks concurrent completion', async () => {
    await user('admin');
    const reset = await scalar('select public.admin_begin_account_reset($1,4)',[ids.managed]);
    await setManagedPassword(managedInitial);
    await user('managed');
    await rejects(() => query('select public.complete_initial_password_change()'),'40001');
    await importer();
    await query('select public.service_finish_account_reset($1,$2,true)',[ids.managed,reset.reset_token]);
    await user('managed');
    await rejects(() => query('select public.complete_initial_password_change()'),'23514');
    await setManagedPassword("'Another-new-private-password-2026'");
    await user('managed');
    await query('select public.complete_initial_password_change()');
    assert.equal(await scalar('select count(*)::integer from public.resources'),2);
  });
  await check('late or direct Auth password updates back to known initial credentials automatically relock access', async () => {
    await setManagedPassword(managedInitial);
    await user('managed');
    assert.equal(await scalar('select must_change_password from public.profiles'),true);
    assert.equal(await scalar('select count(*)::integer from public.resources'),0);
    await rejects(() => query('select public.complete_initial_password_change()'),'23514');
    await setManagedPassword("'Teacher-private-password-2026'");
    await user('managed');
    await query('select public.complete_initial_password_change()');
    await user('admin');
    const version = await scalar('select version from public.profiles where id=$1',[ids.managed]);
    await profile('managed',version,'teacher','approved');
    await rejects(() => query('select public.admin_begin_account_reset($1,$2)',[ids.managed,version+1]),'23514');
    await rejects(() => setManagedPassword(managedInitial),'23514');
  });
  await check('missing, malformed, foreign, and expired session IDs fail closed without exposing course or profile rows', async () => {
    for (const session_id of [undefined,'not-a-uuid',sessionId(ids.admin)]) {
      await user('managed');
      await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:ids.managed,session_id})]);
      assert.equal(await scalar('select portal_private.current_session_is_valid()'),false);
      for (const table of ['profiles','lessons','resources','audit_log','storage.objects']) assert.equal(await scalar(`select count(*)::integer from ${table}`),0);
      await rejects(() => query('select public.complete_initial_password_change()'),'42501');
    }
    await owner();
    await query("update auth.sessions set not_after=now()-interval '1 second' where id=$1",[sessionId(ids.managed)]);
    await user('managed');
    assert.equal(await scalar('select count(*)::integer from public.resources'),0);
    await owner();
    await query('update auth.sessions set not_after=null where id=$1',[sessionId(ids.managed)]);
  });
  await check('a revoked admin JWT cannot read its profile, call admin RPCs, or reach resources', async () => {
    await owner();
    await query('delete from auth.sessions where id=$1',[sessionId(ids.admin)]);
    await user('admin');
    assert.equal(await scalar('select portal_private.is_admin()'),false);
    for (const table of ['profiles','lessons','resources','audit_log','storage.objects']) assert.equal(await scalar(`select count(*)::integer from ${table}`),0);
    await rejects(() => query('select public.admin_begin_account_reset($1,1)',[ids.managed]),'42501');
    await rejects(() => profile('managed',1,'admin','approved'),'42501');
    await owner();
    await query('insert into auth.sessions(id,user_id) values ($1,$2)',[sessionId(ids.admin),ids.admin]);
  });
  ids.replayVictim = '10000000-0000-4000-8000-000000000103';
  const guessedSession = sessionId(ids.replayVictim);
  const realSession = '50000000-0000-4000-8000-000000000103';
  const laterSession = '60000000-0000-4000-8000-000000000103';
  async function victimSession(session_id) {
    await user('replayVictim');
    await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:ids.replayVictim,session_id})]);
  }
  await check('a guessed initial-password session stays blocked after the real student changes password and unlocks', async () => {
    await owner();
    await db.query(`insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data,raw_app_meta_data,encrypted_password)
      values ($1,'wangwu@accounts.cantonese.invalid',now(),'{"display_name":"王五"}',$2::jsonb,${hashPassword("encode(extensions.digest('course-initial-v1:WANGWU','sha256'),'hex')")})`,
      [ids.replayVictim,JSON.stringify({...managedMetadata,course_username:'WANGWU'})]);
    for (const id of [guessedSession,realSession]) await query('insert into auth.sessions(id,user_id) values ($1,$2)',[id,ids.replayVictim]);
    await victimSession(guessedSession);
    assert.equal(await scalar('select count(*)::integer from public.resources'),0);
    await owner();
    // Models Auth.UpdatePassword(currentSession): password update and removal
    // of other sessions share a transaction in the official Auth implementation.
    await db.exec('begin');
    await query(`update auth.users set encrypted_password=${hashPassword("'Real-student-private-password'")} where id=$1`,[ids.replayVictim]);
    await query('delete from auth.sessions where user_id=$1 and id<>$2',[ids.replayVictim,realSession]);
    await db.exec('commit');
    await victimSession(guessedSession);
    await rejects(() => query('select public.complete_initial_password_change()'),'42501');
    await victimSession(realSession);
    assert.equal(await scalar('select (public.complete_initial_password_change()).must_change_password'),false);
    assert.equal(await scalar('select count(*)::integer from public.resources'),2);
    assert.equal(await scalar('select count(*)::integer from storage.objects'),2);
    await victimSession(guessedSession);
    for (const table of ['profiles','lessons','resources','storage.objects']) assert.equal(await scalar(`select count(*)::integer from ${table}`),0);
    await rejects(() => query('select public.complete_initial_password_change()'),'42501');
  });
  await check('JWTs from before an administrator reset stay revoked after the replacement password is completed', async () => {
    await user('admin');
    const reset = await scalar('select public.admin_begin_account_reset($1,2)',[ids.replayVictim]);
    await owner();
    // Auth Admin.UpdateUser(password) removes every old session.
    await db.exec('begin');
    await query(`update auth.users set encrypted_password=${hashPassword("encode(extensions.digest('course-initial-v1:WANGWU','sha256'),'hex')")} where id=$1`,[ids.replayVictim]);
    await query('delete from auth.sessions where user_id=$1',[ids.replayVictim]);
    await db.exec('commit');
    await importer();
    await query('select public.service_finish_account_reset($1,$2,true)',[ids.replayVictim,reset.reset_token]);
    await owner();
    await query('insert into auth.sessions(id,user_id) values ($1,$2)',[laterSession,ids.replayVictim]);
    await query(`update auth.users set encrypted_password=${hashPassword("'Replacement-student-private-password'")} where id=$1`,[ids.replayVictim]);
    await victimSession(laterSession);
    await query('select public.complete_initial_password_change()');
    assert.equal(await scalar('select count(*)::integer from public.resources'),2);
    for (const oldSession of [guessedSession,realSession]) {
      await victimSession(oldSession);
      assert.equal(await scalar('select count(*)::integer from public.resources'),0);
      assert.equal(await scalar('select count(*)::integer from storage.objects'),0);
      await rejects(() => query('select public.complete_initial_password_change()'),'42501');
    }
  });
  process.stdout.write(`\nPASS: ${checks} PostgreSQL security scenarios. Auth/Storage adapters are not an HTTP or multi-connection acceptance test.\n`);
} finally {
  await db.close();
}
