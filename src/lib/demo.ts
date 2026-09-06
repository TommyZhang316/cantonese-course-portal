import type { Account, AccountStatus, AuditEntry, CreateAccountResult, Lesson, PortalService, Resource, ResourceInput, Role } from '../types';

// This module is dynamically imported only by a demo-mode build with ?demo=1.
// All data is synthetic; no production account or course file is included.
export const DEMO_NOW = new Date('2026-10-02T19:00:00+08:00').getTime();
export const DEMO_PASSWORD = 'DemoOnly!2026';
const LOCATION = '香港西營盤干諾道西148號成基商業中心2301室';
const STAMP = new Date(DEMO_NOW).toISOString();
const clone = <T>(value: T): T => structuredClone(value);
const roleLabel: Record<Role, string> = { student: '學生', teacher: '老師', admin: '管理員' };
const statusLabel: Record<AccountStatus, string> = { pending: '待核准', active: '已核准', suspended: '已停用' };
const policyLabel = { never: '教師專用', immediate: '即時公開', scheduled: '定時公開' };
const topics = [
  ['介紹與問候', '從聲調與日常招呼開始，練習介紹自己。'],
  ['電話與相約', '聽懂數字，說清楚時間，一起安排見面。'],
  ['問路與方向', '練習問方向、辨認地點，聽懂簡單路線。'],
  ['交通與出行', '練習問交通方式、乘車及確認目的地。'],
  ['購物與付款', '用顏色、數量和價錢完成購物對話。'],
  ['飲食與點餐', '練習禮貌點餐、提出需要與結賬。'],
  ['天氣與香港生活', '說說天氣與日常安排，練習生活表達。'],
  ['綜合練習與彩排', '把學過的句子連起來，完成課程情境任務。'],
];
const classDates = ['2026-09-18', '2026-10-02', '2026-10-09', '2026-10-16', '2026-10-23', '2026-10-30', '2026-11-06', '2026-11-13'];

export function createDemoService(): PortalService {
  let selectedId: string | null = 'demo-student';
  const listeners = new Set<() => void>();
  let sequence = 1;
  const accounts: Account[] = [
    { id: 'demo-admin', username: null, must_change_password: false, email: 'admin@course.invalid', display_name: '林老師', role: 'admin', status: 'active', version: 1, updated_at: STAMP },
    { id: 'demo-teacher', username: null, must_change_password: false, email: 'teacher@course.invalid', display_name: '陳老師', role: 'teacher', status: 'active', version: 1, updated_at: STAMP },
    { id: 'demo-student', username: 'XIAOQING', must_change_password: false, email: 'student@course.invalid', display_name: '小晴', role: 'student', status: 'active', version: 1, updated_at: STAMP },
    { id: 'demo-pending', username: null, must_change_password: false, email: 'pending@course.invalid', display_name: '新同學', role: 'student', status: 'pending', version: 1, updated_at: STAMP },
    { id: 'demo-initial', username: 'LIWU', must_change_password: true, email: 'first@course.invalid', display_name: '李武（示範）', role: 'student', status: 'active', version: 1, updated_at: STAMP },
  ];
  const passwords = new Map(accounts.map(item => [item.id, DEMO_PASSWORD]));
  passwords.set('demo-initial', 'LIWU');
  const lessons: Lesson[] = topics.map(([title, summary], index) => {
    const starts = new Date(`${classDates[index]}T18:00:00+08:00`);
    return { id: index + 1, title, summary, starts_at: starts.toISOString(), ends_at: new Date(starts.getTime() + 120 * 60_000).toISOString(),
      duration_minutes: 120, sort_order: index + 1, location: LOCATION, version: 1, updated_at: STAMP };
  });
  const resources: Resource[] = lessons.flatMap(item => {
    const release = new Date(new Date(item.starts_at!).getTime() - 7 * 86_400_000 - 9 * 3_600_000).toISOString();
    const basic = { lesson_id: item.id, description: '本機示範資料，用於查看網站操作；下載為純文字示範檔案。', release_at: release,
      archived_at: null, mime_type: 'application/pdf', file_size: 368_640 + item.id * 27_100, version: 1, updated_at: STAMP };
    return [
      { ...basic, id: `demo-notes-${item.id}`, title: `第${item.id}課・學生筆記`, category: 'notes' as const, student_policy: 'scheduled' as const, file_name: `第${item.id}課_學生筆記.pdf`, storage_path: `demo-only/notes-${item.id}` },
      { ...basic, id: `demo-slides-${item.id}`, title: `第${item.id}課・課堂演示`, category: 'slides' as const, student_policy: 'scheduled' as const, mime_type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', file_size: 1_482_752, file_name: `第${item.id}課_課堂演示.pptx`, storage_path: `demo-only/slides-${item.id}` },
      { ...basic, id: `demo-teacher-${item.id}`, title: `第${item.id}課・教師備課與答案`, category: 'guide' as const, student_policy: 'never' as const, release_at: null, file_name: `第${item.id}課_教師備課.pdf`, storage_path: `demo-only/teacher-${item.id}` },
    ];
  });
  resources.push(
    { id: 'demo-guide', title: '課程使用指南', description: '上課準備、學習方法與材料使用方式。本頁為本機示範。', lesson_id: null, category: 'guide', student_policy: 'immediate', release_at: null, archived_at: null, file_name: '課程使用指南.pdf', mime_type: 'application/pdf', file_size: 184_320, storage_path: 'demo-only/guide', version: 1, updated_at: STAMP },
    { id: 'demo-game', title: '第一課・打招呼配對遊戲', description: '兩人一組，將情境與招呼語配對。下載為示範文字。', lesson_id: 1, category: 'game', student_policy: 'scheduled', release_at: '2026-09-11T09:00:00+08:00', archived_at: null, file_name: '第一課_配對遊戲.html', mime_type: 'text/html', file_size: 45_120, storage_path: 'demo-only/game', version: 1, updated_at: STAMP },
    { id: 'demo-exam', title: '期末筆試・教師答案', description: '教師專用示範資料，永不向学生公開。', lesson_id: 8, category: 'exam', student_policy: 'never', release_at: null, archived_at: null, file_name: '期末筆試_教師答案.pdf', mime_type: 'application/pdf', file_size: 204_800, storage_path: 'demo-only/exam-key', version: 1, updated_at: STAMP },
    { id: 'demo-archive', title: '舊版課程說明（示範）', description: '用於測試封存及恢復。', lesson_id: null, category: 'guide', student_policy: 'never', release_at: null, archived_at: STAMP, file_name: '舊版說明.pdf', mime_type: 'application/pdf', file_size: 81_920, storage_path: 'demo-only/archive', version: 1, updated_at: STAMP },
  );
  const audit: AuditEntry[] = [
    { id: 'demo-audit-initial', actor_name: '林老師', action: '設定公開時間', target_label: '第一課學生材料', detail: '預設於上課前七天的香港時間09:00公開。', created_at: STAMP },
  ];
  const updated = (): string => new Date().toISOString();
  function emit(): void { queueMicrotask(() => listeners.forEach(callback => callback())); }
  function current(): Account | null { return accounts.find(item => item.id === selectedId) ?? null; }
  function requireActive(admin = false): Account {
    const item = current();
    if (!item) throw new Error('請先登入示範賬戶。');
    if (item.status !== 'active') throw new Error(item.status === 'pending' ? '賬戶正在等候核准。' : '這個賬戶已停用。');
    if (item.must_change_password) throw new Error('請先更改初始密碼。');
    if (admin && item.role !== 'admin') throw new Error('這項操作需要管理員權限。');
    return item;
  }
  function allowed(item: Resource, person: Account): boolean {
    return person.status === 'active' && !person.must_change_password && (person.role === 'admin' || (!item.archived_at && (person.role === 'teacher' || item.student_policy === 'immediate' || (item.student_policy === 'scheduled' && !!item.release_at && new Date(item.release_at).getTime() <= DEMO_NOW))));
  }
  function note(action: string, target_label: string, detail: string): void {
    audit.unshift({ id: `demo-audit-${sequence++}`, actor_name: current()?.display_name ?? '示範系統', action, target_label, detail, created_at: updated() });
  }
  function ensureVersion(currentVersion: number, suppliedVersion: number): void {
    if (currentVersion !== suppliedVersion) throw new Error('這筆資料已由其他管理員更新。請重新載入，確認最新內容後再儲存。');
  }
  function validate(input: ResourceInput): void {
    if (!input.title.trim()) throw new Error('請填寫資料標題。');
    if (input.student_policy === 'scheduled' && (!input.release_at || Number.isNaN(new Date(input.release_at).getTime()))) throw new Error('請設定有效的公開日期及時間。');
    if (input.lesson_id !== null && !lessons.some(item => item.id === input.lesson_id)) throw new Error('找不到所選課堂。');
  }
  const service: PortalService = {
    configured: true, demo: true,
    session: async () => clone(current()),
    onAuthChange(callback) { listeners.add(callback); return () => listeners.delete(callback); },
    signIn: async (email, password) => {
      const item = accounts.find(person => person.email.toLowerCase() === email.trim().toLowerCase() || person.username === email.trim().toUpperCase());
      if (!item || passwords.get(item.id) !== password) throw new Error('示範電郵或密碼不正確。示範密碼為 DemoOnly!2026。');
      selectedId = item.id; emit(); return clone(item);
    },
    signOut: async () => { selectedId = null; emit(); },
    requestPasswordReset: async email => { if (!email.trim()) throw new Error('請填寫電郵。'); },
    updatePassword: async password => {
      const item = current();
      if (!item) throw new Error('請先登入示範賬戶。');
      if (password.length < 12) throw new Error('請使用至少12字元的密碼。');
      if (item.username && password.toUpperCase() === item.username) throw new Error('新密碼不可與帳戶名稱相同。');
      passwords.set(item.id, password);
      item.must_change_password = false; item.version++; item.updated_at = updated();
    },
    lessons: async () => { requireActive(); return clone([...lessons].sort((a, b) => a.sort_order - b.sort_order)); },
    resources: async () => { const person = requireActive(); return clone(resources.filter(item => allowed(item, person))); },
    accounts: async () => { requireActive(true); return clone(accounts); },
    createAccounts: async rows => {
      requireActive(true);
      if (!rows.length || rows.length > 50) throw new Error('每批請建立1至50個學生帳戶。');
      return rows.map((row): CreateAccountResult => {
        const existing = accounts.find(item => item.username === row.username);
        if (existing) return { ...row, id: existing.id, status: 'existing', message: '帳戶已存在，沒有更改密碼。' };
        if (!row.name.trim() || !/^[A-Z][A-Z0-9]{1,59}$/.test(row.username)) return { ...row, status: 'error', message: '請核對姓名及帳戶格式。' };
        const person: Account = { id: `demo-created-${sequence++}`, username: row.username, must_change_password: true, email: `${row.username.toLowerCase()}@accounts.cantonese.invalid`, display_name: row.name, role: 'student', status: 'active', version: 1, updated_at: updated() };
        accounts.push(person); passwords.set(person.id, row.username);
        note('建立學生帳戶', row.name, '示範帳戶已建立，首次登入須更改密碼。');
        return { ...row, id: person.id, status: 'created' };
      });
    },
    resetInitialPassword: async supplied => {
      const actor = requireActive(true);
      const item = accounts.find(person => person.id === supplied.id);
      if (!item || item.role !== 'student' || !item.username || item.id === actor.id) throw new Error('只能重設拼音學生帳戶。');
      ensureVersion(item.version, supplied.version);
      passwords.set(item.id, item.username); item.must_change_password = true; item.version++; item.updated_at = updated();
      note('重設初始密碼', item.display_name, '下次登入須更改密碼。');
    },
    audit: async () => { requireActive(true); return clone(audit); },
    download: async requested => {
      const person = requireActive();
      const item = resources.find(resource => resource.id === requested.id);
      if (!item || !allowed(item, person)) throw new Error('這份示範資料尚未公開，或你目前沒有存取權限。');
      const blob = new Blob([`示範檔案，沒有正式內容。\n\n${item.title}\n\n這個檔案只用於測試課程門戶的下載操作。\n正式資料需登入正式網站後按賬戶權限存取。\n`], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `示範_${item.title.replace(/[\\/\u0000-\u001f]/g, '_')}.txt`; anchor.hidden = true;
      document.body.append(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    saveResource: async (input, supplied, file) => {
      requireActive(true); validate(input);
      const existing = supplied ? resources.find(item => item.id === supplied.id) : null;
      if (supplied && !existing) throw new Error('找不到這份資料。');
      if (existing && supplied) { ensureVersion(existing.version, supplied.version); if (existing.archived_at) throw new Error('請先恢復這份已封存的資料。'); }
      if (!existing && !file) throw new Error('請選擇要上傳的文件。');
      if (file && (file.size < 1 || file.size > 50 * 1024 * 1024)) throw new Error('請選擇大於0位元組、並且不超過50 MB的文件。');
      const item: Resource = {
        id: existing?.id ?? `demo-resource-${sequence++}`, ...clone(input), title: input.title.trim(), release_at: input.student_policy === 'scheduled' ? input.release_at : null,
        archived_at: null, file_name: file?.name ?? existing!.file_name, file_size: file?.size ?? existing!.file_size,
        mime_type: file?.type || existing?.mime_type || 'application/octet-stream', storage_path: file ? `demo-only/upload-${sequence++}` : existing!.storage_path,
        version: (existing?.version ?? 0) + 1, updated_at: updated(),
      };
      if (existing) resources[resources.indexOf(existing)] = item; else resources.push(item);
      note(existing ? '更新資料' : '新增資料', item.title, `公開方式：${policyLabel[item.student_policy]}${file ? '；已選擇示範文件，未上傳到正式儲存空間。' : '。'}`);
    },
    archiveResource: async (supplied, archived) => {
      requireActive(true);
      const item = resources.find(resource => resource.id === supplied.id);
      if (!item) throw new Error('找不到這份資料。');
      ensureVersion(item.version, supplied.version);
      item.archived_at = archived ? updated() : null; item.updated_at = updated(); item.version++;
      note(archived ? '封存資料' : '恢復資料', item.title, archived ? '已從課程閱覽頁收起。' : '已按原公開設定恢復。');
    },
    updateAccount: async (supplied, role, status) => {
      requireActive(true);
      const item = accounts.find(person => person.id === supplied.id);
      if (!item) throw new Error('找不到賬戶。');
      ensureVersion(item.version, supplied.version);
      if (item.must_change_password && role !== 'student') throw new Error('請先完成首次更改密碼，再設定教職員權限。');
      if (item.role === 'admin' && item.status === 'active' && (role !== 'admin' || status !== 'active') && accounts.filter(person => person.role === 'admin' && person.status === 'active').length <= 1) throw new Error('必須保留至少一位已核准的管理員。請先指定另一位管理員。');
      item.role = role; item.status = status; item.version++; item.updated_at = updated();
      note('更新賬戶', item.display_name, `角色：${roleLabel[role]}；狀態：${statusLabel[status]}。`);
    },
    updateLesson: async (supplied, input) => {
      requireActive(true);
      const item = lessons.find(lesson => lesson.id === supplied.id);
      if (!item) throw new Error('找不到課堂。');
      ensureVersion(item.version, supplied.version);
      if (!input.title.trim()) throw new Error('請填寫課堂名稱。');
      const duration = input.duration_minutes;
      if (!Number.isFinite(duration) || duration < 15 || duration > 480) throw new Error('課堂長度須為15至480分鐘。');
      if (input.starts_at && Number.isNaN(new Date(input.starts_at).getTime())) throw new Error('請設定有效的上課日期及時間。');
      Object.assign(item, { title: input.title.trim(), summary: input.summary, starts_at: input.starts_at || null, duration_minutes: duration,
        ends_at: input.starts_at ? new Date(new Date(input.starts_at).getTime() + duration * 60_000).toISOString() : '', location: LOCATION, version: item.version + 1, updated_at: updated() });
      note('更新課堂', item.title, '已更新課堂設定；教材公開時間保持原來設定。');
    },
    previewAs: async role => {
      const item = accounts.find(person => person.role === role && person.status === 'active');
      if (!item) throw new Error(`示範資料中沒有可用的${roleLabel[role]}賬戶。重新整理頁面可還原示範。`);
      selectedId = item.id; emit(); return clone(item);
    },
  };
  return service;
}
