import { createClient } from 'npm:@supabase/supabase-js@2.115.0';

// Deploy with gateway verify_jwt=false; every non-OPTIONS request below still
// requires auth.getUser(token), then current database administrator membership.
// Keep all provider keys on the server. Never return aliases or provider errors.
const PORTAL_ORIGIN = 'https://tommyzhang316.github.io';
const USERNAME = /^[A-Z][A-Z0-9]{1,59}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BYTES = 32768;
type Student = { name: string; username: string };
type Profile = { id: string; role: string; status: string; must_change_password: boolean };
type Reset = { id: string; username: string; name: string; version: number; reset_token: string };
type Result = Student & { status: 'created' | 'existing' | 'error'; id?: string; message?: string };
type Dependencies = {
  authenticate(token: string): Promise<string | null>;
  profile(id: string): Promise<Profile | null>;
  find(username: string): Promise<{ id: string } | null>;
  create(student: Student, actorId: string, password: string): Promise<{ id: string } | null>;
  beginReset(id: string, version: number): Promise<Reset | null>;
  resetPassword(id: string, password: string): Promise<boolean>;
  finishReset(reset: Reset, succeeded: boolean): Promise<boolean>;
};

function defaultDependencies(token: string): Dependencies {
  const url = Deno.env.get('SUPABASE_URL');
  const publicKey = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
  const serverKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SECRET_KEY');
  if (!url || !publicKey || !serverKey) throw new Error('Server configuration unavailable');
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const admin = createClient(url, serverKey, options);
  const caller = createClient(url, publicKey, { ...options, global: { headers: { Authorization: `Bearer ${token}` } } });
  return {
    async authenticate(jwt) {
      const { data, error } = await caller.auth.getUser(jwt);
      return error ? null : data.user?.id || null;
    },
    async profile(id) {
      const { data, error } = await caller.from('profiles').select('id,role,status,must_change_password').eq('id', id).maybeSingle();
      if (error) throw new Error('Profile unavailable');
      return data;
    },
    async find(username) {
      const { data, error } = await caller.from('profiles').select('id').eq('username', username).maybeSingle();
      if (error) throw new Error('Account lookup unavailable');
      return data;
    },
    async create(student, actorId, password) {
      const { data, error } = await admin.auth.admin.createUser({
        email: `${student.username.toLowerCase()}@accounts.cantonese.invalid`,
        password,
        email_confirm: true,
        user_metadata: { display_name: student.name },
        app_metadata: { course_managed: true, course_username: student.username, course_created_by: actorId },
      });
      return error || !data.user ? null : { id: data.user.id };
    },
    async beginReset(id, version) {
      const { data, error } = await caller.rpc('admin_begin_account_reset', { p_profile_id: id, p_expected_version: version });
      return error ? null : data;
    },
    async resetPassword(id, password) {
      const { error } = await admin.auth.admin.updateUserById(id, { password });
      return !error;
    },
    async finishReset(reset, succeeded) {
      const { data, error } = await admin.rpc('service_finish_account_reset', { p_profile_id: reset.id, p_reset_token: reset.reset_token, p_succeeded: succeeded });
      return !error && data === true;
    },
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function validStudent(value: unknown): value is Student {
  return isObject(value) && hasOnlyKeys(value, ['name', 'username'])
    && typeof value.name === 'string' && value.name.trim() === value.name
    && value.name.length >= 1 && value.name.length <= 100
    && /^[\p{L}\p{M} .·'-]+$/u.test(value.name)
    && typeof value.username === 'string' && USERNAME.test(value.username);
}
function activeAdmin(profile: Profile | null): boolean {
  return !!profile && profile.role === 'admin' && profile.status === 'approved' && profile.must_change_password === false;
}

// This public transformation only satisfies the provider's minimum length for
// short names such as LIWU. It gives predictable name passwords no extra security.
export async function initialPassword(username: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`course-initial-v1:${username}`));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function boundedJson(request: Request): Promise<unknown> {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_BYTES)) throw new Error('size');
  if (!request.body) throw new Error('empty');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > MAX_BYTES) { await reader.cancel(); throw new Error('size'); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

export async function handleRequest(request: Request, suppliedDependencies?: Dependencies): Promise<Response> {
  const origin = request.headers.get('origin');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Vary': 'Origin',
    'X-Content-Type-Options': 'nosniff',
  };
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
  if (origin && origin !== PORTAL_ORIGIN) return reply({ error: '此來源不獲允許。' }, 403);
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  headers['Access-Control-Allow-Headers'] = 'authorization, apikey, content-type, x-client-info';
  headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return reply({ error: '只接受 POST 請求。' }, 405);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) return reply({ error: '請使用 JSON 格式。' }, 415);
  const bearer = /^Bearer ([A-Za-z0-9._-]+)$/.exec(request.headers.get('authorization') || '');
  if (!bearer) return reply({ error: '請重新登入。' }, 401);
  try {
    const dependencies = suppliedDependencies || defaultDependencies(bearer[1]);
    const actor = await dependencies.authenticate(bearer[1]);
    if (!actor) return reply({ error: '請重新登入。' }, 401);
    if (!activeAdmin(await dependencies.profile(actor))) return reply({ error: '需要管理員權限。' }, 403);
    let payload: unknown;
    try { payload = await boundedJson(request); }
    catch { return reply({ error: '資料格式不正確或超過大小限制。' }, 400); }
    if (!isObject(payload)) return reply({ error: '資料格式不正確。' }, 400);
    if (payload.action === 'create') {
      if (!hasOnlyKeys(payload, ['action', 'students']) || !Array.isArray(payload.students)
        || payload.students.length < 1 || payload.students.length > 50 || !payload.students.every(validStudent)) {
        return reply({ error: '每次可建立 1 至 50 位學生；請檢查姓名及大寫拼音賬戶。' }, 400);
      }
      const results: Result[] = [];
      for (const student of payload.students as Student[]) {
        try {
          // Re-check each row: an administrator suspended during a long batch
          // cannot continue provisioning. The insertion trigger checks again.
          if (!activeAdmin(await dependencies.profile(actor))) {
            results.push({ ...student, status: 'error', message: '管理員權限已變更，未建立此賬戶。' });
            continue;
          }
          const existing = await dependencies.find(student.username);
          if (existing) {
            results.push({ ...student, status: 'existing', id: existing.id, message: '賬戶已存在，原有資料及密碼保持不變。' });
            continue;
          }
          const created = await dependencies.create(student, actor, await initialPassword(student.username));
          if (created) results.push({ ...student, status: 'created', id: created.id });
          else {
            // Unique Auth aliases and profile usernames settle cross-request
            // collisions. Never convert a failed create into a password reset.
            const concurrent = await dependencies.find(student.username);
            results.push(concurrent
              ? { ...student, status: 'existing', id: concurrent.id, message: '賬戶已存在，原有資料及密碼保持不變。' }
              : { ...student, status: 'error', message: '未能建立，請稍後重試；已有賬戶不會被覆寫。' });
          }
        } catch {
          results.push({ ...student, status: 'error', message: '未能確認結果，請重新載入後重試；已有賬戶不會被覆寫。' });
        }
      }
      return reply({ results });
    }
    if (payload.action === 'reset') {
      if (!hasOnlyKeys(payload, ['action', 'id', 'expected_version']) || typeof payload.id !== 'string' || !UUID.test(payload.id)
        || !Number.isSafeInteger(payload.expected_version) || (payload.expected_version as number) < 1) {
        return reply({ error: '重設資料不正確。' }, 400);
      }
      const reset = await dependencies.beginReset(payload.id, payload.expected_version as number);
      if (!reset) return reply({ error: '賬戶已變更、重設進行中，或不是可重設的學生賬戶。請重新載入。' }, 409);
      let succeeded = false;
      try { succeeded = await dependencies.resetPassword(reset.id, await initialPassword(reset.username)); }
      catch { /* Keep the account locked and report a recoverable server error. */ }
      const finished = await dependencies.finishReset(reset, succeeded);
      if (!succeeded || !finished) return reply({ error: '未能完成重設；賬戶保持需要更改密碼。請重新載入，五分鐘後再試。' }, 503);
      return reply({ status: 'reset', id: reset.id, username: reset.username, name: reset.name, version: reset.version });
    }
    return reply({ error: '不支援此操作。' }, 400);
  } catch {
    // Never log or relay Auth error objects, credentials, aliases, or JWTs.
    return reply({ error: '賬戶服務暫時未能使用，請稍後再試。' }, 503);
  }
}

Deno.serve(request => handleRequest(request));
