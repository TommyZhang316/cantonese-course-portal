import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialPasswordTransport } from '../src/lib/login';
import { createDemoService } from '../src/lib/demo';

const auth = vi.hoisted(() => ({
  getSession: vi.fn(), getUser: vi.fn(), updateUser: vi.fn(),
}));
const database = vi.hoisted(() => ({ single: vi.fn(), rpc: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth, rpc: database.rpc,
    from: () => ({ select: () => ({ eq: () => ({ single: database.single }) }) }),
  }),
}));
import { createPortalService } from '../src/lib/service';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('VITE_ENABLE_DEMO', 'false');
  vi.stubEnv('VITE_SUPABASE_URL', 'https://course.example.invalid');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'sb_publishable_test');
  auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'student' } } }, error: null });
  auth.getUser.mockResolvedValue({ data: { user: { id: 'student' } }, error: null });
  auth.updateUser.mockResolvedValue({ data: {}, error: null });
  database.single.mockResolvedValue({ data: {
    id: 'student', username: 'CHENXIAOMING', email: 'chenxiaoming@accounts.cantonese.invalid',
    role: 'student', status: 'approved', must_change_password: true, version: 1,
  }, error: null });
  database.rpc.mockResolvedValue({ data: null, error: null });
});
afterEach(() => vi.unstubAllEnvs());

describe('production password update boundary', () => {
  it('rejects five characters before any Auth password update or first-login unlock', async () => {
    const service = await createPortalService();
    await expect(service.updatePassword('abcde')).rejects.toThrow('至少6字元');
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(database.rpc).not.toHaveBeenCalled();
  });

  it.each(['abcdef', 'abcdefgh'])('accepts %s without requiring numbers or uppercase', async password => {
    const service = await createPortalService();
    await expect(service.updatePassword(password)).resolves.toBeUndefined();
    expect(auth.updateUser).toHaveBeenCalledExactlyOnceWith({ password });
    expect(database.rpc).toHaveBeenCalledExactlyOnceWith('complete_initial_password_change');
    expect(auth.updateUser.mock.invocationCallOrder[0]).toBeLessThan(database.rpc.mock.invocationCallOrder[0]);
  });

  it('still rejects the username and initial transport password', async () => {
    const service = await createPortalService();
    for (const password of ['CHENXIAOMING', 'chenxiaoming', await initialPasswordTransport('CHENXIAOMING')]) {
      await expect(service.updatePassword(password)).rejects.toThrow('不可與帳戶名稱或初始密碼相同');
    }
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(database.rpc).not.toHaveBeenCalled();
  });

  it('does not unlock first-login access when Auth rejects the update', async () => {
    auth.updateUser.mockResolvedValue({ data: null, error: { code: 'weak_password' } });
    const service = await createPortalService();
    await expect(service.updatePassword('abcdef')).rejects.toThrow('請使用至少6字元的密碼。');
    expect(database.rpc).not.toHaveBeenCalled();
  });

  it('requires the database first-login completion check to succeed', async () => {
    database.rpc.mockResolvedValue({ data: null, error: { code: '42501' } });
    const service = await createPortalService();
    await expect(service.updatePassword('abcdef')).rejects.toThrow('權限');
    expect(database.rpc).toHaveBeenCalledExactlyOnceWith('complete_initial_password_change');
  });

  it('changes an established account password without repeating first-login completion', async () => {
    database.single.mockResolvedValue({ data: {
      id: 'teacher', username: null, email: 'teacher@example.invalid', role: 'teacher',
      status: 'approved', must_change_password: false, version: 1,
    }, error: null });
    const service = await createPortalService();
    await expect(service.updatePassword('abcdef')).resolves.toBeUndefined();
    expect(auth.updateUser).toHaveBeenCalledExactlyOnceWith({ password: 'abcdef' });
    expect(database.rpc).not.toHaveBeenCalled();
  });
});

describe('demo password update parity', () => {
  it('keeps five-character attempts locked and accepts six characters for first login', async () => {
    const service = createDemoService();
    await service.signIn('LIWU', 'LIWU');
    await expect(service.updatePassword('abcde')).rejects.toThrow('至少6字元');
    await expect(service.resources()).rejects.toThrow('先更改初始密碼');
    await service.updatePassword('abcdef');
    await expect(service.resources()).resolves.toBeInstanceOf(Array);
    await service.signOut();
    await expect(service.signIn('LIWU', 'abcdef')).resolves.toMatchObject({ must_change_password: false });
  });
});
