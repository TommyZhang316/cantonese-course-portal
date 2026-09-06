import { describe, expect, it } from 'vitest';
import { createDemoService, DEMO_PASSWORD } from '../src/lib/demo';

describe('demo preconfigured staff roles', () => {
  it.each(['teacher', 'admin'] as const)('assigns %s before first login while keeping access locked', async role => {
    const service = createDemoService();
    await service.signIn('admin@course.invalid', DEMO_PASSWORD);
    const target = (await service.accounts()).find(account => account.username === 'LIWU')!;
    await service.updateAccount(target, role, 'active');
    const assigned = (await service.accounts()).find(account => account.id === target.id)!;
    expect(assigned).toMatchObject({ role, must_change_password: true, version: target.version + 1 });

    await service.signIn('LIWU', 'LIWU');
    await expect(service.lessons()).rejects.toThrow('請先更改初始密碼');
    await expect(service.resources()).rejects.toThrow('請先更改初始密碼');
    await expect(service.accounts()).rejects.toThrow('請先更改初始密碼');
    await expect(service.createAccounts([{ name: '測試', username: 'CESHI' }])).rejects.toThrow('請先更改初始密碼');

    await service.updatePassword('abcdef');
    expect(await service.session()).toMatchObject({ role, must_change_password: false });
    expect((await service.resources()).some(resource => resource.student_policy === 'never')).toBe(true);
    if (role === 'teacher') await expect(service.accounts()).rejects.toThrow('需要管理員權限');
    else expect((await service.accounts()).length).toBeGreaterThan(0);
  });

  it('does not count an initial-password administrator as a replacement for the last usable administrator', async () => {
    const service = createDemoService();
    const administrator = await service.signIn('admin@course.invalid', DEMO_PASSWORD);
    const target = (await service.accounts()).find(account => account.username === 'LIWU')!;
    await service.updateAccount(target, 'admin', 'active');
    await expect(service.updateAccount(administrator, 'teacher', 'active')).rejects.toThrow('必須保留至少一位');
    await expect(service.updateAccount(administrator, 'admin', 'suspended')).rejects.toThrow('必須保留至少一位');
    expect(await service.session()).toMatchObject({ role: 'admin', status: 'active' });

    await service.signIn('LIWU', 'LIWU');
    await service.updatePassword('abcdef');
    await service.signIn('admin@course.invalid', DEMO_PASSWORD);
    await expect(service.updateAccount(administrator, 'teacher', 'active')).resolves.toBeUndefined();
    expect(await service.session()).toMatchObject({ role: 'teacher', status: 'active' });
  });
});
