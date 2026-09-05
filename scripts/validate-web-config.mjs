export function validatePublicConfig(url, key, required = false) {
  if (!url || !key) {
    if (required) throw new Error('Missing public Supabase URL/key. Configure repository Actions variables before deploying.');
    return false;
  }
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('Supabase URL is not valid.'); }
  if (parsed.protocol !== 'https:' && !['localhost','127.0.0.1'].includes(parsed.hostname)) throw new Error('Supabase must use HTTPS.');
  if (key.startsWith('sb_secret_')) throw new Error('Secret keys cannot be included in the frontend. Use a publishable key.');
  if (key.startsWith('eyJ')) {
    try {
      const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8'));
      if (payload.role !== 'anon') throw new Error('legacy-role');
    } catch { throw new Error('Only a legacy anon key is allowed in the frontend.'); }
  } else if (!key.startsWith('sb_publishable_')) {
    throw new Error('Use a Supabase publishable key or legacy anon key.');
  }
  return true;
}

if (process.argv.includes('--required')) validatePublicConfig(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, true);
