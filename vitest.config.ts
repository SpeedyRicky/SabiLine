import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts on purpose: the test suite covers pure
// TypeScript logic (WER/CER/normalization/etc.) and does not render any
// .vue components, so it needs neither the Vue SFC compiler plugin nor the
// Tailwind plugin. Sharing vite.config.ts here also pulled in a duplicate,
// incompatible copy of Vite's types via vitest's own bundled Vite, which
// broke `vue-tsc` type-checking.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
