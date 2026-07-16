import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@ductus/schema': r('./packages/schema/src/index.ts'),
      '@ductus/core': r('./packages/core/src/index.ts'),
      '@ductus/adapter-typescript': r('./packages/adapter-typescript/src/index.ts'),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    testTimeout: 30_000,
    // Builds all workspaces exactly once before any test file runs — the
    // per-file `npm run build` in beforeAll raced across parallel workers.
    globalSetup: './vitest.global-setup.ts',
  },
});
