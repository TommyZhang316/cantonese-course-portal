const MANAGED_USERNAME = /^[A-Z][A-Z0-9]{1,59}$/;
export async function initialPasswordTransport(username: string): Promise<string> {
  // Compatibility with Auth's minimum length for short names. This public
  // encoding does not make a predictable initial password secret or stronger.
  // Database RLS blocks course access until the initial password is replaced.
  const bytes = new TextEncoder().encode(`course-initial-v1:${username}`);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function loginCredentials(identifier: string, password: string): Promise<{ email: string; password: string }> {
  const value = identifier.trim();
  if (value.includes('@')) return { email: value, password };
  const username = value.toUpperCase();
  if (!MANAGED_USERNAME.test(username)) throw new Error('請輸入管理員提供的帳戶名稱，或已登記的電郵。');
  return { email: `${username.toLowerCase()}@accounts.cantonese.invalid`, password: password === username ? await initialPasswordTransport(username) : password };
}
