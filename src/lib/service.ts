import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Account, AccountStatus, AuditEntry, Category, CreateAccountResult, Lesson, PortalService, Resource, ResourceInput, Role } from '../types';
import { initialPasswordTransport, loginCredentials } from './login';

const BUCKET = 'course-materials';
const LOCATION = '香港西營盤干諾道西148號成基商業中心2301室';
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const categories = new Set<Category>(['notes', 'slides', 'activity', 'game', 'exam', 'guide', 'other']);

class PortalError extends Error {}
function fail(message: string): never { throw new PortalError(message); }
function translated(error: unknown): Error {
  if (error instanceof PortalError) return error;
  const value = error as { code?: string; message?: string; status?: number } | null;
  const code = value?.code ?? '';
  if (code === '40001') return new PortalError('這筆資料已由其他管理員更新。請重新載入，確認最新內容後再儲存。');
  if (code === '42501' || value?.status === 403) return new PortalError('你目前沒有進行這項操作的權限，或資料尚未公開。請重新載入頁面。');
  if (code === 'P0002' || value?.status === 404) return new PortalError('找不到這份資料，可能已被封存或更換。請重新載入。');
  if (code === '23505') return new PortalError('這份文件已被使用。請重新選擇文件並上傳一個新版本。');
  if (code === '23514') {
    if (value?.message?.includes('管理員')) return new PortalError('必須保留至少一位已核准的管理員。請先指定另一位管理員。');
    if (value?.message?.includes('電郵')) return new PortalError('這個賬戶尚未完成電郵驗證，請先完成驗證再核准。');
    if (value?.message?.includes('封存')) return new PortalError('請先恢復這份已封存的資料，再進行修改。');
    if (value?.message?.includes('上傳')) return new PortalError('文件尚未成功上傳，請重新選擇文件後再試。');
    return new PortalError('資料格式不完整或不符合要求。請檢查標題、文件大小及公開時間。');
  }
  if (['22023', '22P02', '23502', '22007', '22008'].includes(code)) return new PortalError('請檢查必填資料、日期及時間是否正確。');
  if (code === 'invalid_credentials') return new PortalError('帳戶名稱／電郵或密碼不正確，請再試一次。');
  if (code === 'same_password') return new PortalError('請選擇與目前密碼不同的新密碼。');
  if (code === 'email_not_confirmed') return new PortalError('請先開啟驗證電郵並完成驗證，再登入。');
  if (['over_email_send_rate_limit', 'over_request_rate_limit', 'over_email_send_rate_limit'].includes(code) || value?.status === 429) return new PortalError('操作太頻密，請稍後再試。若已要求電郵，請先檢查收件匣及垃圾郵件。');
  if (code === 'weak_password') return new PortalError('請使用至少6字元的密碼。');
  if (code === 'user_already_exists') return new PortalError('這個電郵可能已經註冊。請嘗試登入或重設密碼。');
  if (['session_not_found', 'refresh_token_not_found', 'refresh_token_already_used', 'bad_jwt', 'user_not_found'].includes(code) || value?.status === 401) return new PortalError('登入已過期，請重新登入。');
  if (error instanceof TypeError || /fetch|network|connection|timeout/i.test(value?.message ?? '')) return new PortalError('暫時無法連線，請檢查網絡後再試。');
  return new PortalError('暫時未能完成操作，請稍後再試。若持續出現，請聯絡課程管理員。');
}
async function handled<T>(work: () => Promise<T>): Promise<T> { try { return await work(); } catch (error) { throw translated(error); } }

function accountUpdateError(error: unknown): Error {
  const value = error as { code?: string; message?: string; status?: number } | null;
  if (value?.code === '23514') {
    // Only map known account constraints. Never expose arbitrary database messages
    // or reuse the materials form's title, file-size and release-date guidance.
    const constraints: Record<string, string> = {
      '必須保留至少一位已核准的管理員。': '必須保留至少一位已啟用的管理員。請先指定另一位管理員。',
      '請先完成電郵驗證，然後再核准賬戶。': '這個賬戶尚未完成電郵驗證。請先完成驗證，再啟用賬戶。',
      '登入賬戶名稱建立後不可更改。': '帳戶名稱建立後不可更改。請保留原有帳戶名稱，再更新權限或狀態。',
      '由後臺建立的賬戶使用固定登入名稱。': '帳戶名稱建立後不可更改。請保留原有帳戶名稱，再更新權限或狀態。',
      '請先完成首次更改密碼，再提升賬戶角色。': '這個賬戶尚未完成首次更改密碼。請先完成密碼設定，再更新權限。',
    };
    const message = value.message ?? '';
    return new PortalError(Object.hasOwn(constraints, message) ? constraints[message] : '未能更新這個賬戶的權限或狀態。請重新載入帳戶清單，核對設定後再試。');
  }
  if (value?.code === 'P0002' || value?.status === 404) return new PortalError('找不到這個賬戶。請重新載入帳戶清單。');
  if (value?.code === '23505') return new PortalError('帳戶資料與現有賬戶重複。請重新載入帳戶清單，核對後再試。');
  if (['22023', '22P02', '23502'].includes(value?.code ?? '')) return new PortalError('請選擇有效的賬戶權限及狀態，再重新儲存。');
  return translated(error);
}

function account(row: Record<string, unknown>): Account {
  return { id: String(row.id), email: String(row.email ?? ''), username: row.username ? String(row.username) : null, must_change_password: row.must_change_password === true, display_name: String(row.display_name ?? ''), role: row.role as Role,
    status: row.status === 'approved' ? 'active' : row.status as AccountStatus, updated_at: String(row.updated_at), version: Number(row.version) };
}
function lesson(row: Record<string, unknown>): Lesson {
  const starts_at = row.starts_at ? String(row.starts_at) : null;
  const duration_minutes = Number(row.duration_minutes);
  return { id: Number(row.id), title: String(row.title), summary: String(row.summary ?? ''), starts_at,
    ends_at: starts_at ? new Date(new Date(starts_at).getTime() + duration_minutes * 60_000).toISOString() : '', location: LOCATION,
    duration_minutes, sort_order: Number(row.sort_order), updated_at: String(row.updated_at), version: Number(row.version) };
}
function resource(row: Record<string, unknown>): Resource {
  return { ...row, category: categories.has(row.category as Category) ? row.category as Category : 'other', file_size: Number(row.file_size), version: Number(row.version) } as unknown as Resource;
}
function safeFilename(name: string): string { return name.replace(/[\\/\u0000-\u001f\u007f]/g, '_').slice(0, 200) || '課程資料'; }
function mimeType(file: File): string {
  if (file.type) return file.type;
  const extension = file.name.split('.').pop()?.toLowerCase();
  const types: Record<string, string> = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', zip: 'application/zip', html: 'text/html', txt: 'text/plain', md: 'text/markdown', png: 'image/png', jpg: 'image/jpeg', mp3: 'audio/mpeg', mp4: 'video/mp4' };
  return types[extension ?? ''] ?? 'application/octet-stream';
}
function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = safeFilename(filename);
  anchor.rel = 'noopener';
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Browsers must have a turn to start consuming the object URL before revocation.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function unavailable(): PortalService {
  const reject = async (): Promise<never> => fail('網站尚未完成連線設定，請聯絡課程管理員。');
  return { configured: false, demo: false, session: async () => null, onAuthChange: () => () => {}, signIn: reject, signOut: reject,
    requestPasswordReset: reject, updatePassword: reject, lessons: reject, resources: reject, accounts: reject, audit: reject,
    download: reject, saveResource: reject, archiveResource: reject, updateAccount: reject, updateLesson: reject, createAccounts: reject, resetInitialPassword: reject };
}

function connected(client: SupabaseClient): PortalService {
  async function current(): Promise<Account | null> {
    const sessionResult = await client.auth.getSession();
    if (sessionResult.error) throw sessionResult.error;
    if (!sessionResult.data.session) return null;
    const authenticated = await client.auth.getUser();
    if (authenticated.error) throw authenticated.error;
    const result = await client.from('profiles').select('*').eq('id', authenticated.data.user.id).single();
    if (result.error) throw result.error;
    return account(result.data);
  }
  async function active(admin = false): Promise<Account> {
    const user = await current();
    if (!user) fail('請先登入，再使用課程資料。');
    if (user.status !== 'active') fail(user.status === 'pending' ? '賬戶正在等候核准，請稍後再查看。' : '這個賬戶已停用，請聯絡課程管理員。');
    if (user.must_change_password) fail('請先更改初始密碼，再使用課程材料。');
    if (admin && user.role !== 'admin') fail('這項操作需要管理員權限。');
    return user;
  }
  async function accountOperation(body: Record<string, unknown>) {
    const result = await client.functions.invoke('manage-accounts', { body });
    if (result.error) {
      const context = result.error.context as Response | undefined;
      if (context?.status === 409) fail('帳戶資料已變更或重設仍在處理。請重新整理帳戶清單後再試。');
      if (context?.status === 401) fail('登入已過期，請重新登入。');
      if (context?.status === 403) fail('你目前沒有管理員權限，請重新登入核對。');
      if (context?.status === 503) fail('帳戶服務暫時未能完成操作。請先重新整理核對結果；重設失敗時可在五分鐘後再試。');
      if (context?.status === 400) fail('請核對學生姓名及大寫拼音帳戶，每批最多50人。');
      throw result.error;
    }
    return result.data;
  }
  const service: PortalService = {
    configured: true, demo: false,
    session: () => handled(current),
    onAuthChange(callback) {
      let subscribed = true;
      let lastUserId: string | null | undefined;
      const { data } = client.auth.onAuthStateChange((event, session) => {
        const userId = session?.user.id ?? null;
        const changed = lastUserId !== userId;
        lastUserId = userId;
        // Token renewal and repeated sign-in events must not discard an admin's
        // unsaved form. App separately refreshes live profile permissions on focus
        // and every minute, and each API/download enforces current database RLS.
        if (event === 'INITIAL_SESSION' || !changed) return;
        queueMicrotask(() => { if (subscribed) callback(); });
      });
      return () => { subscribed = false; data.subscription.unsubscribe(); };
    },
    signIn: (identifier, password) => handled(async () => {
      let credentials;
      try { credentials = await loginCredentials(identifier, password); } catch { fail('請輸入管理員提供的帳戶名稱，或已登記的電郵。'); }
      const result = await client.auth.signInWithPassword(credentials);
      if (result.error) throw result.error;
      const user = await current();
      if (!user) fail('未能取得賬戶資料，請重新登入。');
      return user;
    }),
    signOut: () => handled(async () => { const result = await client.auth.signOut(); if (result.error) throw result.error; }),
    requestPasswordReset: email => handled(async () => {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.trim().toLowerCase().endsWith('@accounts.cantonese.invalid')) fail('拼音帳戶請聯絡課程管理員重設密碼。');
      const result = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}${window.location.pathname}?recovery=1` });
      if (result.error) throw result.error;
    }),
    updatePassword: password => handled(async () => {
      if (password.length < 6) fail('請使用至少6字元的密碼。');
      const user = await current();
      if (!user) fail('請先登入，或重新開啟密碼重設連結。');
      if (user.username && (password.toUpperCase() === user.username || password === await initialPasswordTransport(user.username))) fail('新密碼不可與帳戶名稱或初始密碼相同。');
      const result = await client.auth.updateUser({ password });
      if (result.error && !(user.must_change_password && result.error.code === 'same_password')) throw result.error;
      if (user.must_change_password) {
        const completed = await client.rpc('complete_initial_password_change');
        if (completed.error) throw completed.error;
      }
    }),
    lessons: () => handled(async () => {
      await active();
      const result = await client.from('lessons').select('*').order('sort_order');
      if (result.error) throw result.error;
      return (result.data ?? []).map(lesson);
    }),
    resources: () => handled(async () => {
      await active();
      const result = await client.from('resources').select('*').order('lesson_id', { nullsFirst: true }).order('title');
      if (result.error) throw result.error;
      return (result.data ?? []).map(resource);
    }),
    accounts: () => handled(async () => {
      await active(true);
      const result = await client.from('profiles').select('*').order('created_at', { ascending: false });
      if (result.error) throw result.error;
      return (result.data ?? []).map(account);
    }),
    createAccounts: rows => handled(async () => {
      await active(true);
      if (!rows.length || rows.length > 50) fail('每批請建立1至50個學生帳戶。');
      const data = await accountOperation({ action: 'create', students: rows });
      if (!data || !Array.isArray(data.results)) fail('未能確認帳戶建立結果，請重新載入帳戶清單核對後再試。');
      const known = new Set(rows.map(row => row.username));
      const results = data.results as CreateAccountResult[];
      if (results.length !== rows.length || results.some(row => !known.has(row.username) || !['created','existing','error'].includes(row.status))) fail('帳戶結果不完整，請重新載入帳戶清單核對。');
      return results;
    }),
    resetInitialPassword: item => handled(async () => {
      await active(true);
      if (!item.username || item.role !== 'student') fail('這項重設只適用於管理員建立的學生帳戶。');
      const data = await accountOperation({ action: 'reset', id: item.id, expected_version: item.version });
      if (data?.status !== 'reset' || data.id !== item.id) fail('未能確認重設結果，請重新載入帳戶清單。');
    }),
    audit: () => handled(async () => {
      await active(true);
      const [logs, profiles] = await Promise.all([client.from('audit_log').select('*').order('created_at', { ascending: false }).limit(100), client.from('profiles').select('id,display_name')]);
      if (logs.error) throw logs.error;
      if (profiles.error) throw profiles.error;
      const actors = new Map((profiles.data ?? []).map(row => [row.id, row.display_name]));
      const policyNames: Record<string, string> = { never: '教師專用', immediate: '即時公開', scheduled: '定時公開' };
      const roleNames: Record<string, string> = { student: '學生', teacher: '老師', admin: '管理員' };
      const statusNames: Record<string, string> = { pending: '待核准', approved: '已核准', suspended: '已停用' };
      return (logs.data ?? []).map((row): AuditEntry => {
        const before = (row.before_data ?? {}) as Record<string, unknown>;
        const after = (row.after_data ?? {}) as Record<string, unknown>;
        const changes: string[] = [];
        let action = '更新資料';
        if (row.entity_type === 'profiles') {
          action = '更新賬戶';
          const managedActions: Record<string,string> = { create_managed_account: '建立學生帳戶', begin_account_reset: '開始重設密碼', finish_account_reset: '已重設初始密碼', fail_account_reset: '密碼重設未完成' };
          action = managedActions[row.action] ?? action;
          if (before.role !== after.role) changes.push(`角色：${roleNames[String(before.role)] ?? '未設定'} → ${roleNames[String(after.role)] ?? '未設定'}`);
          if (before.status !== after.status) changes.push(`狀態：${statusNames[String(before.status)] ?? '未設定'} → ${statusNames[String(after.status)] ?? '未設定'}`);
          if (before.email !== after.email) changes.push('電郵已更新');
          if (before.must_change_password !== after.must_change_password && typeof after.must_change_password === 'boolean') changes.push(after.must_change_password ? '下次登入須更改密碼' : '已完成首次密碼設定');
        } else if (row.entity_type === 'resources') {
          action = row.action === 'insert' ? '新增資料' : '更新資料';
          if (!before.archived_at && after.archived_at) action = '封存資料';
          else if (before.archived_at && !after.archived_at) action = '恢復資料';
          if (before.student_policy !== after.student_policy) changes.push(`公開方式：${policyNames[String(after.student_policy)] ?? '已更新'}`);
          if (before.release_at !== after.release_at) changes.push(after.release_at ? `公開時間：${new Intl.DateTimeFormat('zh-HK', { timeZone: 'Asia/Hong_Kong', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(String(after.release_at)))}` : '取消定時公開');
          if (row.action !== 'insert' && before.storage_path !== after.storage_path) changes.push('已更換文件版本');
        } else if (row.entity_type === 'lessons') {
          action = row.action === 'insert' ? '建立課堂' : '更新課堂';
          if (before.starts_at !== after.starts_at) changes.push(after.starts_at ? '已更新上課時間' : '上課日期待定');
          if (before.duration_minutes !== after.duration_minutes) changes.push(`課長：${after.duration_minutes}分鐘`);
        }
        if (row.action === 'delete') action = '移除記錄';
        return { id: String(row.id), created_at: row.created_at, actor_name: actors.get(row.actor_id) ?? '系統／專案管理員', action,
          target_label: String(after.title ?? before.title ?? after.display_name ?? before.display_name ?? '課程設定'), detail: changes.join('；') || '已儲存資料設定。' };
      });
    }),
    download: requested => handled(async () => {
      await active();
      // Use only the current RLS-filtered row, never the stale path retained in UI state.
      const latest = await client.from('resources').select('*').eq('id', requested.id).maybeSingle();
      if (latest.error) throw latest.error;
      if (!latest.data) fail('這份資料尚未公開、已被封存，或你已沒有存取權限。');
      const result = await client.storage.from(BUCKET).download(latest.data.storage_path);
      if (result.error) throw result.error;
      // Catch role/status changes while a large file was in flight before saving it locally.
      await active();
      const stillAccessible = await client.from('resources').select('id,version').eq('id', requested.id).maybeSingle();
      if (stillAccessible.error) throw stillAccessible.error;
      if (!stillAccessible.data || stillAccessible.data.version !== latest.data.version) fail('這份資料的權限或版本剛剛更新，請重新載入後再下載。');
      saveBlob(result.data, latest.data.file_name);
    }),
    saveResource: (input, currentResource, file) => handled(async () => {
      await active(true);
      if (!input.title.trim()) fail('請填寫資料標題。');
      if (input.student_policy === 'scheduled' && !input.release_at) fail('請設定公開日期及時間。');
      if (!currentResource && !file) fail('請選擇要上傳的文件。');
      let fileFields = currentResource ? { storage_path: currentResource.storage_path, file_name: currentResource.file_name, file_size: currentResource.file_size, mime_type: currentResource.mime_type } : null;
      if (file) {
        if (file.size < 1 || file.size > MAX_FILE_SIZE) fail('請選擇大於0位元組、並且不超過50 MB的文件。');
        const extension = file.name.split('.').pop()?.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10).toLowerCase() || 'bin';
        const storage_path = `resources/${crypto.randomUUID()}/${crypto.randomUUID()}/material.${extension}`;
        const mime_type = mimeType(file);
        const upload = await client.storage.from(BUCKET).upload(storage_path, file, { upsert: false, contentType: mime_type, cacheControl: '0' });
        if (upload.error) throw upload.error;
        fileFields = { storage_path, file_name: safeFilename(file.name), file_size: file.size, mime_type };
      }
      const result = await client.rpc('admin_save_resource', { p_resource_id: currentResource?.id ?? null, p_expected_version: currentResource?.version ?? null,
        p_values: { ...input, title: input.title.trim(), release_at: input.student_policy === 'scheduled' ? input.release_at : null, ...fileFields } });
      if (result.error) throw result.error;
    }),
    archiveResource: (item, archive) => handled(async () => {
      await active(true);
      const result = await client.rpc('admin_set_resource_archived', { p_resource_id: item.id, p_expected_version: item.version, p_archived: archive });
      if (result.error) throw result.error;
    }),
    updateAccount: (item, role, status) => handled(async () => {
      await active(true);
      const result = await client.rpc('admin_update_profile', { p_profile_id: item.id, p_expected_version: item.version, p_role: role, p_status: status === 'active' ? 'approved' : status });
      if (result.error) throw accountUpdateError(result.error);
    }),
    updateLesson: (item, input) => handled(async () => {
      await active(true);
      const duration = Number(input.duration_minutes);
      const result = await client.rpc('admin_update_lesson', { p_lesson_id: item.id, p_expected_version: item.version,
        p_values: { title: input.title.trim(), summary: input.summary, starts_at: input.starts_at || null, duration_minutes: duration, sort_order: item.sort_order } });
      if (result.error) throw result.error;
    }),
  };
  return service;
}

export async function createPortalService(): Promise<PortalService> {
  if (import.meta.env.VITE_ENABLE_DEMO === 'true' && new URLSearchParams(window.location.search).get('demo') === '1') {
    const { createDemoService } = await import('./demo');
    return createDemoService();
  }
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !key) return unavailable();
  // The build pipeline must reject secrets too: this guard prevents using an
  // accidentally supplied privileged key but cannot remove it from a built bundle.
  if (key.startsWith('sb_secret_')) return unavailable();
  if (!key.startsWith('sb_publishable_')) {
    try {
      const claims = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as { role?: string };
      if (claims.role !== 'anon') return unavailable();
    } catch { return unavailable(); }
  }
  try {
    const parsed = new URL(url);
    const localDevelopment = import.meta.env.DEV && parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
    if (parsed.protocol !== 'https:' && !localDevelopment) return unavailable();
  } catch { return unavailable(); }
  return connected(createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' } }));
}

export const service = await createPortalService();
