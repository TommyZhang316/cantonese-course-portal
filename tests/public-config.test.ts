import { describe,it,expect } from 'vitest';
// @ts-expect-error pure ESM build validation helper
import { validatePublicConfig } from '../scripts/validate-web-config.mjs';
const jwt=(role:string)=>'eyJ0eXAiOiJKV1QifQ.'+Buffer.from(JSON.stringify({role})).toString('base64url')+'.signature';
describe('public frontend key boundary',()=>{
  it('accepts publishable and anon connection values',()=>{
    expect(validatePublicConfig('https://example.supabase.co','sb_publishable_example')).toBe(true);
    expect(validatePublicConfig('https://example.supabase.co',jwt('anon'))).toBe(true);
  });
  it('rejects secret keys before the bundler can include them',()=>{
    expect(()=>validatePublicConfig('https://example.supabase.co','sb_secret_donotpublish')).toThrow();
    expect(()=>validatePublicConfig('https://example.supabase.co',jwt('service_role'))).toThrow();
  });
  it('allows local unconfigured preview but blocks unconfigured deployment',()=>{
    expect(validatePublicConfig('','')).toBe(false);
    expect(()=>validatePublicConfig('','',true)).toThrow();
  });
  it('requires transport protection for production projects',()=>{
    expect(()=>validatePublicConfig('http://example.supabase.co','sb_publishable_example')).toThrow();
  });
});
