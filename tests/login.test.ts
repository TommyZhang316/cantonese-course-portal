import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { initialPasswordTransport, loginCredentials } from '../src/lib/login';

describe('managed login boundary', () => {
  it('supports a four-letter initial username without lowering Auth password policy', async () => {
    const result = await loginCredentials(' liwu ', 'LIWU');
    expect(result.email).toBe('liwu@accounts.cantonese.invalid');
    expect(result.password).toBe(createHash('sha256').update('course-initial-v1:LIWU').digest('hex'));
    expect(result.password).toHaveLength(64);
  });
  it('does not transform a personal replacement password', async () => {
    expect(await loginCredentials('LIWU', 'My new secret phrase')).toEqual({ email: 'liwu@accounts.cantonese.invalid', password: 'My new secret phrase' });
  });
  it('preserves existing staff email credentials including password whitespace', async () => {
    expect(await loginCredentials(' teacher@example.invalid ', ' keep spaces ')).toEqual({ email: 'teacher@example.invalid', password: ' keep spaces ' });
  });
  it('keeps the initial password case-sensitive', async () => {
    expect((await loginCredentials('liwu', 'liwu')).password).toBe('liwu');
    expect((await loginCredentials('liwu', 'liwu')).password).not.toBe(await initialPasswordTransport('LIWU'));
  });
  it('rejects unnormalized account characters rather than guessing another identity', async () => {
    await expect(loginCredentials('LI WU', 'LIWU')).rejects.toThrow();
    await expect(loginCredentials('../LIWU', 'LIWU')).rejects.toThrow();
    await expect(loginCredentials('陳小明', 'CHENXIAOMING')).rejects.toThrow();
  });
});
