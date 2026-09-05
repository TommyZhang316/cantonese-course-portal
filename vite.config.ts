import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
// @ts-expect-error ESM build helper
import { validatePublicConfig } from './scripts/validate-web-config.mjs';

export default defineConfig(({ mode }) => {
const env = {...loadEnv(mode, process.cwd(), ''), ...process.env};
validatePublicConfig(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_ANON_KEY,false);
return ({
  plugins: [react()],
  base: process.env.VITE_BASE_PATH || './',
  define: { 'import.meta.env.VITE_ENABLE_DEMO': JSON.stringify(mode === 'demo' ? 'true' : 'false') },
  build: { sourcemap: false, target: 'es2022' },
});});
