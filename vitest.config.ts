import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Local deployment rehearsal copies are not part of the maintained test suite.
  test: { include: ['tests/**/*.test.ts'] },
});
