// HTTP handler checks with an explicit fake Auth adapter. SQL tests separately
// exercise the real migration; these do not claim a hosted provider test.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { createHash } from 'node:crypto';
const originalDeno = globalThis.Deno;
globalThis.Deno = { serve() {}, env: { get() { return undefined; } } };
const source = await readFile(new URL('../../supabase/functions/manage-accounts/index.ts', import.meta.url), 'utf8');
const executable = stripTypeScriptTypes(source.replace("import { createClient } from 'npm:@supabase/supabase-js@2.115.0';", 'const createClient = () => { throw new Error("Use explicit test adapter"); };'));
const { handleRequest, initialPassword } = await import(`data:text/javascript;base64,${Buffer.from(executable).toString('base64')}`);
const actor = '10000000-0000-4000-8000-000000000001';
const accountId = '10000000-0000-4000-8000-000000000101';
const resetToken = '20000000-0000-4000-8000-000000000101';
const student = { name: '李武', username: 'LIWU' };
let checks = 0;
async function check(name, work) { await work(); process.stdout.write(`ok ${++checks} - ${name}\n`); }
function adapter(overrides = {}) {
  const accounts = new Map();
  const calls = [];
  return {
    accounts, calls,
    async authenticate(token) { calls.push(['authenticate', token]); return token === 'valid.jwt.token' ? actor : null; },
    async profile(id) { calls.push(['profile', id]); return { id, role: 'admin', status: 'approved', must_change_password: false }; },
    async find(username) { calls.push(['find', username]); return accounts.get(username) || null; },
    async create(value, createdBy, password) { calls.push(['create', value, createdBy, password]); accounts.set(value.username, { id: accountId }); return { id: accountId }; },
    async beginReset(id, version) { calls.push(['begin', id, version]); return { ...student, id, version: version + 1, reset_token: resetToken }; },
    async resetPassword(id, password) { calls.push(['password', id, password]); return true; },
    async finishReset(reset, succeeded) { calls.push(['finish', reset, succeeded]); return true; },
    ...overrides,
  };
}
function request(payload = { action: 'create', students: [student] }, options = {}) {
  return new Request('https://project.supabase.co/functions/v1/manage-accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid.jwt.token', Origin: 'https://tommyzhang316.github.io', ...options.headers },
    body: JSON.stringify(payload),
    ...Object.fromEntries(Object.entries(options).filter(([key]) => key !== 'headers')),
  });
}
try {
  await check('the public initial credential encoding exactly matches the frontend/SQL contract', async () => {
    const expected = createHash('sha256').update('course-initial-v1:LIWU').digest('hex');
    assert.equal(await initialPassword('LIWU'), expected);
    assert.equal(expected.length, 64);
  });
  await check('preflight is allowed only on the Portal origin and invokes no Auth or database operations', async () => {
    const deps = adapter();
    const allowed = await handleRequest(request(undefined, { method: 'OPTIONS', body: undefined }), deps);
    assert.equal(allowed.status, 204);
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://tommyzhang316.github.io');
    const denied = await handleRequest(request(undefined, { headers: { Origin: 'https://untrusted.invalid' } }), deps);
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get('access-control-allow-origin'), null);
    assert.deepEqual(deps.calls, []);
  });
  await check('missing, invalid, and expired bearer credentials cannot invoke provisioning', async () => {
    for (const authorization of ['', 'Bearer invalid.jwt.token', 'Basic secret', 'Bearer a b']) {
      const deps = adapter();
      const response = await handleRequest(request(undefined, { headers: { Authorization: authorization } }), deps);
      assert.equal(response.status, 401);
      assert.equal(deps.calls.some(call => call[0] === 'create'), false);
    }
  });
  await check('student, teacher, suspended admin, and initial-password admin are all denied', async () => {
    for (const change of [{ role: 'student' }, { role: 'teacher' }, { status: 'suspended' }, { must_change_password: true }]) {
      const deps = adapter({ async profile(id) { return { id, role: 'admin', status: 'approved', must_change_password: false, ...change }; } });
      const response = await handleRequest(request(), deps);
      assert.equal(response.status, 403);
      assert.equal(deps.calls.some(call => call[0] === 'create'), false);
    }
  });
  await check('invalid payloads and hidden role/password fields reject the entire batch before writes', async () => {
    for (const payload of [null, [], {}, { action: 'create', students: [] }, { action: 'create', students: Array(51).fill(student) },
      { action: 'create', students: [student], role: 'admin' },
      ...[{ ...student, username: 'liwu' }, { ...student, username: 'L' }, { ...student, username: '1LIWU' },
        { ...student, username: 'LI@WU' }, { ...student, username: 'L'.repeat(61) },
        { ...student, name: '李\n武' }, { ...student, name: '<script>' }, { ...student, role: 'teacher' },
        { ...student, password: 'chosen' }].map(value => ({ action: 'create', students: [student, value] }))]) {
      const deps = adapter();
      assert.equal((await handleRequest(request(payload), deps)).status, 400);
      assert.equal(deps.calls.some(call => call[0] === 'create'), false);
    }
  });
  await check('content type, invalid JSON, and chunked oversized bodies are rejected without writes', async () => {
    for (const options of [{ headers: { 'Content-Type': 'text/plain' } }, { body: '{invalid' }, { body: ' '.repeat(32769) }, { headers: { 'Content-Length': '999999' } }]) {
      const deps = adapter();
      assert.ok([400, 415].includes((await handleRequest(request(undefined, options), deps)).status));
      assert.equal(deps.calls.some(call => call[0] === 'create'), false);
    }
  });
  await check('a valid batch creates approved-account inputs once and returns no aliases or passwords', async () => {
    const deps = adapter();
    const response = await handleRequest(request(), deps);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { results: [{ ...student, id: accountId, status: 'created' }] });
    assert.deepEqual(deps.calls.find(call => call[0] === 'create'), ['create', student, actor, await initialPassword('LIWU')]);
  });
  await check('same-batch duplicates and repeated requests never reset passwords or alter existing users', async () => {
    const deps = adapter();
    let response = await handleRequest(request({ action: 'create', students: [student, student] }), deps);
    assert.deepEqual((await response.json()).results.map(row => row.status), ['created', 'existing']);
    response = await handleRequest(request(), deps);
    assert.equal((await response.json()).results[0].status, 'existing');
    assert.equal(deps.calls.filter(call => call[0] === 'create').length, 1);
    assert.equal(deps.calls.some(call => call[0] === 'password'), false);
  });
  await check('cross-request unique collisions report existing without converting create to a reset', async () => {
    let finds = 0;
    const deps = adapter({ async find() { return ++finds === 1 ? null : { id: accountId }; }, async create() { return null; } });
    const response = await handleRequest(request(), deps);
    assert.equal((await response.json()).results[0].status, 'existing');
    assert.equal(deps.calls.some(call => call[0] === 'password'), false);
  });
  await check('partial provider failures retain successful rows and never leak raw provider error details', async () => {
    const deps = adapter({ async create(value) { if (value.username === 'LIWU') throw new Error('PRIVATE_PROVIDER_ERROR secret_token'); return { id: accountId }; } });
    const response = await handleRequest(request({ action: 'create', students: [student, { name: '王五', username: 'WANGWU' }] }), deps);
    const text = await response.text();
    assert.deepEqual(JSON.parse(text).results.map(row => row.status), ['error', 'created']);
    assert.equal(text.includes('PRIVATE_PROVIDER_ERROR'), false);
    assert.equal(text.includes('secret_token'), false);
  });
  await check('revoking administrator role during a batch stops later row creation', async () => {
    let profiles = 0;
    const deps = adapter({ async profile(id) { return { id, role: ++profiles <= 2 ? 'admin' : 'student', status: 'approved', must_change_password: false }; } });
    const response = await handleRequest(request({ action: 'create', students: [student, { name: '王五', username: 'WANGWU' }] }), deps);
    assert.deepEqual((await response.json()).results.map(row => row.status), ['created', 'error']);
    assert.equal(deps.calls.filter(call => call[0] === 'create').length, 1);
  });
  await check('reset payload validation disallows forged state, arbitrary passwords, and invalid target IDs', async () => {
    for (const payload of [{ action: 'reset', id: 'invalid', expected_version: 1 }, { action: 'reset', id: accountId, expected_version: 0 },
      { action: 'reset', id: accountId, expected_version: 1, password: 'chosen' }]) {
      const deps = adapter();
      assert.equal((await handleRequest(request(payload), deps)).status, 400);
      assert.equal(deps.calls.some(call => call[0] === 'password'), false);
    }
  });
  await check('a stale or forbidden reset target never reaches Auth Admin update', async () => {
    const deps = adapter({ async beginReset() { return null; } });
    assert.equal((await handleRequest(request({ action: 'reset', id: accountId, expected_version: 1 }), deps)).status, 409);
    assert.equal(deps.calls.some(call => call[0] === 'password'), false);
  });
  await check('reset locks through the RPC before password mutation and finalizes without exposing its operation token', async () => {
    const deps = adapter();
    const response = await handleRequest(request({ action: 'reset', id: accountId, expected_version: 1 }), deps);
    assert.equal(response.status, 200);
    assert.deepEqual(deps.calls.filter(call => ['begin', 'password', 'finish'].includes(call[0])).map(call => call[0]), ['begin', 'password', 'finish']);
    assert.equal(deps.calls.find(call => call[0] === 'finish')[2], true);
    const data = await response.json();
    assert.deepEqual(data, { ...student, status: 'reset', id: accountId, version: 2 });
  });
  await check('provider reset rejection and network exceptions finalize as failed, with no successful credential export', async () => {
    for (const resetPassword of [async () => false, async () => { throw new Error('PRIVATE_SECRET'); }]) {
      const deps = adapter({ resetPassword });
      const response = await handleRequest(request({ action: 'reset', id: accountId, expected_version: 1 }), deps);
      assert.equal(response.status, 503);
      assert.equal(deps.calls.find(call => call[0] === 'finish')[2], false);
      assert.equal((await response.text()).includes('PRIVATE_SECRET'), false);
    }
  });
  await check('uncertain finalization never claims reset success', async () => {
    const deps = adapter({ async finishReset() { return false; } });
    assert.equal((await handleRequest(request({ action: 'reset', id: accountId, expected_version: 1 }), deps)).status, 503);
  });
  process.stdout.write(`\nPASS: ${checks} managed-account HTTP handler scenarios with fake provider adapters.\n`);
} finally {
  if (originalDeno === undefined) delete globalThis.Deno;
  else globalThis.Deno = originalDeno;
}
