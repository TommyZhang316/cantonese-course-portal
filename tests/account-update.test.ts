import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account, Resource } from '../src/types';

const database = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'admin' } } }, error: null }),
      getUser: async () => ({ data: { user: { id: 'admin' } }, error: null }),
    },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: {
      id: 'admin', role: 'admin', status: 'approved', must_change_password: false, version: 1,
    }, error: null }) }) }) }),
    rpc: database.rpc,
  }),
}));
import { createPortalService } from '../src/lib/service';

const target: Account = {
  id: 'target-student', username: 'ZHANGSAN', display_name: '張三', email: 'zhangsan@accounts.cantonese.invalid',
  role: 'student', status: 'active', version: 7, updated_at: '2026-09-06T00:00:00Z', must_change_password: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('VITE_ENABLE_DEMO', 'false');
  vi.stubEnv('VITE_SUPABASE_URL', 'https://course.example.invalid');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'sb_publishable_test');
  database.rpc.mockResolvedValue({ data: null, error: null });
});
afterEach(() => vi.unstubAllEnvs());

describe('account update RPC errors', () => {
  it.each([
    ['必須保留至少一位已核准的管理員。', '必須保留至少一位已啟用的管理員'],
    ['請先完成電郵驗證，然後再核准賬戶。', '尚未完成電郵驗證'],
    ['登入賬戶名稱建立後不可更改。', '帳戶名稱建立後不可更改'],
    ['由後臺建立的賬戶使用固定登入名稱。', '帳戶名稱建立後不可更改'],
    ['請先完成首次更改密碼，再提升賬戶角色。', '尚未完成首次更改密碼'],
  ])('maps the known account constraint %s', async (message, expected) => {
    database.rpc.mockResolvedValue({ data: null, error: { code: '23514', message } });
    const service = await createPortalService();
    await expect(service.updateAccount(target, 'teacher', 'active')).rejects.toThrow(expected);
    expect(database.rpc).toHaveBeenCalledExactlyOnceWith('admin_update_profile', {
      p_profile_id: target.id, p_expected_version: 7, p_role: 'teacher', p_status: 'approved',
    });
  });

  it('redacts unknown database constraints and gives account-specific guidance', async () => {
    database.rpc.mockResolvedValue({ data: null, error: { code: '23514', message: 'private_table.secret_account_constraint' } });
    const service = await createPortalService();
    await expect(service.updateAccount(target, 'teacher', 'active')).rejects.toThrow(
      '未能更新這個賬戶的權限或狀態。請重新載入帳戶清單，核對設定後再試。',
    );
  });

  it.each([
    ['40001', '這筆資料已由其他管理員更新'],
    ['42501', '你目前沒有進行這項操作的權限'],
    ['P0002', '找不到這個賬戶'],
    ['23505', '帳戶資料與現有賬戶重複'],
    ['22023', '請選擇有效的賬戶權限及狀態'],
  ])('keeps %s actionable for account updates', async (code, expected) => {
    database.rpc.mockResolvedValue({ data: null, error: { code, message: 'internal details' } });
    const service = await createPortalService();
    await expect(service.updateAccount(target, 'teacher', 'active')).rejects.toThrow(expected);
  });

  it.each([
    ['active', 'approved'], ['pending', 'pending'], ['suspended', 'suspended'],
  ] as const)('preserves the expected version and maps %s to %s', async (status, expectedStatus) => {
    const service = await createPortalService();
    await expect(service.updateAccount(target, 'teacher', status)).resolves.toBeUndefined();
    expect(database.rpc).toHaveBeenCalledExactlyOnceWith('admin_update_profile', {
      p_profile_id: 'target-student', p_expected_version: 7, p_role: 'teacher', p_status: expectedStatus,
    });
  });

  it('does not change material validation error guidance', async () => {
    database.rpc.mockResolvedValue({ data: null, error: { code: '23514', message: 'resource_validation_constraint' } });
    const service = await createPortalService();
    await expect(service.archiveResource({ id: 'material', version: 3 } as Resource, true)).rejects.toThrow(
      '資料格式不完整或不符合要求。請檢查標題、文件大小及公開時間。',
    );
    expect(database.rpc).toHaveBeenCalledExactlyOnceWith('admin_set_resource_archived', {
      p_resource_id: 'material', p_expected_version: 3, p_archived: true,
    });
  });
});
